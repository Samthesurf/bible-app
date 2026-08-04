import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import type { TTSEngine, TTSOptions, TTSState } from './tts-stub';

const OPENROUTER_TTS_URL = 'https://openrouter.ai/api/v1/audio/speech';
const DEFAULT_MODEL = 'hexgrad/kokoro-82m';
const DEFAULT_VOICE = 'af_heart';
const DEFAULT_SPEED = 1.0;
/** How many times to re-attempt a transient request failure before giving up. */
const MAX_RETRIES = 4;
/** Backoff for the first retry (ms); doubles each retry, with jitter. */
const RETRY_BASE_MS = 500;
/** Per-attempt timeout so a hung connection can't stall a whole chapter run. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface KokoroConfig {
  apiKey: string;
  voice?: string;
  speed?: number;
}

/**
 * Real TTS engine: OpenRouter Kokoro-82M via the OpenAI-compatible
 * /api/v1/audio/speech endpoint, played back headlessly with mpv.
 */
export class KokoroTTSEngine implements TTSEngine {
  private apiKey: string;
  private defaultVoice: string;
  private defaultSpeed: number;
  private listener: ((state: TTSState) => void) | null = null;
  private currentProcess: ChildProcess | null = null;
  private readonly tempDir: string;
  private available: boolean | null = null;
  /** Prefetched audio cache: hash(text) -> temp mp3 path. */
  private readonly prefetchCache = new Map<string, string>();
  /** In-flight prefetch fetches, keyed by hash — allows parallel fetching. */
  private readonly prefetchFetches = new Map<string, Promise<void>>();
  /** Max entries kept in the prefetch cache (3-ahead window + slack). */
  private static readonly PREFETCH_MAX = 6;

  constructor(config: KokoroConfig) {
    this.apiKey = config.apiKey;
    this.defaultVoice = config.voice ?? DEFAULT_VOICE;
    this.defaultSpeed = config.speed ?? DEFAULT_SPEED;
    this.tempDir = path.join(os.tmpdir(), 'bible-app-tts');
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    this.available = !!this.apiKey && this.apiKey.length > 10;
    return this.available;
  }

