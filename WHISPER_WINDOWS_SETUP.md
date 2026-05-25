# Local Rubai ASR Setup

This project no longer requires Whisper paths in Settings. The active local transcription backend is Rubai through `faster-whisper` and a CTranslate2 int8 model.

The complete self-host instructions now live in [README.md](README.md). This file is kept as a compatibility checklist for older references.

## Runtime Paths

The app reads these environment variables when they are set:

```txt
RUBAI_PYTHON_PATH
RUBAI_CT2_MODEL_PATH
```

Defaults:

```txt
Windows Python: .venv-rubai/Scripts/python.exe
macOS/Linux Python: .venv-rubai/bin/python
Model folder: ~/Desktop/whisper-tools/models/rubai-rubaistt-v2-medium-ct2-int8
```

## Converted Model Expectations

The model directory must be a converted CTranslate2 export, not the original Hugging Face Transformers folder.

Expected files:

- `model.bin`
- `tokenizer.json`
- `preprocessor_config.json`

If any of those files are missing, the app refuses to start recording and shows the missing path in the Rubai status area.

## Quick Check

Windows PowerShell:

```powershell
$env:RUBAI_PYTHON_PATH = "$PWD\.venv-rubai\Scripts\python.exe"
$env:RUBAI_CT2_MODEL_PATH = "$HOME\Desktop\whisper-tools\models\rubai-rubaistt-v2-medium-ct2-int8"
& $env:RUBAI_PYTHON_PATH -c "import faster_whisper, ctranslate2"
Test-Path "$env:RUBAI_CT2_MODEL_PATH\model.bin"
```

macOS:

```bash
export RUBAI_PYTHON_PATH="$PWD/.venv-rubai/bin/python"
export RUBAI_CT2_MODEL_PATH="$HOME/Desktop/whisper-tools/models/rubai-rubaistt-v2-medium-ct2-int8"
"$RUBAI_PYTHON_PATH" -c "import faster_whisper, ctranslate2"
test -f "$RUBAI_CT2_MODEL_PATH/model.bin"
```

Expected:

- Python import succeeds.
- Model file check succeeds.

## Notes

- Recommended chunk duration is `30` seconds or less for lower capture latency.
- Rubai runs through a persistent Python `faster-whisper` worker using a CTranslate2 int8 model.
- The dashboard Rubai status shows worker state, backlog count, model load time, startup time, and last chunk timing when available.
- Raw audio remains local and is never sent to OpenAI or another cloud service.
