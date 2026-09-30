import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import bcrypt from "bcryptjs";

// bcryptjs is pure JS, so hashing N passwords with Promise.all still runs
// one after another on the main thread (~60 ms each at cost 10) — a 500-row
// import would take ~30 s and block every other request meanwhile. Big
// batches are therefore split across a few short-lived worker threads.
// Plain-JS eval'd worker: works the same under ts-node-dev, vitest and the
// compiled build without a separate worker file to locate.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const bcrypt = require(workerData.bcryptPath);
parentPort.postMessage(workerData.passwords.map((p) => bcrypt.hashSync(p, workerData.cost)));
`;

const MAX_THREADS = 8;
// Below this, thread start-up (~30 ms each) isn't worth it.
const MIN_PER_THREAD = 4;

function hashInWorker(passwords: string[], cost: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { passwords, cost, bcryptPath: require.resolve("bcryptjs") },
    });
    worker.once("message", (hashes: string[]) => {
      resolve(hashes);
      void worker.terminate();
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`bcrypt worker exited with code ${code}`));
    });
  });
}

// Returns hashes in the same order as the input.
export async function hashPasswords(passwords: string[], cost: number): Promise<string[]> {
  const threads = Math.min(MAX_THREADS, Math.max(1, availableParallelism() - 1), Math.floor(passwords.length / MIN_PER_THREAD));
  if (threads < 2) {
    const out: string[] = [];
    for (const p of passwords) out.push(await bcrypt.hash(p, cost));
    return out;
  }
  const size = Math.ceil(passwords.length / threads);
  const chunks = Array.from({ length: threads }, (_, i) => passwords.slice(i * size, (i + 1) * size));
  const results = await Promise.all(chunks.filter((c) => c.length > 0).map((c) => hashInWorker(c, cost)));
  return results.flat();
}
