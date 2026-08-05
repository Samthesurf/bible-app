import type { ChapterData, BookMeta, SearchResult, TranslationMeta, CompareVerseEntry } from './bible';
import type { TTSState } from './tts';

declare global {
  interface Window {
    electronAPI: {
      bible: {
        getCatalog(): Promise<TranslationMeta[]>;
        getChapter(abbr: string, bookIndex: number, chapterIndex: number): Promise<ChapterData>;
        getBookList(abbr: string): Promise<BookMeta[]>;
        search(abbr: string, query: string, maxResults?: number): Promise<SearchResult[]>;
        getVerses(
          abbrs: string[],
          bookIndex: number,
          chapterIndex: number,
          verseIndex: number,
          requestId: string,
        ): Promise<{ requestId: string; entries: CompareVerseEntry[] }>;
        onVersesProgress(
          callback: (payload: { requestId: string; index: number; entry: CompareVerseEntry }) => void,
        ): () => void;
      };
      tts: {
        isAvailable(): Promise<boolean>;
        getStats(): Promise<{ cached: number; lastSource: string }>;
        speak(text: string): Promise<void>;
        prefetch(text: string): Promise<void>;
        stop(): Promise<void>;
        updateConfig(voice?: string, speed?: number): Promise<void>;
        onStateChange(callback: (state: TTSState) => void): () => void;
      };
      store: {
        get<T>(key: string): Promise<T | undefined>;
        set<T>(key: string, value: T): Promise<void>;
      };
    };
  }
}

export {};
