# Architecture

## High-Level Modules

### Main Process

Responsibilities:

- app lifecycle
- `BrowserWindow` creation
- secure IPC registration
- desktop source enumeration
- local file IO
- Rubai local ASR worker execution
- OpenAI text-only request execution
- session history listing
- settings persistence
- shell open file/folder actions

Suggested files:

- `src/main/main.ts`
- `src/main/ipc.ts`
- `src/main/store.ts`
- `src/main/file-system.ts`
- `src/main/rubai-runner.ts`
- `src/main/openai-client.ts`
- `src/main/book-store.ts`

### Preload

Responsibilities:

- define narrow bridge API
- validate IPC payload shape where practical
- expose only allowed functions to renderer

Suggested file:

- `src/preload/preload.ts`

### Renderer

Responsibilities:

- screen routing
- user actions
- recorder orchestration
- transcript state
- correction and summary request orchestration through preload
- book search and snippet selection

Suggested files:

- `src/renderer/App.tsx`
- `src/renderer/components/*`
- `src/renderer/services/*`
- `src/renderer/types/*`
- `src/shared/lesson-analysis.ts`

## Core Runtime Flow

### Recording and Transcription

1. Renderer lists desktop sources via preload API.
2. User chooses source.
3. Renderer requests desktop media stream.
4. `MediaRecorder` records adaptive `25-40s` chunks, with renderer-side audio analysis looking for short pauses near the preferred boundary before the `40s` hard limit.
5. Each chunk is serialized and sent to main for temp file save.
6. Main returns local audio path.
7. Renderer calls `transcribeAudio(audioPath)`.
8. Main runs a persistent local Rubai Python worker backed by `faster-whisper` and CTranslate2 int8.
9. Main returns raw text.
10. Renderer appends transcript chunk to session state.

The Rubai worker is kept alive after the first transcription request, so the model is loaded once and reused across chunks. Renderer and main-process queues allow two concurrent local transcription jobs on Windows; extra chunks remain pending and are surfaced as backlog. Runtime status reports worker state, backlog, model load time, startup time, last queue delay, last processing time, and real-time factor when the renderer supplies chunk duration.

### Correction and Summary

1. Renderer collects full raw transcript.
2. Renderer derives lesson sections and section-level topics locally.
3. Renderer finds relevant book snippets.
4. Renderer calls a preload text-only correction API.
5. Main process loads the API key from local settings and sends only transcript text plus selected snippets to OpenAI.
6. Main process returns the corrected transcript.
7. Renderer calls a preload text-only summary API.
8. Main process sends only corrected transcript text plus selected snippets to OpenAI.
9. Main process returns structured Markdown notes.

### Save Session

1. Renderer sends `StudySession` payload to main.
2. Main generates normalized filenames.
3. Main writes `.md` and `.json`.
4. Main returns saved Markdown path.

## Trust Boundaries

### Renderer is Untrusted

Do not allow renderer direct access to:

- arbitrary filesystem writes
- arbitrary command execution
- unrestricted shell
- raw Node APIs

### Main Process is Trusted

Main process handles:

- file persistence
- running Rubai local ASR worker
- OpenAI SDK calls with text-only payloads
- path validation
- export path creation

## OpenAI Boundary

OpenAI SDK calls should live in the main process for MVP.

Reasons:

- the renderer does not need the raw API key
- text-only payload validation is easier to centralize
- request logging can be controlled in one place

Renderer services may assemble UI state, but final OpenAI requests must go through preload IPC methods.

## Recommended Storage Layout

### electron-store

Use for:

- app settings
- imported book metadata
- recent history index if useful

### Filesystem

Use for:

- temp audio chunks
- session markdown
- session JSON
- imported raw book text files if desired

## Error Domains

### Recording Errors

- no source audio
- permission failure
- invalid stream
- unsupported MIME type

### Rubai ASR Errors

- missing `RUBAI_PYTHON_PATH` or default `.venv-rubai` Python runtime
- missing `faster-whisper` or `ctranslate2`
- missing converted Rubai CT2 model
- worker timeout
- non-zero worker exit code
- empty transcript

### OpenAI Errors

- missing API key
- network failure
- 401 or invalid key
- model error
- malformed response

### File Errors

- invalid save folder
- write permission denied
- file open failure

## Windows And macOS Notes

- path handling must support spaces
- process spawn should use explicit argument arrays
- do not build shell command strings unsafely
- temp directories should be app-managed
- Rubai runtime and converted model path must be validated before recording
- `RUBAI_PYTHON_PATH` and `RUBAI_CT2_MODEL_PATH` override default self-host paths
