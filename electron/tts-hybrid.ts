import fs from 'fs';
import fsp from 'fs/promises';
import { spawn, type ChildProcess } from 'child_process';
import type { TTSEngine, TTSOptions, TTSState } from './tts-stub';
import { KokoroTTSEngine } from './tts-kokoro';
import { LocalKokoroTTSEngine } from './tts-local';

/**
 * Hybrid TTS engine.
 *
 * Playback strategy (verse by verse):
 *  1. If the local cache has this text -> play the cached WAV instantly
 *     (free, offline, zero latency).
 *  2. Otherwise play via OpenRouter (fast live playback) and, in the
 *     background, ask the local model to synthesize the SAME text into the
 *     persistent cache. The next time that verse is played, step 1 hits.
 *
 * So the first pass through a chapter costs a few cents of OpenRouter
 * credits; repeat readings play entirely from the free local cache.
 */
export class HybridTTSEngine implements TTSEngine {
  private openrouter: KokoroTTSEngine;
  private local: LocalKokoroTTSEngine;
  private listener: ((state: TTSState) => void) | null = null;
  private currentProcess: ChildProcess | null = null;
  private defaultVoice = 'af_heart';
  private defaultSpeed = 1.0;
  private lastSource: 'local' | 'openrouter' | 'none' = 'none';

  constructor(openrouter: KokoroTTSEngine, local: LocalKokoroTTSEngine) {
    this.openrouter = openrouter;
    this.local = local;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.openrouter.isAvailable()) || (await this.local.isAvailable());
  }

  async speak(text: string, options?: TTSOptions): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('TTS engine not configured');
    }
    await this.stop();

    const voice = options?.voice ?? this.defaultVoice;
    const speed = options?.rate ?? this.defaultSpeed;

    this.emitState({ status: 'speaking', text });
    try {
      const cached = this.local.getCachedPath(text, voice, speed);
      if (cached) {
        // Cache hit: play locally, instantly.
        this.lastSource = 'local';
        await this.playFile(cached);
        this.emitState({ status: 'idle' });
        return;
      }

      // Cache miss: play via OpenRouter now, warm the cache in background.
      this.lastSource = 'openrouter';
      void this.local.generateAndCache(text, voice, speed);
      await this.openrouter.speak(text, options);
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

  async prefetch(text: string, options?: TTSOptions): Promise<void> {
    if (!(await this.isAvailable())) return;
    const voice = options?.voice ?? this.defaultVoice;
    const speed = options?.rate ?? this.defaultSpeed;

    // If the cache already has it, nothing to do — playback will be instant.
    if (this.local.isCached(text, voice, speed)) return;

    // Prefetch the OpenRouter audio for instant live playback. (Local
    // warming is intentionally NOT done here: it would flood the slow
    // single-threaded local service with 3-ahead jobs every verse. The
    // current verse is warmed in speak() instead.)
    await this.openrouter.prefetch(text, options);
  }

  async stop(): Promise<void> {
    if (this.currentProcess) {
      const proc = this.currentProcess;
      this.currentProcess = null;
      proc.kill('SIGTERM');
    }
    await this.openrouter.stop();
    await this.local.stop();
    this.emitState({ status: 'idle' });
  }

  onStateChange(listener: (state: TTSState) => void): void {
    this.listener = listener;
  }

  updateConfig(voice?: string, speed?: number): void {
    if (voice) this.defaultVoice = voice;
    if (speed != null) this.defaultSpeed = speed;
    this.openrouter.updateConfig(voice, speed);
    this.local.updateConfig(voice, speed);
  }

  cleanup(): void {
    this.openrouter.cleanup();
    this.local.cleanup();
  }

  private emitState(state: TTSState): void {
    this.listener?.(state);
  }

  private playFile(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('mpv', ['--no-video', '--really-quiet', filePath], { stdio: 'ignore' });
      this.currentProcess = proc;
      proc.on('close', (code) => {
        if (this.currentProcess === proc) this.currentProcess = null;
        if (code === 0 || code === null) resolve();
        else reject(new Error('TTS_STOPPED'));
      });
      proc.on('error', (err) => {
        this.currentProcess = null;
        reject(new Error(`Audio player error: ${err.message}. Is mpv installed?`));
      });
    });
  }

  /** For diagnostics/tests: cache stats + which backend last played. */
  getStats(): { cached: number; lastSource: string } {
    const stats = this.cacheStats();
    return { cached: stats.cached, lastSource: this.lastSource };
  }

  cacheStats(): { cached: number; dir: string } {
    const dir = (this.local as unknown as { cacheDir: string }).cacheDir;
    let count = 0;
    try {
      count = fs.readdirSync(dir).filter((f) => f.endsWith('.wav')).length;
    } catch {
      // ignore
    }
    return { cached: count, dir };
  }
}