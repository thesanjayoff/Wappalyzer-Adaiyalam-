import dns from "node:dns";
import net from "node:net";

export class SsrfBlockedError extends Error {}

export interface SsrfOptions {
  /** Opt-in for scanning the user's own dev servers (localhost, 192.168.x.x, etc). Off by default. */
  allowPrivateHosts?: boolean;
}

const PRIVATE_V4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4ToLong(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isIpv4InRange(ip: string, range: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToLong(ip) & mask) === (ipv4ToLong(range) & mask);
}

function isPrivateIpv4(ip: string): boolean {
  return PRIVATE_V4_RANGES.some(([range, bits]) => isIpv4InRange(ip, range, bits));
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // fe80::/10 link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 unique local
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice("::ffff:".length);
    if (net.isIPv4(v4)) return isPrivateIpv4(v4);
  }
  return false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(ip)) return isPrivateIpv6(ip);
  return true; // unrecognized shape: fail closed
}

export function assertAllowedScheme(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(`scheme "${url.protocol}" is not allowed (only http/https)`);
  }
}

/**
 * Resolves a hostname and rejects it if any resolved address is
 * private/loopback/link-local/multicast/reserved, unless explicitly
 * allowed. Called fresh at the moment of connecting (see
 * `createSsrfSafeLookup`) so there is no gap between "checked" and
 * "connected" for DNS-rebinding to exploit.
 */
export async function resolveAndValidateHost(hostname: string, options: SsrfOptions = {}): Promise<string[]> {
  if (net.isIP(hostname)) {
    if (!options.allowPrivateHosts && isPrivateOrReservedIp(hostname)) {
      throw new SsrfBlockedError(`refusing to connect to private/reserved address ${hostname}`);
    }
    return [hostname];
  }
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new SsrfBlockedError(`could not resolve host ${hostname}`);
  }
  if (!options.allowPrivateHosts) {
    const blocked = records.find((r) => isPrivateOrReservedIp(r.address));
    if (blocked) {
      throw new SsrfBlockedError(`host ${hostname} resolves to private/reserved address ${blocked.address}`);
    }
  }
  return records.map((r) => r.address);
}

type DnsLookupCallback = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

/**
 * A `dns.lookup`-compatible function that validates on every call (not just
 * once up front), suitable for passing as the custom `lookup` of an undici
 * `Agent`'s `connect` options (or `tls.connect`'s `lookup` option) so every
 * TCP connection — including ones made after following a redirect to a new
 * host — goes through SSRF validation. Typed loosely and cast at call sites
 * because Node's own `dns.lookup`/`net.LookupFunction` overload set does
 * not type-check cleanly against a single implementation.
 */
export function createSsrfSafeLookup(options: SsrfOptions = {}) {
  return (hostname: string, lookupOptions: dns.LookupOneOptions | dns.LookupAllOptions, callback: DnsLookupCallback): void => {
    resolveAndValidateHost(hostname, options)
      .then((addresses) => {
        const wantsAll = typeof lookupOptions === "object" && "all" in lookupOptions && lookupOptions.all;
        if (wantsAll) {
          callback(
            null,
            addresses.map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 }))
          );
        } else {
          const first = addresses[0] as string;
          callback(null, first, net.isIPv6(first) ? 6 : 4);
        }
      })
      .catch((err: Error) => callback(err as NodeJS.ErrnoException));
  };
}
