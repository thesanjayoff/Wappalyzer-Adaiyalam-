import type { Readable } from "node:stream";
import { Agent, request as undiciRequest } from "undici";
import { assertAllowedScheme, createSsrfSafeLookup, type SsrfOptions } from "./ssrf.js";

export interface SafeFetchOptions {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  maxRedirects?: number;
  timeoutMs?: number;
  maxBodyBytes?: number;
  ssrf?: SsrfOptions;
  /** Skip UTF-8 decoding and return the raw buffer instead (favicons, etc). */
  binary?: boolean;
}

export interface SafeFetchResult {
  finalUrl: string;
  redirectChain: string[];
  statusCode: number;
  headers: Record<string, string>;
  /** Raw Set-Cookie header lines for this hop (not joined — cookie values/attributes can contain commas). */
  setCookies: string[];
  body: string;
  bodyBuffer?: Buffer;
  bodyTruncated: boolean;
  error?: string;
}

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 10_000;
/** 2MB cap on response bodies. We also never send Accept-Encoding, so servers
 * typically answer uncompressed and this cap is a true byte cap — not a
 * decompressed-size cap that a zip bomb could blow past. */
const DEFAULT_MAX_BODY_BYTES = 2_000_000;

function extractSetCookies(headers: Record<string, string | string[] | undefined>): string[] {
  const value = headers["set-cookie"];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function flattenHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

async function drain(body: Readable): Promise<void> {
  await new Promise<void>((resolve) => {
    body.resume();
    body.on("end", () => resolve());
    body.on("error", () => resolve());
  });
}

async function readCapped(body: Readable, maxBytes: number): Promise<{ buffer: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  await new Promise<void>((resolve, reject) => {
    body.on("data", (chunk: Buffer) => {
      if (truncated) return;
      total += chunk.length;
      if (total > maxBytes) {
        truncated = true;
        chunks.push(chunk.subarray(0, Math.max(0, maxBytes - (total - chunk.length))));
        body.destroy();
        return;
      }
      chunks.push(chunk);
    });
    body.on("end", resolve);
    body.on("close", resolve);
    body.on("error", (err) => (truncated ? resolve() : reject(err)));
  });
  return { buffer: Buffer.concat(chunks), truncated };
}

/**
 * Fetches a URL with: scheme restricted to http/https, DNS resolution
 * re-validated against private/reserved ranges on every connection
 * (including after a redirect, which this function follows manually so it
 * can re-check each hop), a hard timeout, and a hard byte cap on the
 * response body.
 */
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const redirectChain: string[] = [];
  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(currentUrl);
    try {
      assertAllowedScheme(parsed);
    } catch (err) {
      return { finalUrl: currentUrl, redirectChain, statusCode: 0, headers: {}, setCookies: [], body: "", bodyTruncated: false, error: (err as Error).message };
    }

    const agent = new Agent({ connect: { lookup: createSsrfSafeLookup(options.ssrf ?? {}) as never, timeout: timeoutMs } });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await undiciRequest(parsed, {
        method: options.method ?? "GET",
        headers: { "accept-encoding": "identity", ...options.headers },
        dispatcher: agent,
        signal: controller.signal,
        throwOnError: false,
      });

      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && typeof location === "string" && hop < maxRedirects) {
        await drain(response.body);
        redirectChain.push(currentUrl);
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (options.method === "HEAD") {
        return { finalUrl: currentUrl, redirectChain, statusCode: response.statusCode, headers: flattenHeaders(response.headers), setCookies: extractSetCookies(response.headers), body: "", bodyTruncated: false };
      }
      const { buffer, truncated } = await readCapped(response.body, maxBodyBytes);
      return {
        finalUrl: currentUrl,
        redirectChain,
        statusCode: response.statusCode,
        headers: flattenHeaders(response.headers),
        setCookies: extractSetCookies(response.headers),
        body: options.binary ? "" : buffer.toString("utf-8"),
        bodyBuffer: options.binary ? buffer : undefined,
        bodyTruncated: truncated,
      };
    } catch (err) {
      return {
        finalUrl: currentUrl,
        redirectChain,
        statusCode: 0,
        headers: {},
        setCookies: [],
        body: "",
        bodyTruncated: false,
        error: (err as Error).message,
      };
    } finally {
      clearTimeout(timer);
      void agent.close().catch(() => undefined);
    }
  }

  return {
    finalUrl: currentUrl,
    redirectChain,
    statusCode: 0,
    headers: {},
    setCookies: [],
    body: "",
    bodyTruncated: false,
    error: `exceeded max redirects (${maxRedirects})`,
  };
}
