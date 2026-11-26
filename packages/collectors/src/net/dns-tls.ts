import dns from "node:dns";
import tls from "node:tls";
import { createHash } from "node:crypto";
import { createSsrfSafeLookup, resolveAndValidateHost, type SsrfOptions } from "./ssrf.js";

export interface DnsRecords {
  cname?: string[];
  mx?: string[];
  txt?: string[];
  ns?: string[];
}

export async function collectDnsRecords(hostname: string): Promise<DnsRecords> {
  const records: DnsRecords = {};
  await Promise.all([
    dns.promises
      .resolveCname(hostname)
      .then((r) => (records.cname = r))
      .catch(() => undefined),
    dns.promises
      .resolveMx(hostname)
      .then((r) => (records.mx = r.map((m) => `${m.priority} ${m.exchange}`)))
      .catch(() => undefined),
    dns.promises
      .resolveTxt(hostname)
      .then((r) => (records.txt = r.map((t) => t.join(""))))
      .catch(() => undefined),
    dns.promises
      .resolveNs(hostname)
      .then((r) => (records.ns = r))
      .catch(() => undefined),
  ]);
  return records;
}

export interface TlsInfo {
  issuer?: string;
  valid?: boolean;
  protocol?: string;
  error?: string;
}

export async function collectTlsInfo(hostname: string, port = 443, options: SsrfOptions = {}, timeoutMs = 8000): Promise<TlsInfo> {
  try {
    await resolveAndValidateHost(hostname, options);
  } catch (err) {
    return { error: (err as Error).message };
  }
  return new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect({
      host: hostname,
      port,
      servername: hostname,
      lookup: createSsrfSafeLookup(options) as never,
      timeout: timeoutMs,
      rejectUnauthorized: false,
    });
    const finish = (info: TlsInfo) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(info);
    };
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const issuer = cert?.issuer
        ? Object.entries(cert.issuer)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")
        : undefined;
      finish({ issuer, valid: socket.authorized, protocol: socket.getProtocol() ?? undefined });
    });
    socket.once("timeout", () => finish({ error: "TLS handshake timed out" }));
    socket.once("error", (err) => finish({ error: err.message }));
  });
}

export function hashFavicon(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
