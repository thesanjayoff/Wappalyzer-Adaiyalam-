import { parentPort, workerData } from "node:worker_threads";

try {
  const { pattern, flags, inputs } = workerData;
  const safeFlags = String(flags || "").replace(/[gy]/g, "");
  const re = new RegExp(pattern, safeFlags);
  for (const input of inputs) {
    re.test(input);
  }
  parentPort.postMessage({ ok: true });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String((err && err.message) || err) });
}
