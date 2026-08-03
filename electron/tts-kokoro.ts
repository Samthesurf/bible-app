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
  private prefetchInFlight = false;
  private readonly prefetchQueue: { text: string; voice: string; speed: number; key: string }[] = [];
  private readonly prefetchQueued = new Set<string>();
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
        const audioBuffer = await this.callAPI(text, voice, speed);
        await fsp.mkdir(this.tempDir, { recursive: true });
        tempFile = path.join(this.tempDir, `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
        await fsp.writeFile(tempFile, audioBuffer);
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
   * verses). Requests queue up (multiple verses ahead) and drain in order;
   * failures are best-effort.
   */
  async prefetch(text: string, options?: TTSOptions): Promise<void> {
    if (!(await this.isAvailable())) return;
    const voice = options?.voice ?? this.defaultVoice;
    const speed = options?.rate ?? this.defaultSpeed;
    const key = this.hashKey(text, voice, speed);
    if (this.prefetchCache.has(key)) return; // already fetched
    if (this.prefetchQueued.has(key)) return; // already queued
    this.prefetchQueued.add(key);
    this.prefetchQueue.push({ text, voice, speed, key });
    void this.drainPrefetch();
  }

  /** Process the prefetch queue sequentially. */
  private async drainPrefetch(): Promise<void> {
    if (this.prefetchInFlight) return;
    this.prefetchInFlight = true;
    try {
      while (this.prefetchQueue.length > 0) {
        const job = this.prefetchQueue.shift();
        if (!job) break;
        this.prefetchQueued.delete(job.key);
        try {
          const audioBuffer = await this.callAPI(job.text, job.voice, job.speed);
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
          this.prefetchCache.set(job.key, tempFile);
        } catch {
          // prefetch is best-effort; a later speak() will fetch normally
        }
      }
    } finally {
      this.prefetchInFlight = false;
    }
  }

  private hashKey(text: string, voice: string, speed: number): string {
    return `${voice}|${speed}|${text}`;
  }

  async stop(): Promise<void> {
    if (this.currentProcess) {
      const proc = this.currentProcess;
      this.currentProcess = null;
      proc.kill('SIGTERM');
    }
    this.clearPrefetch();
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

  private async callAPI(text: string, voice: string, speed: number): Promise<Buffer> {
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
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenRouter TTS API error ${response.status}: ${body.slice(0, 300)}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
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
