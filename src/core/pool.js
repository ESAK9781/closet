// A small pool of worker threads that read PDFs, so the app never freezes while forms are parsed
// and several forms are read at once.

import os from "node:os";
import { Worker } from "node:worker_threads";

const WORKER = new URL("./worker.js", import.meta.url);

export class ParserPool {
  constructor({ templatesDir, cacheDir, size }) {
    this.opts = { templatesDir, cacheDir };
    this.size = Math.max(1, size ?? Math.min(4, Math.max(1, os.cpus().length - 1)));
    this.workers = [];
    this.idle = [];
    this.waiting = [];
    this.jobs = new Map();
    this.nextJob = 1;
  }

  /** Start the workers. The first one builds the template cache; the rest then just load it. */
  async start() {
    const first = await this.spawn();
    this.release(first);
    await Promise.all(Array.from({ length: this.size - 1 }, async () => this.release(await this.spawn())));
  }

  spawn() {
    return new Promise((resolve, reject) => {
      const w = new Worker(WORKER, { workerData: this.opts });
      w.once("message", (msg) => {
        if (msg.type !== "ready") return;
        if (msg.error) {
          w.terminate();
          reject(new Error(msg.error));
          return;
        }
        w.on("message", (m) => this.onResult(w, m));
        this.workers.push(w);
        resolve(w);
      });
      w.once("error", reject);
      w.on("error", (e) => this.onCrash(w, e));
      w.on("exit", (code) => code && this.onCrash(w, new Error(`parser thread exited with code ${code}`)));
    });
  }

  release(w) {
    const next = this.waiting.shift();
    if (next) next(w);
    else this.idle.push(w);
  }

  acquire() {
    const w = this.idle.pop();
    return w ? Promise.resolve(w) : new Promise((r) => this.waiting.push(r));
  }

  /** @returns {Promise<object>} the analysis for one PDF */
  async analyze(job) {
    const w = await this.acquire();
    const id = this.nextJob++;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject, worker: w });
      w.postMessage({ type: "analyze", id, ...job });
    });
  }

  onResult(w, msg) {
    const job = this.jobs.get(msg.id);
    if (!job) return;
    this.jobs.delete(msg.id);
    this.release(w);
    if (msg.error) job.reject(new Error(msg.error));
    else job.resolve(msg.result);
  }

  /** A crashed worker fails its job and is replaced, so one bad PDF can't stall the queue. */
  onCrash(w, err) {
    if (this.stopping || !this.workers.includes(w)) return;
    this.workers = this.workers.filter((x) => x !== w);
    this.idle = this.idle.filter((x) => x !== w);
    for (const [id, job] of this.jobs) {
      if (job.worker === w) {
        this.jobs.delete(id);
        job.reject(err);
      }
    }
    this.spawn().then((nw) => this.release(nw), () => {});
  }

  async stop() {
    this.stopping = true;
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}
