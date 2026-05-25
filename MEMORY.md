# Project Memory

This file is the compact memory for the Study Capture Desktop MVP. Treat these points as stable project constraints unless explicitly changed.

## Non-Negotiable Rules

- App is local-first.
- App is personal-use desktop software, not SaaS.
- Target OS is Windows 10/11 first.
- Raw audio must never be sent to OpenAI.
- Local transcription is mandatory in MVP.
- OpenAI is only for text correction, cleanup, terminology normalization, notes, summaries, and flashcards.

## Chosen Direction

- Desktop stack: Electron + React + TypeScript + Vite + Tailwind
- Local transcription backend: Rubai via `faster-whisper` + CTranslate2 int8
- Settings persistence: `electron-store`
- Export formats: Markdown and JSON
- Book context: imported `.txt` plus simple local search
- OpenAI SDK calls: main process only, with text-only payloads

## Default Settings

```json
{
  "summaryModel": "gpt-4.1-mini",
  "correctionModel": "gpt-4.1-mini",
  "chunkSeconds": 30,
  "saveFolder": "~/Documents/StudyCapture"
}
```

## Required Screens

- Settings
- Dashboard
- Book
- History

## Required Dashboard Actions

- pick source
- start recording
- stop recording
- show live raw transcript
- correct transcript
- generate notes
- save Markdown

## Required Export Content

- summary
- corrected transcript
- raw transcript
- book context used

## Out of Scope for MVP

- backend
- auth
- payments
- browser extension
- mobile app
- vector database
- advanced PDF parsing
- diarization
- cloud sync
- analytics
