# Xoshiya App

Xoshiya App is a local-first Electron desktop app for recording lessons, transcribing audio with a local Rubai ASR model, and generating book-grounded study material with an OpenAI-compatible text provider.

Core flow:

```txt
desktop audio -> local Rubai transcript -> book search -> text-only AI polishing -> study notes and exports
```

## Features

- Capture desktop or window audio from the Electron app.
- Transcribe audio locally with Rubai STT through `faster-whisper` and CTranslate2.
- Import local books from text, PDF, or DOCX files.
- Search imported book sections and use snippets as evidence for lesson polishing.
- Generate corrected transcripts, summaries, key points, terms, flashcards, review questions, and source references.
- Save session history and exports as local Markdown and JSON files.
- Keep app settings, API keys, imported book metadata, and generated output on the local machine.

## Privacy Model

- Raw audio stays on your computer.
- Raw audio is not sent to OpenAI, DeepSeek, or any cloud speech-to-text service.
- Rubai ASR runs locally through a Python worker.
- OpenAI-compatible providers receive text only: transcript text, corrected text, lesson metadata, and selected book snippets.
- API keys are stored locally with `electron-store`.

## Requirements

- Windows 10/11 or macOS.
- Node.js 22.12 or newer recommended for packaging. Node.js 20.19 or newer can run the current dev/build flow.
- npm 10 or newer.
- Python 3.10 or newer.
- A local Python environment with `faster-whisper` and `ctranslate2`.
- A converted CTranslate2 int8 Rubai model for `islomov/rubaistt_v2_medium`.
- An OpenAI-compatible text provider API key for correction and study note generation.

The Rubai model is not committed to this repository and is not bundled into releases. Each self-hoster must download or convert it locally.

## Clone And Install

```bash
git clone <your-fork-or-repo-url>
cd xoshiya-app
npm install
```

If your checkout folder has spaces in the path, keep commands quoted where your shell requires it.

## Rubai ASR Setup

The app needs two local paths:

- `RUBAI_PYTHON_PATH`: Python executable inside the environment that has `faster-whisper` and `ctranslate2`.
- `RUBAI_CT2_MODEL_PATH`: folder containing the converted CTranslate2 Rubai model.

The converted model folder must contain:

```txt
model.bin
tokenizer.json
preprocessor_config.json
```

If `RUBAI_CT2_MODEL_PATH` is not set, the app falls back to:

```txt
~/Desktop/whisper-tools/models/rubai-rubaistt-v2-medium-ct2-int8
```

If `RUBAI_PYTHON_PATH` is not set, the app falls back to:

```txt
# Windows
.venv-rubai/Scripts/python.exe

# macOS/Linux
.venv-rubai/bin/python
```

### Windows Rubai Setup

```powershell
py -3.10 -m venv .venv-rubai
.\.venv-rubai\Scripts\python.exe -m pip install --upgrade pip
.\.venv-rubai\Scripts\python.exe -m pip install faster-whisper ctranslate2

$env:RUBAI_PYTHON_PATH = "$PWD\.venv-rubai\Scripts\python.exe"
$env:RUBAI_CT2_MODEL_PATH = "$HOME\Desktop\whisper-tools\models\rubai-rubaistt-v2-medium-ct2-int8"

& $env:RUBAI_PYTHON_PATH -c "import faster_whisper, ctranslate2"
Test-Path "$env:RUBAI_CT2_MODEL_PATH\model.bin"
```

### macOS Rubai Setup

```bash
python3 -m venv .venv-rubai
./.venv-rubai/bin/python -m pip install --upgrade pip
./.venv-rubai/bin/python -m pip install faster-whisper ctranslate2

export RUBAI_PYTHON_PATH="$PWD/.venv-rubai/bin/python"
export RUBAI_CT2_MODEL_PATH="$HOME/Desktop/whisper-tools/models/rubai-rubaistt-v2-medium-ct2-int8"

"$RUBAI_PYTHON_PATH" -c "import faster_whisper, ctranslate2"
test -f "$RUBAI_CT2_MODEL_PATH/model.bin"
```

