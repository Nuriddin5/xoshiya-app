import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

MODEL_ID = "islomov/rubaistt_v2_medium"
DEFAULT_CPU_THREADS = 4
DEFAULT_MODEL_NUM_WORKERS = 2
DEFAULT_VAD_FILTER = True
DEFAULT_CONDITION_ON_PREVIOUS_TEXT = False
WORKER_CONCURRENCY = 2

def load_faster_whisper_backend():
    load_started_at = time.perf_counter()
    model_path = os.environ.get("RUBAI_CT2_MODEL_PATH", "").strip()
    if not model_path:
        raise RuntimeError("RUBAI_CT2_MODEL_PATH is required.")

    resolved_model_path = Path(model_path).expanduser().resolve()
    if not resolved_model_path.is_dir():
        raise RuntimeError(f"Rubai CT2 model directory was not found: {resolved_model_path}")

    from faster_whisper import WhisperModel

    cpu_threads = int(os.environ.get("RUBAI_CPU_THREADS", DEFAULT_CPU_THREADS))
    model_num_workers = int(os.environ.get("RUBAI_MODEL_NUM_WORKERS", DEFAULT_MODEL_NUM_WORKERS))
    model = WhisperModel(
        str(resolved_model_path),
        device="cpu",
        compute_type=os.environ.get("RUBAI_COMPUTE_TYPE", "int8"),
        cpu_threads=cpu_threads,
        num_workers=model_num_workers,
    )

    def transcribe(audio_path):
        segments, _info = model.transcribe(
            str(audio_path),
            language="uz",
            task="transcribe",
            beam_size=1,
            vad_filter=DEFAULT_VAD_FILTER,
            condition_on_previous_text=DEFAULT_CONDITION_ON_PREVIOUS_TEXT,
        )
        return " ".join(segment.text.strip() for segment in segments).strip()

    return {
        "name": "faster-whisper",
        "model": str(resolved_model_path),
        "modelLoadMs": round((time.perf_counter() - load_started_at) * 1000),
        "transcribe": transcribe,
    }

emit_lock = threading.Lock()

def emit(payload):
    with emit_lock:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()

def process_request(request, backend):
    request_id = request.get("id")
    started_at = time.perf_counter()
    try:
        audio_path_value = request.get("audioPath")
        if not isinstance(request_id, str) or not request_id:
            raise ValueError("Request id is required.")
        if not isinstance(audio_path_value, str) or not audio_path_value.strip():
            raise ValueError("audioPath is required.")

        audio_path = Path(audio_path_value).expanduser().resolve()
        text = backend["transcribe"](audio_path)
        processing_ms = round((time.perf_counter() - started_at) * 1000)
        emit({
            "type": "result",
            "id": request_id,
            "text": text,
            "processingMs": processing_ms,
        })
    except Exception as error:  # pragma: no cover
        processing_ms = round((time.perf_counter() - started_at) * 1000)
        emit({"type": "error", "id": request_id, "error": str(error), "processingMs": processing_ms})

def main():
    try:
        backend = load_faster_whisper_backend()
        emit({
            "type": "ready",
            "model": backend["model"],
            "backend": backend["name"],
            "modelLoadMs": backend.get("modelLoadMs"),
        })
    except Exception as error:  # pragma: no cover
        emit({"type": "fatal", "error": str(error)})
        return 1

    with ThreadPoolExecutor(max_workers=WORKER_CONCURRENCY) as executor:
        for raw_line in sys.stdin:
            line = raw_line.strip()
            if not line:
                continue

            try:
                request = json.loads(line)
                if not isinstance(request, dict):
                    raise ValueError("Request must be a JSON object.")
                executor.submit(process_request, request, backend)
            except Exception as error:  # pragma: no cover
                # If parsing fails before we know the ID
                emit({"type": "error", "id": None, "error": str(error)})

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
