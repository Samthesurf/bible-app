export interface TranslationMeta {
  abbr: string;
  name: string;
  copyright: string;
  books: number;
  chapters: number;
  verses: number;
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
