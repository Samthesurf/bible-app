import type { ChapterData, BookMeta, SearchResult, TranslationMeta } from './bible';
import type { TTSState } from './tts';

declare global {
  interface Window {
    electronAPI: {
      bible: {
        getCatalog(): Promise<TranslationMeta[]>;
        getChapter(abbr: string, bookIndex: number, chapterIndex: number): Promise<ChapterData>;
        getBookList(abbr: string): Promise<BookMeta[]>;
        search(abbr: string, query: string, maxResults?: number): Promise<SearchResult[]>;
      };
      tts: {
        isAvailable(): Promise<boolean>;
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
