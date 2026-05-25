# Xoshiya App - Gemini Instructions

This file contains foundational instructions and mandates for the Xoshiya App project. These instructions take absolute precedence over general defaults.

## Project Vision & Core Mandates
- **Goal:** Personal Windows-first desktop app for Islamic studies review.
- **Privacy:** Local-first. Raw audio **MUST NEVER** be sent to any cloud service or OpenAI.
- **Transcription:** Strictly local using Rubai (Python/faster-whisper/CTranslate2).
- **AI Tasks:** OpenAI-compatible providers are used only for text-based tasks (correction, summary, terminology repair).
- **Architecture:** OpenAI SDK calls must live in the **Main Process**. Renderer is untrusted.

## Tech Stack
- **Framework:** Electron + Vite
- **Frontend:** React (TypeScript) + Tailwind CSS
- **Backend:** Node.js (Main Process) + Python (Rubai Worker)
- **State/Storage:** `electron-store`, local Markdown and JSON files.
- **Testing:** Node.js built-in test runner (`node --test`).

## Mandatory Workflows

### 1. Research & Strategy
- Always reproduction issues before fixing.
- Map architectural boundaries before changing cross-cutting logic.

### 2. Execution & Coding Standards
- **Surgical Changes:** Keep edits focused and idiomatic.
- **Type Safety:** Maintain strict TypeScript typing. Do not bypass the type system.
- **IPC Security:** Follow established IPC patterns in `src/main/ipc.ts` and `src/preload/preload.ts`.
- **Windows Compatibility:** Ensure path handling supports spaces and uses explicit argument arrays for process spawning.

### 3. Validation & Reporting
- **Verification is Mandatory:** Run the following suite after ANY change:
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
- **Manual UI Check:** If UI or visible behavior changes, perform manual verification (see `UI_VERIFICATION.md`).
- **Reporting:** Create a report in `reports/` for every task (Prompt or Manual).
  - Format: `reports/YYYY-MM-DD_HH-mm_manual-task.md`
- **Git Commit:** Commit verified work including the report file.

## Key Files
- `ARCHITECTURE.md`: High-level system design.
- `PROJECT.md`: MVP specification and roadmap.
- `DATA_MODEL.md`: State and storage structures.
- `PROMPT_EXECUTION_RULES.md`: Core rules for implementation.
- `UI_VERIFICATION.md`: Checklist for manual UI testing.
- `MEMORY.md`: Compact index of stable project constraints.

## Verification Commands
```powershell
# Type checking
npm run typecheck

# Unit tests
npm test

# Build
npm run build

# Development mode
npm run dev
```

## Security Rules
- Never log or print API keys.
- Use `src/main/path-security.ts` (if it exists) or follow strict path validation.
- Do not expose raw Node APIs to the renderer.
