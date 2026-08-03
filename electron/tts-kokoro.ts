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
      // 1. Call OpenRouter
      const audioBuffer = await this.callAPI(text, voice, speed);

      // 2. Write to a unique temp file
      await fsp.mkdir(this.tempDir, { recursive: true });
      const tempFile = path.join(this.tempDir, `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
      await fsp.writeFile(tempFile, audioBuffer);

      // 3. Play via mpv (headless)
      await this.playAudio(tempFile);

      // 4. Cleanup
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

  async stop(): Promise<void> {
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
    try {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
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
