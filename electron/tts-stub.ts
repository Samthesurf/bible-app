/**
 * TTS engine adapter.
 *
 * The renderer talks to this through the `tts:*` IPC channels only, so
 * swapping in a real engine is a one-line change in electron/main.ts:
 *
 *   const ttsEngine: TTSEngine = new StubTTSEngine();
 *   // → const ttsEngine: TTSEngine = new MyRealEngine();
 *
 * A real engine must emit state changes via onStateChange so the renderer
 * can show playing/stopped UI.
 */

export interface TTSOptions {
  rate?: number; // 0.5 - 2.0, default 1.0
  pitch?: number; // 0.5 - 2.0, default 1.0
  voice?: string; // voice identifier
}

export type TTSState =
  | { status: 'idle' }
  | { status: 'speaking'; text: string }
  | { status: 'paused' }
  | { status: 'error'; message: string }
  | { status: 'unavailable'; message: string };

export interface TTSEngine {
  isAvailable(): Promise<boolean>;
  speak(text: string, options?: TTSOptions): Promise<void>;
  stop(): Promise<void>;
  onStateChange(listener: (state: TTSState) => void): void;
}

/** Placeholder engine: reports unavailable until the user wires a real one. */
export class StubTTSEngine implements TTSEngine {
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async speak(_text: string): Promise<void> {
    throw new Error('TTS engine not configured. See electron/tts-stub.ts to wire your engine.');
  }

  async stop(): Promise<void> {
    // no-op
  }

  onStateChange(listener: (state: TTSState) => void): void {
    listener({ status: 'unavailable', message: 'No TTS engine configured' });
  }
}
