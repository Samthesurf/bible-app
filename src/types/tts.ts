export type TTSState =
  | { status: 'idle' }
  | { status: 'speaking'; text: string }
  | { status: 'paused' }
  | { status: 'error'; message: string }
  | { status: 'unavailable'; message: string };
