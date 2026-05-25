# Study Capture Desktop MVP Specification

## Goal

Build a local-first desktop app for Windows and macOS that shortens Islamic studies review time.

Core flow:

`audio -> Rubai raw transcript -> book search -> corrected transcript -> topic split -> notes/flashcards/review list`

## Product Boundaries

- Local-first
- Self-hostable local desktop app
- Windows and macOS local use
- No SaaS backend
- No raw audio upload to OpenAI or any cloud STT

## Core Decision

Audio transcription is strictly local with Rubai:

- model: `islomov/rubaistt_v2_medium`
- runtime: `faster-whisper`
- model format: CTranslate2 int8
- model folder: `RUBAI_CT2_MODEL_PATH`, or `~/Desktop/whisper-tools/models/rubai-rubaistt-v2-medium-ct2-int8` by default
- Python runtime: `RUBAI_PYTHON_PATH`, or `.venv-rubai` inside the project by default

OpenAI-compatible providers are used only after local transcription for text-only:

- transcript correction
- Arabic and aqida terminology repair
- topic extraction assistance where needed
- study notes, flashcards, and review checklist

## Tech Stack

- Electron
- React
- TypeScript
- Vite
- Tailwind CSS
- Node.js
- Python worker for Rubai ASR
- `faster-whisper` + CTranslate2
- `electron-store`
- Markdown and JSON export

## Target Folder Structure

```txt
study-capture/
  src/
    main/
      main.ts
      ipc.ts
      store.ts
      audio-chunks.ts
      rubai-runner.ts
      book-store.ts
      openai-client.ts
      file-system.ts
    preload/
      preload.ts
    renderer/
      App.tsx
      audio-recorder.ts
      transcription-session.ts
      components/
        SettingsScreen.tsx
        Dashboard.tsx
        BookScreen.tsx
        HistoryScreen.tsx
        RecorderControls.tsx
        SourcePicker.tsx
        TranscriptEditor.tsx
```

## MVP Features

### Settings

- Save AI provider API key locally
- Save AI provider base URL
- Save correction model and summary model
- Save preferred adaptive chunk target, default `30` seconds
- Save export folder
- No Whisper paths are required

### Source Picker and Capture

- Use Electron `desktopCapturer`
- Capture Chrome, Meet, other windows, or screen audio
- Save chunks locally
- Queue transcription so only one chunk is `transcribing`

### Local Rubai ASR

Flow:

`audio chunk -> Rubai worker -> raw transcript chunk -> session rawTranscript`

Requirements:

- validate Rubai runtime before recording
- show failed chunk state
- support retry
- keep raw audio local

### Book Context

MVP book support:

- manual text import
- `.txt` import
- local storage
- heading/topic segmentation
- Hybrid-lite normalized keyword search
- selected snippets as correction and summary evidence

No vector DB in the first version.

### Correction and Study Notes

Correction must:

- preserve meaning
- use book snippets only as evidence
- repair Uzbek, Arabic, and Islamic terminology when supported by context
- mark unclear parts as `[noaniq]`
- never invent missing content

Study notes must produce:

- main topic
- key points
- aqida terms
- book-related evidence
- test points
- quick review
- flashcards
- unclear parts

### Export and History

Each session should export:

- Markdown
- JSON
- raw transcript
- corrected transcript
- summary
- topics
- review items
- book context used

## Acceptance Criteria

MVP is complete when:

- app runs locally on Windows and macOS
- settings persist
- Rubai runtime status is visible
- audio chunks are captured locally
- Rubai transcription works
- book import and search work
- selected snippets feed the correction workflow
- corrected transcript and notes generate from text only
- export and history work
- no raw audio reaches OpenAI or any cloud service
