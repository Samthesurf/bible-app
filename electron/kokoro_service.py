#!/usr/bin/env python3
"""Persistent Kokoro-onnx TTS service.

Reads one JSON request per line from stdin:
    {"text": "...", "voice": "af_heart", "speed": 1.0}
Writes one JSON result line to stdout:
    {"ok": true, "path": "/tmp/xxx.wav"}
    {"ok": false, "error": "..."}
Logs go to stderr only, so stdout stays a clean protocol channel.

The model is loaded once and kept resident for fast subsequent requests.
"""
import json
import os
import sys
import tempfile
import time

import numpy as np

MODEL_DIR = os.path.join(os.path.expanduser("~"), ".local", "share", "bible-app-kokoro")
MODEL_PATH = os.environ.get("KOKORO_MODEL") or os.path.join(MODEL_DIR, "kokoro-v1.0.onnx")
VOICES_PATH = os.path.join(MODEL_DIR, "voices-v1.0.bin")


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def synthesize(kokoro, text: str, voice: str, speed: float, out_path: str) -> None:
    samples, sample_rate = kokoro.create(text, voice=voice, speed=speed, lang="en-us")

    import wave

    wav = wave.open(out_path, "wb")
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(sample_rate)
    wav.writeframes((samples * 32767).astype(np.int16).tobytes())
    wav.close()


def main() -> None:
    from kokoro_onnx import Kokoro

    os.makedirs(MODEL_DIR, exist_ok=True)
    log("loading kokoro model from %s ..." % MODEL_PATH)
    kokoro = Kokoro(MODEL_PATH, VOICES_PATH)
    log("kokoro service ready (model loaded)")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            text = str(req.get("text", ""))
            voice = str(req.get("voice", "af_heart"))
            speed = float(req.get("speed", 1.0))
            if not text:
                print(json.dumps({"ok": False, "error": "empty text"}), flush=True)
                continue
            fd, out_path = tempfile.mkstemp(suffix=".wav", prefix="kokoro-")
            os.close(fd)
            t0 = time.time()
            synthesize(kokoro, text, voice, speed, out_path)
            log("synthesized %d chars in %.2fs -> %s" % (len(text), time.time() - t0, out_path))
            print(json.dumps({"ok": True, "path": out_path}), flush=True)
        except Exception as exc:  # noqa: BLE001
            log("error: %r" % exc)
            print(json.dumps({"ok": False, "error": str(exc)}), flush=True)


if __name__ == "__main__":
    main()