import fs from 'fs/promises';
import path from 'path';

/**
 * Minimal JSON file store (replaces electron-store): persists plain JSON
 * settings to a single file in userData. Small, dependency-free, offline.
 */
export class JsonStore {
  private readonly filePath: string;
  private data: Record<string, unknown> = {};
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      this.data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.data = {};
    }
    this.loaded = true;
  }

  async get<T>(key: string): Promise<T | undefined> {
    await this.ensureLoaded();
    return this.data[key] as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.ensureLoaded();
    this.data[key] = value;
    await this.flush();
  }

  private async flush(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }
}
