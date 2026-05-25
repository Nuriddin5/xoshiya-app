# Implementation Plan

## Build Order

1. Electron, React, TypeScript, Vite, Tailwind bootstrap.
2. Settings storage and readiness.
3. Desktop source picker.
4. Audio chunk recording and temp file save.
5. Rubai local ASR worker and serialized transcription queue.
6. Session-level raw transcript aggregation.
7. Book import, segmentation, and Hybrid-lite search.
8. Book-assisted transcript correction.
9. Arabic and aqida terminology repair pass.
10. Topic extraction per lesson section.
11. Study notes, flashcards, and review checklist.
12. Markdown/JSON export.
13. History screen.
14. README and Windows setup docs.
15. Windows validation pass.

## Current Architecture

- Local ASR is Rubai-only.
- Runtime path is `scripts/rubai_worker.py` launched by `src/main/rubai-runner.ts`.
- Converted model path is `~/Desktop/whisper-tools/models/rubai-rubaistt-v2-medium-ct2-int8`.
- Book context is local and stored through `electron-store`.
- Text provider calls must stay in the main process.

## Phase Details

### Phase 1: Rubai ASR

Exit condition:

- Rubai runtime validates before recording.
- One chunk transcribes at a time.
- Later chunks remain `pending`.
- Raw transcript updates from completed chunks.

### Phase 2: Book Context

Exit condition:

- `.txt` and pasted text can be imported.
- Search returns ranked snippets.
- Snippets can be selected for the dashboard workflow.

### Phase 3: Text Pipeline

Exit condition:

- corrected transcript uses raw transcript plus snippets
- Arabic and aqida terms are fixed only when supported
- unclear parts are marked `[noaniq]`
- no raw audio enters the payload

### Phase 4: Learning Reducer

Exit condition:

- session has corrected transcript, topics, summary, flashcards, and review checklist
- book evidence used is visible
- output is exportable as Markdown/JSON

## Engineering Rules

- run typecheck and build after each milestone
- keep prompts centralized
- do not send raw audio to OpenAI or any cloud STT
- keep renderer free of secret persistence and direct AI SDK calls
- keep local search simple before adding embeddings

## Delivery Risks

- desktop audio capture differs by Windows device setup
- Rubai model is CPU-heavy on longer chunks
- 30s chunks are preferred for stability
- book search may need semantic search later if keyword matching is too weak
