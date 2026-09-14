import fs from 'fs/promises';
import path from 'path';
import { VerseWorkerPool } from './verse-workers';

export interface TranslationMeta {
  abbr: string;
  name: string;
  copyright: string;
  books: number;
  chapters: number;
  verses: number;
}

export interface BibleTranslation {
  abbr: string;
  name: string;
  copyright: string;
  books: { name: string; chapters: string[][] }[];
}

export interface ChapterData {
  abbr: string;
  bookName: string;
  bookIndex: number;
  chapterIndex: number;
  chapterNumber: number;
  totalChapters: number;
  verses: string[];
  copyright: string;
  translationName: string;
}

export interface BookMeta {
  name: string;
  chapterCount: number;
}

export interface SearchResult {
  bookIndex: number;
  chapterIndex: number;
  verseIndex: number;
  reference: string;
  text: string;
}

export interface CompareVerseEntry {
  abbr: string;
  name: string;
  copyright: string;
  text: string;
}

export class BibleLoader {
  private readonly biblesPath: string;
  private catalog: TranslationMeta[] | null = null;
  /** Worker pool that owns ALL parsed translations (chapters, compare, search). */
  private readonly workerPool: VerseWorkerPool;
  private prewarmStarted = false;
  private prewarmTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(biblesPath: string) {
    this.biblesPath = biblesPath;
    this.workerPool = new VerseWorkerPool(biblesPath);
  }

  /** Spawn worker threads (no parsing yet). Cheap; call right after paint. */
  prepareWorkers(): void {
    this.workerPool.prepare();
  }

  /**
   * Parse every translation into the worker pool as a background trickle.
   * Popular translations go first so the common compares are instant within
   * a second or two; the rest follow one at a time so disk/CPU never spike
   * while the user is reading. Each translation is parsed exactly once
   * (sticky worker routing), so the full set settles in ~10s with no jank.
   */
  startBackgroundPrewarm(): void {
    if (this.prewarmStarted || this.disposed) return;
    this.prewarmStarted = true;
    void this.getCatalog().then((catalog) => {
      if (this.disposed) return;
      const popular = ['KJV', 'NKJV', 'NIV', 'ESV', 'NLT', 'NASB', 'CSB', 'AMP', 'MSG', 'WEB'];
      const rank = (abbr: string): number => {
        const i = popular.indexOf(abbr);
        return i === -1 ? popular.length : i;
      };
      const ordered = [...catalog].sort((a, b) => rank(a.abbr) - rank(b.abbr));
      let next = 0;
      const step = (): void => {
        if (this.disposed) return;
        this.workerPool.prewarm(ordered[next].abbr);
        next += 1;
        if (next < ordered.length) {
          this.prewarmTimer = setTimeout(step, 150);
        } else {
          this.prewarmTimer = null;
        }
      };
      this.prewarmTimer = setTimeout(step, 500);
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.prewarmTimer) clearTimeout(this.prewarmTimer);
    this.prewarmTimer = null;
    this.workerPool.dispose();
  }

  async getCatalog(): Promise<TranslationMeta[]> {
    if (this.catalog) return this.catalog;
    const raw = await fs.readFile(path.join(this.biblesPath, 'index.json'), 'utf-8');
    this.catalog = JSON.parse(raw) as TranslationMeta[];
    return this.catalog;
  }

  /** Book names + chapter counts, parsed in a worker (never on main). */
  async getBookList(abbr: string): Promise<BookMeta[]> {
    return this.workerPool.getBookList(abbr);
  }

  /** Full chapter data, parsed in a worker (never on main). */
  async getChapter(abbr: string, bookIndex: number, chapterIndex: number): Promise<ChapterData> {
    return this.workerPool.getChapter(abbr, bookIndex, chapterIndex);
  }

  /** Full-text search inside a worker (never on main). */
  async search(abbr: string, query: string, maxResults = 50): Promise<SearchResult[]> {
    return this.workerPool.search(abbr, query, maxResults);
  }

  /**
   * Fetches a single verse across many translations at once, using a worker
   * pool that caches every parsed translation for the session. Each
   * translation is parsed exactly once (parallel across CPU cores), so the
   * first compare warms the pool and every later look-up is in-memory.
   *
   * Results are delivered top-to-bottom via the optional onEntry callback as
   * soon as each translation resolves, so the UI fills progressively instead
   * of waiting for all 56 files.
   */
  async getVerses(
    abbrs: string[],
    bookIndex: number,
    chapterIndex: number,
    verseIndex: number,
    onEntry?: (index: number, entry: CompareVerseEntry) => void,
  ): Promise<CompareVerseEntry[]> {
    const entries: CompareVerseEntry[] = new Array(abbrs.length);

    const jobs = abbrs.map((abbr, index) =>
      this.workerPool
        .getVerse(abbr, bookIndex, chapterIndex, verseIndex)
        .then((entry) => {
          entries[index] = entry;
        })
        .catch(() => {
          entries[index] = { abbr, name: abbr, copyright: '', text: '' };
        }),
    );

    // Emit in index order as leading slots fill: whenever any job resolves,
    // flush the now-complete contiguous prefix so the UI fills top to bottom.
    let nextToEmit = 0;
    await Promise.all(
      jobs.map((job) =>
        job.then(() => {
          while (nextToEmit < entries.length && entries[nextToEmit]) {
            onEntry?.(nextToEmit, entries[nextToEmit]);
            nextToEmit += 1;
          }
        }),
      ),
    );
    return entries;
  }
}
