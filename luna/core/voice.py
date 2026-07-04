"""Voice: sounddevice recording, lazy faster-whisper STT, pyttsx3 TTS fallback.

RAM discipline (SPEC §9): the whisper ``tiny.en`` int8 model is loaded on
first use only, and a background timer unloads it after 5 minutes of
inactivity. Recording and transcription never run concurrently with an LLM
call — the route awaits transcription before the chat request is made.

Every path is defensive: any mic/model failure returns an ``error`` string
instead of raising, and :func:`is_available` feeds the ``voice`` field of
``/api/health``.
"""

from __future__ import annotations

import threading
import time
from typing import Any

import numpy as np

from luna.config import (
    VOICE_SAMPLE_RATE,
    WHISPER_IDLE_UNLOAD_SECONDS,
    WHISPER_MODEL_SIZE,
    get_data_dir,
)

_lock = threading.Lock()
_stream: Any = None  # sounddevice.InputStream while recording
_chunks: list[np.ndarray] = []
_whisper_model: Any = None
_last_used: float = 0.0
_unload_timer: threading.Timer | None = None


def is_available() -> bool:
    """Cheap availability probe for /api/health: is there an input device?"""
    try:
        import sounddevice as sd

        devices = sd.query_devices()
        return any(d.get("max_input_channels", 0) > 0 for d in devices)
    except Exception:
        return False


def _schedule_unload() -> None:
    global _unload_timer
    if _unload_timer is not None:
        _unload_timer.cancel()

    def _maybe_unload() -> None:
        global _whisper_model
        with _lock:
            if _whisper_model is not None and time.monotonic() - _last_used >= WHISPER_IDLE_UNLOAD_SECONDS:
                _whisper_model = None  # release ~75 MB of RAM

    _unload_timer = threading.Timer(WHISPER_IDLE_UNLOAD_SECONDS + 5, _maybe_unload)
    _unload_timer.daemon = True
    _unload_timer.start()


def _get_whisper() -> Any:
    """Lazy singleton for the faster-whisper model (download on first use)."""
    global _whisper_model, _last_used
    with _lock:
        if _whisper_model is None:
            from faster_whisper import WhisperModel

            _whisper_model = WhisperModel(
                WHISPER_MODEL_SIZE,
                device="cpu",
                compute_type="int8",
                download_root=str(get_data_dir() / "whisper_models"),
            )
        _last_used = time.monotonic()
    _schedule_unload()
    return _whisper_model


def start_recording() -> dict[str, Any]:
    """Begin capturing 16 kHz mono audio. Returns {ok: true} or {error}."""
    global _stream, _chunks
    try:
        import sounddevice as sd

        with _lock:
            if _stream is not None:
                return {"ok": True, "note": "already recording"}
            _chunks = []

            def _callback(indata: np.ndarray, frames: int, time_info: Any, status: Any) -> None:
                _chunks.append(indata.copy())

            _stream = sd.InputStream(
                samplerate=VOICE_SAMPLE_RATE,
                channels=1,
                dtype="float32",
                callback=_callback,
            )
            _stream.start()
        return {"ok": True}
    except Exception as exc:
        _stream = None
        return {"error": f"Microphone unavailable: {exc}"}


def stop_recording_and_transcribe() -> dict[str, Any]:
    """Stop capture and run STT. Returns {text} or {error}."""
    global _stream
    try:
        with _lock:
            if _stream is None:
                return {"error": "Not recording."}
            _stream.stop()
            _stream.close()
            _stream = None
            chunks = list(_chunks)
            _chunks.clear()
        if not chunks:
            return {"text": ""}
        audio = np.concatenate(chunks).flatten().astype(np.float32)
        if audio.size < VOICE_SAMPLE_RATE // 4:  # under ~250 ms — nothing said
            return {"text": ""}
        model = _get_whisper()
        segments, _info = model.transcribe(audio, language="en", beam_size=1, vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return {"text": text}
    except Exception as exc:
        _stream = None
        return {"error": f"Transcription failed: {exc}"}


def speak(text: str) -> dict[str, Any]:
    """Blocking pyttsx3 TTS (fallback — frontend prefers speechSynthesis)."""
    text = text.strip()
    if not text:
        return {"error": "Nothing to speak."}
    try:
        import pyttsx3

        engine = pyttsx3.init()
        engine.say(text[:1_000])
        engine.runAndWait()
        try:
            engine.stop()
        except Exception:
            pass
        return {"ok": True}
    except Exception as exc:
        return {"error": f"TTS unavailable: {exc}"}
