import { parentPort, workerData } from "node:worker_threads";

try {
  const { pattern, flags, input } = workerData;
  const safeFlags = String(flags || "").replace(/[gy]/g, "");
  const re = new RegExp(pattern, safeFlags);
  const start = process.hrtime.bigint();
  const matched = re.test(input);
  const end = process.hrtime.bigint();
  parentPort.postMessage({ ok: true, matched, ms: Number(end - start) / 1e6 });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String((err && err.message) || err) });
}
