import { spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import type { TTSEngine, TTSOptions, TTSState } from './tts-stub';

const DEFAULT_VOICE = 'af_heart';
const DEFAULT_SPEED = 1.0;

/**
 * Local Kokoro-onnx TTS engine. Spawns a persistent Python service that loads
 * the small Kokoro-82M model once and synthesizes WAV on demand — no network,
 * no OpenRouter credits. Falls back to the OpenRouter engine when the local
 * stack is unavailable.
 */
export class LocalKokoroTTSEngine implements TTSEngine {
  private defaultVoice: string;
  private defaultSpeed: number;
  private listener: ((state: TTSState) => void) | null = null;
  private currentProcess: ChildProcess | null = null;
  private service: ChildProcess | null = null;
  private stdoutBuffer = '';
  private pending: { resolve: (p: string) => void; reject: (e: Error) => void } | null = null;
  private available: boolean | null = null;
  private readonly servicePath: string;
  private readonly pythonPath: string;
  private readonly cacheDir: string;

  constructor(config: { voice?: string; speed?: number; servicePath?: string; pythonPath?: string }) {
    this.defaultVoice = config.voice ?? DEFAULT_VOICE;
    this.defaultSpeed = config.speed ?? DEFAULT_SPEED;
    this.servicePath = config.servicePath ?? this.resolveServicePath();
    this.pythonPath = config.pythonPath ?? this.resolvePythonPath();
    this.cacheDir = path.join(
      process.env.XDG_CACHE_HOME || path.join(app.getPath('home'), '.cache'),
      'bible-app-kokoro',
      'cache',
    );
  }

  private resolveServicePath(): string {
    // Dev: electron/kokoro_service.py. Packaged: resources/electron/kokoro_service.py
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'electron', 'kokoro_service.py');
    }
    return path.join(app.getAppPath(), 'electron', 'kokoro_service.py');
  }

  private resolvePythonPath(): string {
    // Local venv lives next to the app (dev) or in resources (packaged).
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'tts-venv', 'bin', 'python');
    }
    return path.join(app.getAppPath(), 'tts-venv', 'bin', 'python');
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    // Hoist the check: only report available if the service actually starts.
    this.available = false;
    try {
      if (!fs.existsSync(this.pythonPath)) return false;
      if (!fs.existsSync(this.servicePath)) return false;
      const svc = await this.startService();
      this.available = svc !== null;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  private startService(): Promise<ChildProcess | null> {
    if (this.service && this.service.exitCode === null) return Promise.resolve(this.service);
    return new Promise((resolve) => {
      const svc = spawn(this.pythonPath, ['-u', this.servicePath], {
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      this.service = svc;
      svc.stdout?.setEncoding('utf8');
      svc.stdout?.on('data', (chunk: string) => {
        this.stdoutBuffer += chunk;
        const nl = this.stdoutBuffer.indexOf('\n');
        if (nl >= 0) {
          const line = this.stdoutBuffer.slice(0, nl).trim();
          this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
          if (line) this.handleLine(line);
        }
      });
      svc.on('error', () => {
        this.available = false;
        if (this.pending) {
          this.pending.reject(new Error('Failed to start local Kokoro service'));
          this.pending = null;
        }
        resolve(null);
      });
      svc.on('exit', () => {
        this.service = null;
        if (this.pending) {
          this.pending.reject(new Error('Local Kokoro service exited'));
          this.pending = null;
        }
      });
      // Give it a moment to load the model before returning.
      setTimeout(() => resolve(svc.exitCode === null ? svc : null), 1500);
    });
  }

  private handleLine(line: string): void {
    if (!this.pending) return;
    const { resolve, reject } = this.pending;
    this.pending = null;
    try {
      const msg = JSON.parse(line);
      if (msg.ok) resolve(msg.path);
      else reject(new Error(msg.error || 'Local Kokoro generation failed'));
    } catch {
      reject(new Error('Malformed response from local Kokoro service'));
    }
  }

  private synth(text: string, voice: string, speed: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.service || this.service.exitCode !== null) {
        reject(new Error('Local Kokoro service not running'));
        return;
      }
      this.pending = { resolve, reject };
      this.service.stdin?.write(JSON.stringify({ text, voice, speed }) + '\n');
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Persistent local cache (background warming)                        */
  /* ------------------------------------------------------------------ */

  private hashKey(text: string, voice: string, speed: number): string {
    return crypto.createHash('sha1').update(`${voice}|${speed}|${text}`).digest('hex');
  }

  getCachedPath(text: string, voice: string, speed: number): string | null {
    const p = path.join(this.cacheDir, `${this.hashKey(text, voice, speed)}.wav`);
    try {
      return fs.existsSync(p) && fs.statSync(p).size > 1000 ? p : null;
    } catch {
      return null;
    }
  }

  isCached(text: string, voice: string, speed: number): boolean {
    return this.getCachedPath(text, voice, speed) !== null;
  }

  /**
   * Synthesize to the persistent cache (background). Resolves with the
   * cached WAV path, or null on failure. Never throws to the caller.
   */
  async generateAndCache(text: string, voice: string, speed: number): Promise<string | null> {
    if (!(await this.isAvailable())) return null;
    const target = this.getCachedPath(text, voice, speed);
    if (target) return target; // already cached
    try {
      const wavPath = await this.synth(text, voice, speed);
      await fsp.mkdir(this.cacheDir, { recursive: true });
      const dest = path.join(this.cacheDir, `${this.hashKey(text, voice, speed)}.wav`);
      // The service writes to /tmp (often tmpfs) while the cache lives on the
      // home disk — real rename() across filesystems throws EXDEV, so copy.
      await fsp.copyFile(wavPath, dest);
      await fsp.unlink(wavPath).catch(() => {});
      return dest;
    } catch {
      return null;
    }
  }

  async speak(text: string, options?: TTSOptions): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('Local TTS engine not configured');
    }
    await this.stop();

    const voice = options?.voice ?? this.defaultVoice;
    const speed = options?.rate ?? this.defaultSpeed;

    this.emitState({ status: 'speaking', text });
    try {
      const wavPath = await this.synth(text, voice, speed);
      await this.playAudio(wavPath);
      await fsp.unlink(wavPath).catch(() => {});
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

  async prefetch(_text: string): Promise<void> {
    // Local synthesis is fast (~sub-second); no prefetch needed.
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

  updateConfig(voice?: string, speed?: number): void {
    if (voice) this.defaultVoice = voice;
    if (speed != null) this.defaultSpeed = speed;
  }

  cleanup(): void {
    try {
      this.service?.kill('SIGTERM');
    } catch {
      // ignore
    }
  }

  private emitState(state: TTSState): void {
    this.listener?.(state);
  }

  private playAudio(filePath: string): Promise<void> {
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
}