  async speak(text: string, options?: TTSOptions): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('TTS engine not configured: missing API key');
    }

    // Stop any current speech first (concurrent-request guard)
    await this.stop();

    const voice = options?.voice ?? this.defaultVoice;
    const speed = options?.rate ?? this.defaultSpeed;

    this.emitState({ status: 'speaking', text });

    try {
      // 1. Reuse a prefetched file if one exists (pipeline), else fetch.
      const key = this.hashKey(text, voice, speed);
      let tempFile = this.prefetchCache.get(key) ?? null;
      if (tempFile) {
        this.prefetchCache.delete(key);
      } else {
        // 1b. If a prefetch for this exact verse is still in flight, wait
        // for it (bounded) — zero-gap handoff without a duplicate fetch.
        const inflight = this.prefetchFetches.get(key);
        if (inflight) {
          try {
            await Promise.race([inflight, this.delay(2000)]);
          } catch {
            // fall through to a cold fetch
          }
          tempFile = this.prefetchCache.get(key) ?? null;
          if (tempFile) this.prefetchCache.delete(key);
        }
        if (!tempFile) {
          const audioBuffer = await this.callAPI(text, voice, speed);
          await fsp.mkdir(this.tempDir, { recursive: true });
          tempFile = path.join(this.tempDir, `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
          await fsp.writeFile(tempFile, audioBuffer);
        }
      }

      // 2. Play via mpv (headless)
      await this.playAudio(tempFile);

      // 3. Cleanup
      await fsp.unlink(tempFile).catch(() => {});

      this.emitState({ status: 'idle' });
    } catch (err) {
      if ((err as Error).message === 'TTS_STOPPED') {
        this.emitState({ status: 'idle' });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.emitState({ status: 'error', message });
      throw err;
    }
  }

  /**
   * Fetch the audio for `text` ahead of time and cache it, so the next
   * speak() for the same text plays immediately (near-zero latency between
   * verses). Every call starts its fetch IMMEDIATELY and in parallel with
   * other prefetches — verses 2,3,4 all load while verse 1 plays (the
   * "1 3 3 3" window). Deduped per text; failures are best-effort.
   */
  async prefetch(text: string, options?: TTSOptions): Promise<void> {
    if (!(await this.isAvailable())) return;
    const voice = options?.voice ?? this.defaultVoice;
    const speed = options?.rate ?? this.defaultSpeed;
    const key = this.hashKey(text, voice, speed);
    if (this.prefetchCache.has(key)) return; // already fetched
    if (this.prefetchFetches.has(key)) return; // already in flight

    const task = this.fetchAndCache(text, voice, speed, key);
    this.prefetchFetches.set(key, task);
    void task.finally(() => {
      this.prefetchFetches.delete(key);
    });
    // Return the promise so callers can await the fetch (used to warm verse
    // 0 before the loop); fire-and-forget callers may ignore it.
    return task;
  }

  /** Fetch one verse's audio and store it in the sliding prefetch cache. */
  private async fetchAndCache(text: string, voice: string, speed: number, key: string): Promise<void> {
    try {
      const audioBuffer = await this.callAPI(text, voice, speed);
      await fsp.mkdir(this.tempDir, { recursive: true });
      const tempFile = path.join(this.tempDir, `pre-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
      await fsp.writeFile(tempFile, audioBuffer);
      // Keep the sliding window small: evict oldest entries if over cap.
      while (this.prefetchCache.size >= KokoroTTSEngine.PREFETCH_MAX) {
        const oldest = this.prefetchCache.keys().next().value;
        if (!oldest) break;
        const p = this.prefetchCache.get(oldest);
        this.prefetchCache.delete(oldest);
        if (p) await fsp.unlink(p).catch(() => {});
      }
      this.prefetchCache.set(key, tempFile);
    } catch {
      // prefetch is best-effort; a later speak() will fetch normally
    }
  }

  private hashKey(text: string, voice: string, speed: number): string {
    return `${voice}|${speed}|${text}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async stop(): Promise<void> {
    // NOTE: do NOT clear the prefetch cache here. speak() calls stop() on
    // entry as a concurrency guard, and clearing would destroy the audio
    // prefetched for the upcoming verses, forcing every verse into a cold
    // fetch (the "1 verse, long wait, 1 verse, long wait" bug). The cache
    // is text-keyed and self-evicting, so stale entries are harmless; it
    // is fully cleared in cleanup() on quit.
    if (this.currentProcess) {
      const proc = this.currentProcess;
      this.currentProcess = null;
      proc.kill('SIGTERM');
    }
    this.emitState({ status: 'idle' });
  }

  onStateChange(listener: (state: TTSState) => void): void {
    this.listener = listener;
  }

  /** Runtime voice/speed update (called from tts:update-config IPC). */
  updateConfig(voice?: string, speed?: number): void {
    if (voice) this.defaultVoice = voice;
    if (speed != null) this.defaultSpeed = speed;
  }

  /** Clean up leftover temp files (called on app quit). */
  cleanup(): void {
    this.clearPrefetch();
    try {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  private clearPrefetch(): void {
    for (const p of this.prefetchCache.values()) {
      try {
        fs.unlinkSync(p);
      } catch {
        // ignore
      }
    }
    this.prefetchCache.clear();
  }

  private emitState(state: TTSState): void {
    this.listener?.(state);
  }

  /**
   * Fetch TTS audio for `text` from OpenRouter, retrying transient failures.
   *
   * Retry policy: network/transport failures (DNS, connection refused, reset,
   * timeout) and HTTP 429/5xx are retried up to MAX_RETRIES times with
   * exponential backoff + jitter. Permanent 4xx errors (401 auth, 400, etc.)
   * fail immediately. This prevents a brief network blip from aborting a
   * whole chapter run.
   */
  private async callAPI(text: string, voice: string, speed: number): Promise<Buffer> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await this.delay(this.backoffMs(attempt));
      }
      try {
        return await this.callAPISingle(text, voice, speed);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (!this.isRetryableRequestError(e) || attempt === MAX_RETRIES) {
          throw e;
        }
        lastError = e;
      }
    }
    throw lastError ?? new Error('TTS request failed');
  }

  /** One raw HTTP attempt. No retry logic here. */
  private async callAPISingle(text: string, voice: string, speed: number): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(OPENROUTER_TTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/Samthesurf/bible-app',
          'X-Title': 'Bible App TTS',
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          input: text,
          voice,
          response_format: 'mp3',
          speed,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const err = new Error(
          `OpenRouter TTS API error ${response.status}: ${body.slice(0, 300)}`,
        ) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Whether a request failure is worth retrying (transient vs permanent). */
  private isRetryableRequestError(err: Error): boolean {
    // HTTP status errors carry a `status` property set in callAPISingle.
    const status = (err as Error & { status?: number }).status;
    if (typeof status === 'number') {
      // 429 (rate limit) and 5xx (server-side) are transient.
      return status === 429 || status >= 500;
    }
    // Everything else thrown by fetch (ECONNRESET, ENOTFOUND, ETIMEDOUT,
    // "fetch failed", timeout AbortError) is a network/transport failure.
    return true;
  }

  /** Exponential backoff with jitter: ~500ms, 1s, 2s, 4s for retries 1..4. */
  private backoffMs(attempt: number): number {
    const base = RETRY_BASE_MS * Math.pow(2, attempt - 1);
    return Math.round(base * (0.8 + Math.random() * 0.4));
  }

  private playAudio(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('mpv', ['--no-video', '--really-quiet', filePath], {
        stdio: 'ignore',
      });

      this.currentProcess = proc;

      proc.on('close', (code) => {
        if (this.currentProcess === proc) {
          this.currentProcess = null;
        }
        if (code === 0 || code === null) {
          resolve();
        } else {
          // Killed by signal = intentional stop
          reject(new Error('TTS_STOPPED'));
        }
      });

      proc.on('error', (err) => {
        this.currentProcess = null;
        reject(new Error(`Audio player error: ${err.message}. Is mpv installed?`));
      });
    });
  }
}