For persistent environment variables, add the `export` lines to your shell profile on macOS, or set user environment variables in Windows System Properties.

### Optional Rubai Tuning

```txt
RUBAI_CPU_THREADS=4
RUBAI_MODEL_NUM_WORKERS=2
RUBAI_COMPUTE_TYPE=int8
```

Use lower values on smaller machines if local transcription makes the desktop sluggish.

## AI Provider Setup

Open Settings in the app and configure:

- AI provider: OpenAI or DeepSeek.
- API key.
- HTTPS base URL.
- correction model.
- summary model.
- save folders.
- preferred audio chunk target.

Defaults:

```txt
OpenAI base URL: https://api.openai.com/v1
DeepSeek base URL: https://api.deepseek.com
OpenAI default models: gpt-4.1-mini
DeepSeek default models: deepseek-chat
```

No Whisper binary or Whisper model path is needed in Settings.

## Run Locally

Windows PowerShell:

```powershell
$env:RUBAI_PYTHON_PATH = "$PWD\.venv-rubai\Scripts\python.exe"
$env:RUBAI_CT2_MODEL_PATH = "$HOME\Desktop\whisper-tools\models\rubai-rubaistt-v2-medium-ct2-int8"
npm run dev
```

macOS:

```bash
export RUBAI_PYTHON_PATH="$PWD/.venv-rubai/bin/python"
export RUBAI_CT2_MODEL_PATH="$HOME/Desktop/whisper-tools/models/rubai-rubaistt-v2-medium-ct2-int8"
npm run dev
```

The app validates the Rubai runtime before recording starts. If validation fails, the dashboard shows the missing path or dependency.

## Verify

```bash
npm test
npm run typecheck
npm run build
```

## Package

Windows portable build:

```bash
npm run dist:win
```

macOS DMG and ZIP build:

```bash
npm run dist:mac
```

The macOS build configuration is unsigned and not notarized. For public macOS distribution, add your own Apple Developer signing identity, hardened runtime settings, and notarization workflow.

Packaged builds still need a local Rubai Python runtime and the converted model path. Set `RUBAI_PYTHON_PATH` and `RUBAI_CT2_MODEL_PATH` before launching the app, or place a `.venv-rubai` folder where the packaged runtime expects it.

## Data Locations

- Settings and API keys: Electron app data through `electron-store`.
- Development exports: `Documents/StudyCaptureDev` by default.
- Packaged app exports: `Documents/StudyCapture` by default.
- Imported books and course metadata: local app settings store.
- Audio chunks: app-managed temporary files.

All paths can vary by OS and by the folders selected in Settings.

## Troubleshooting

### Local Rubai ASR runtime is not ready

Check that both paths are correct:

```bash
echo "$RUBAI_PYTHON_PATH"
echo "$RUBAI_CT2_MODEL_PATH"
```

On Windows PowerShell:

```powershell
$env:RUBAI_PYTHON_PATH
$env:RUBAI_CT2_MODEL_PATH
```

Then verify Python dependencies and model files:

```bash
"$RUBAI_PYTHON_PATH" -c "import faster_whisper, ctranslate2"
ls "$RUBAI_CT2_MODEL_PATH"
```

### Model folder exists but recording is blocked

Confirm the folder is a CTranslate2 export, not the original Hugging Face Transformers folder. It must include `model.bin`, `tokenizer.json`, and `preprocessor_config.json`.

### AI correction or notes fail

Open Settings and confirm the API key, HTTPS base URL, correction model, and summary model are valid for your provider.

### macOS cannot capture audio or screen

Open macOS System Settings and allow the app or terminal you launched it from to use Screen Recording and Microphone permissions. Restart the app after changing permissions.

## Development Notes

- Main process code owns filesystem access, Rubai worker execution, and text-provider requests.
- Renderer code talks to the main process through the preload bridge.
- Text-provider calls must remain text-only.
- Do not commit local model files, virtualenvs, API keys, generated release artifacts, or local exports.

## License

MIT. See [LICENSE](LICENSE).
