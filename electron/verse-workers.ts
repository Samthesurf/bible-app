import { Worker } from 'worker_threads';
import os from 'os';
import type { BibleTranslation, CompareVerseEntry } from './bible-loader';

/**
 * Round-robin worker pool that owns parsed translations.
 *
 * Each worker keeps a Map<abbr, BibleTranslation> of every translation it has
 * parsed, so a translation is read + JSON.parsed exactly once per app session.
 * Subsequent verse lookups are pure in-memory. Parsing runs on worker threads
 * (parallel across cores) instead of blocking the main process event loop.
 *
 * The worker script is inlined (eval:true) so it works identically in dev and
 * inside the packaged asar without extra file plumbing.
 */

const WORKER_COUNT = Math.max(2, Math.min(8, os.cpus().length));

interface PendingRequest {
  resolve: (value: CompareVerseEntry) => void;
  reject: (reason: unknown) => void;
}

const WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs/promises');
const path = require('path');

const dir = workerData.dir;
const cache = new Map(); // abbr -> parsed BibleTranslation

async function getParsed(abbr) {
  const hit = cache.get(abbr);
  if (hit) return hit;
  const raw = await fs.readFile(path.join(dir, abbr + '.json'), 'utf-8');
  const data = JSON.parse(raw);
  cache.set(abbr, data);
  return data;
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'verse') {
      const data = await getParsed(msg.abbr);
      const book = data.books[msg.bookIndex];
      const chapter = book && book.chapters[msg.chapterIndex];
      const text = chapter ? (chapter[msg.verseIndex] ?? '') : '';
      parentPort.postMessage({
        id: msg.id,
        ok: true,
        entry: { abbr: msg.abbr, name: data.name, copyright: data.copyright, text },
      });
    } else if (msg.type === 'prewarm') {
      await getParsed(msg.abbr);
      parentPort.postMessage({ id: msg.id, ok: true });
    }
  } catch (e) {
    parentPort.postMessage({ id: msg.id, ok: false, error: String((e && e.message) || e) });
  }
});
`;

export class VerseWorkerPool {
  private readonly workers: Worker[] = [];
  private nextWorker = 0;
  private idCounter = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(biblesPath: string) {
    for (let i = 0; i < WORKER_COUNT; i += 1) {
      const worker = new Worker(WORKER_SRC, {
        eval: true,
        workerData: { dir: biblesPath },
      });
      worker.on('message', (msg: { id: number; ok: boolean; entry?: CompareVerseEntry; error?: string }) => {
        const req = this.pending.get(msg.id);
        if (!req) return;
        this.pending.delete(msg.id);
        if (msg.ok && msg.entry) req.resolve(msg.entry);
        else req.reject(new Error(msg.error ?? 'verse worker error'));
      });
      worker.on('error', (err) => {
        console.error('[Bible] verse worker error:', err.message);
      });
      this.workers.push(worker);
    }
  }

  /** Resolve one verse from one translation. Parses+caches on first touch. */
  getVerse(abbr: string, bookIndex: number, chapterIndex: number, verseIndex: number): Promise<CompareVerseEntry> {
    const worker = this.workers[this.nextWorker];
    this.nextWorker = (this.nextWorker + 1) % this.workers.length;
    const id = this.idCounter++;
    return new Promise<CompareVerseEntry>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'verse', id, abbr, bookIndex, chapterIndex, verseIndex });
    });
  }

  /** Parse a translation into worker memory without extracting a verse. */
  prewarm(abbr: string): void {
    const worker = this.workers[this.nextWorker];
    this.nextWorker = (this.nextWorker + 1) % this.workers.length;
    const id = this.idCounter++;
    this.pending.set(id, {
      resolve: () => {},
      reject: () => {},
    });
    worker.postMessage({ type: 'prewarm', id, abbr });
  }

  dispose(): void {
    for (const w of this.workers) void w.terminate();
    this.workers.length = 0;
    this.pending.clear();
  }
}
