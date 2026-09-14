import { Worker } from 'worker_threads';
import os from 'os';
import type { BookMeta, ChapterData, CompareVerseEntry, SearchResult } from './bible-loader';

/**
 * Worker pool that owns ALL parsed translation data.
 *
 * The main process never reads a full translation JSON: chapter reads, book
 * lists, searches and verse compares all run here, on background threads.
 * Each translation has ONE home worker (sticky hash routing), so it is read
 * + JSON.parsed exactly once per app session no matter how many lookups hit
 * it. Parsing never blocks the main process event loop, so startup and
 * scrolling stay jank-free while the pool trickles translations into memory.
 *
 * Workers are spawned lazily (first lookup, or an explicit prepare() call
 * right after the window paints) so app startup never pays thread-spawn cost
 * on its critical path. Background prewarming is staggered by the
 * BibleLoader, so disk/CPU stay free for the first chapter render.
 *
 * The worker script is inlined (eval:true) so it works identically in dev and
 * inside the packaged asar without extra file plumbing.
 */

const WORKER_COUNT = Math.max(2, Math.min(8, os.cpus().length));

interface PendingRequest {
  resolve: (value: unknown) => void;
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
    } else if (msg.type === 'chapter') {
      const data = await getParsed(msg.abbr);
      const book = data.books[msg.bookIndex];
      if (!book || msg.chapterIndex < 0 || msg.chapterIndex >= book.chapters.length) {
        throw new Error(
          'Chapter ' + (msg.chapterIndex + 1) + ' out of range for ' + msg.abbr +
          ' ' + (book ? book.name : 'book ' + msg.bookIndex)
        );
      }
      parentPort.postMessage({
        id: msg.id,
        ok: true,
        result: {
          abbr: msg.abbr,
          bookName: book.name,
          bookIndex: msg.bookIndex,
          chapterIndex: msg.chapterIndex,
          chapterNumber: msg.chapterIndex + 1,
          totalChapters: book.chapters.length,
          verses: book.chapters[msg.chapterIndex],
          copyright: data.copyright,
          translationName: data.name,
        },
      });
    } else if (msg.type === 'booklist') {
      const data = await getParsed(msg.abbr);
      parentPort.postMessage({
        id: msg.id,
        ok: true,
        result: data.books.map((b) => ({ name: b.name, chapterCount: b.chapters.length })),
      });
    } else if (msg.type === 'search') {
      const needle = String(msg.query || '').trim().toLowerCase();
      const results = [];
      if (needle) {
        const data = await getParsed(msg.abbr);
        for (let b = 0; b < data.books.length && results.length < msg.maxResults; b += 1) {
          const book = data.books[b];
          for (let c = 0; c < book.chapters.length && results.length < msg.maxResults; c += 1) {
            const chapter = book.chapters[c];
            for (let v = 0; v < chapter.length && results.length < msg.maxResults; v += 1) {
              if (chapter[v].toLowerCase().includes(needle)) {
                results.push({
                  bookIndex: b,
                  chapterIndex: c,
                  verseIndex: v,
                  reference: book.name + ' ' + (c + 1) + ':' + (v + 1),
                  text: chapter[v],
                });
              }
            }
          }
        }
      }
      parentPort.postMessage({ id: msg.id, ok: true, result: results });
    }
  } catch (e) {
    parentPort.postMessage({ id: msg.id, ok: false, error: String((e && e.message) || e) });
  }
});
`;

export class VerseWorkerPool {
  private readonly biblesPath: string;
  private workers: Worker[] = [];
  private idCounter = 1;
  private readonly pending = new Map<number, PendingRequest>();
  /** Translations already parsed or queued on their home worker. */
  private readonly warmed = new Set<string>();

  constructor(biblesPath: string) {
    // Cheap: no threads are spawned here. Call prepare() once the window
    // has painted, or just let the first lookup spawn the pool.
    this.biblesPath = biblesPath;
  }

  /** Spawn the worker threads without parsing anything (call after paint). */
  prepare(): void {
    this.ensureWorkers();
  }

  /** Deterministic home worker per translation: parsed at most once. */
  private pickWorker(abbr: string): Worker {
    this.ensureWorkers();
    let hash = 0;
    for (let i = 0; i < abbr.length; i += 1) {
      hash = (hash * 31 + abbr.charCodeAt(i)) >>> 0;
    }
    return this.workers[hash % this.workers.length];
  }

  private ensureWorkers(): void {
    if (this.workers.length > 0) return;
    for (let i = 0; i < WORKER_COUNT; i += 1) {
      const worker = new Worker(WORKER_SRC, {
        eval: true,
        workerData: { dir: this.biblesPath },
      });
      worker.on('message', (msg: { id: number; ok: boolean; entry?: CompareVerseEntry; result?: unknown; error?: string }) => {
        const req = this.pending.get(msg.id);
        if (!req) return;
        this.pending.delete(msg.id);
        if (msg.ok) req.resolve(msg.entry ?? msg.result);
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
    return this.request<CompareVerseEntry>({ type: 'verse', abbr, bookIndex, chapterIndex, verseIndex });
  }

  /** Full chapter data for one translation. Parses+caches on first touch. */
  getChapter(abbr: string, bookIndex: number, chapterIndex: number): Promise<ChapterData> {
    return this.request<ChapterData>({ type: 'chapter', abbr, bookIndex, chapterIndex });
  }

  /** Book names + chapter counts for one translation. */
  getBookList(abbr: string): Promise<BookMeta[]> {
    return this.request<BookMeta[]>({ type: 'booklist', abbr });
  }

  /** Full-text search within one translation. */
  search(abbr: string, query: string, maxResults: number): Promise<SearchResult[]> {
    return this.request<SearchResult[]>({ type: 'search', abbr, query, maxResults });
  }

  private request<T>(payload: Record<string, unknown> & { type: string; abbr: string }): Promise<T> {
    const worker = this.pickWorker(payload.abbr);
    this.warmed.add(payload.abbr);
    const id = this.idCounter++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ ...payload, id });
    });
  }

  /**
   * Parse a translation into its home worker's memory. Duplicate requests
   * for an already-warmed translation are skipped.
   */
  prewarm(abbr: string): void {
    if (this.warmed.has(abbr)) return;
    this.warmed.add(abbr);
    const worker = this.pickWorker(abbr);
    const id = this.idCounter++;
    this.pending.set(id, {
      resolve: () => {},
      reject: () => {},
    });
    worker.postMessage({ type: 'prewarm', id, abbr });
  }

  dispose(): void {
    for (const w of this.workers) void w.terminate();
    this.workers = [];
    this.pending.clear();
    this.warmed.clear();
  }
}
