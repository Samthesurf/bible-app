import fs from 'fs/promises';
import path from 'path';

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
  /** LRU cache: at most 2 full translations in memory (~8-10 MB each). */
  private readonly cache = new Map<string, BibleTranslation>();
  private readonly MAX_CACHE = 2;
  private catalog: TranslationMeta[] | null = null;

  constructor(biblesPath: string) {
    this.biblesPath = biblesPath;
  }

  async getCatalog(): Promise<TranslationMeta[]> {
    if (this.catalog) return this.catalog;
    const raw = await fs.readFile(path.join(this.biblesPath, 'index.json'), 'utf-8');
    this.catalog = JSON.parse(raw) as TranslationMeta[];
    return this.catalog;
  }

  async getBookList(abbr: string): Promise<BookMeta[]> {
    const bible = await this.load(abbr);
    return bible.books.map((b) => ({ name: b.name, chapterCount: b.chapters.length }));
  }

  async getChapter(abbr: string, bookIndex: number, chapterIndex: number): Promise<ChapterData> {
    const bible = await this.load(abbr);
    if (bookIndex < 0 || bookIndex >= bible.books.length) {
      throw new Error(`Book index ${bookIndex} out of range for ${abbr} (${bible.books.length} books)`);
    }
    const book = bible.books[bookIndex];
    if (chapterIndex < 0 || chapterIndex >= book.chapters.length) {
      throw new Error(`Chapter index ${chapterIndex} out of range for ${abbr} ${book.name}`);
    }
    return {
      abbr,
      bookName: book.name,
      bookIndex,
      chapterIndex,
      chapterNumber: chapterIndex + 1,
      totalChapters: book.chapters.length,
      verses: book.chapters[chapterIndex],
      copyright: bible.copyright,
      translationName: bible.name,
    };
  }

  async search(abbr: string, query: string, maxResults = 50): Promise<SearchResult[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const bible = await this.load(abbr);
    const results: SearchResult[] = [];
    for (let b = 0; b < bible.books.length && results.length < maxResults; b += 1) {
      const book = bible.books[b];
      for (let c = 0; c < book.chapters.length && results.length < maxResults; c += 1) {
        const chapter = book.chapters[c];
        for (let v = 0; v < chapter.length && results.length < maxResults; v += 1) {
          if (chapter[v].toLowerCase().includes(needle)) {
            results.push({
              bookIndex: b,
              chapterIndex: c,
              verseIndex: v,
              reference: `${book.name} ${c + 1}:${v + 1}`,
              text: chapter[v],
            });
          }
        }
      }
    }
    return results;
  }

  /**
   * Fetches a single verse across many translations at once, without going
   * through the LRU cache (which holds at most 2 full translations and would
   * thrash if 50+ were pulled through it). Each translation is read from
   * disk directly, so the reading view's cached translations stay warm.
   *
   * Runs with bounded concurrency to avoid reading 50+ files at once.
   */
  async getVerses(
    abbrs: string[],
    bookIndex: number,
    chapterIndex: number,
    verseIndex: number,
  ): Promise<CompareVerseEntry[]> {
    const CONCURRENCY = 4;
    const entries: CompareVerseEntry[] = new Array(abbrs.length);
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < abbrs.length) {
        const i = next;
        next += 1;
        entries[i] = await this.getVerseUncached(abbrs[i], bookIndex, chapterIndex, verseIndex);
      }
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY, abbrs.length) }, () => worker());
    await Promise.all(workers);
    return entries;
  }

  /** Reads a single translation from disk and extracts one verse. */
  private async getVerseUncached(
    abbr: string,
    bookIndex: number,
    chapterIndex: number,
    verseIndex: number,
  ): Promise<CompareVerseEntry> {
    const raw = await fs.readFile(path.join(this.biblesPath, `${abbr}.json`), 'utf-8');
    const data = JSON.parse(raw) as BibleTranslation;
    const book = data.books[bookIndex];
    if (!book) return { abbr, name: data.name, copyright: data.copyright, text: '' };
    const chapter = book.chapters[chapterIndex];
    if (!chapter) return { abbr, name: data.name, copyright: data.copyright, text: '' };
    return {
      abbr,
      name: data.name,
      copyright: data.copyright,
      text: chapter[verseIndex] ?? '',
    };
  }

  private async load(abbr: string): Promise<BibleTranslation> {
    const cached = this.cache.get(abbr);
    if (cached) {
      // Refresh LRU position
      this.cache.delete(abbr);
      this.cache.set(abbr, cached);
      return cached;
    }
    if (this.cache.size >= this.MAX_CACHE) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    const raw = await fs.readFile(path.join(this.biblesPath, `${abbr}.json`), 'utf-8');
    const data = JSON.parse(raw) as BibleTranslation;
    this.cache.set(abbr, data);
    return data;
  }
}
