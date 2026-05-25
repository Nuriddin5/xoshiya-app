# Codex Prompt Collection for Study Capture Desktop MVP

This prompt bank tracks the Study Capture implementation. Prompts 1-13 are completed history. Prompt 14 onward is Rubai-first and should match the current repository shape.

## Usage Rules

- give Codex one focused prompt at a time when possible
- every numbered prompt inherits `PROMPT_EXECUTION_RULES.md`
- every UI or user-visible prompt inherits `UI_VERIFICATION.md`
- run typecheck and build before finishing
- if verification fails, fix it in the same task and rerun the failed checks
- create a report under `reports/` after every prompt
- each implementation prompt must end with a focused git commit after verification passes
- raw audio must never go to OpenAI or any cloud STT
- local ASR is Rubai via `faster-whisper` + CTranslate2 int8

## Mandatory Final Protocol

Append this protocol to every prompt in this file:

```md
Before final response:
- follow `PROMPT_EXECUTION_RULES.md`
- follow `UI_VERIFICATION.md` when UI or user-visible behavior changed
- run the full available verification suite
- fix any failing test, typecheck, lint, or build error in place
- create `reports/YYYY-MM-DD_HH-mm_prompt-XX.md` with prompt, report, UI check instructions, unresolved items, and recommended follow-up prompts
- check `git status --short`
- commit only the verified changes and the report file for this prompt
- report the commit hash, verification commands, report path, and any remaining risks
```

## Completed History

### Prompt 1

```md
Build the Study Capture Desktop MVP in this repository.

Requirements:
- Use Electron, React, TypeScript, Vite, Tailwind CSS, Node.js.
- The app is local-first and Windows-first.
- Transcribe audio locally.
- OpenAI must only be used after local transcription for text correction and note generation.
- Never send raw audio to OpenAI.
- Store settings with `electron-store`.
- Keep code modular using the planned structure in `PROJECT.md`.

Start with project bootstrap only:
- configure Electron + Vite + React + TypeScript + Tailwind
- create `src/main`, `src/preload`, and `src/renderer`
- wire a minimal secure preload bridge
- create a placeholder app shell with Settings, Dashboard, Book, and History navigation
```

done

### Prompt 2

```md
Set up the Electron + React + TypeScript + Vite + Tailwind project structure for the Study Capture app.
```

done

### Prompt 3

```md
Refine the app shell UI for the Study Capture MVP.
```

done

### Prompt 4

```md
Implement the Settings screen for the Study Capture MVP with `electron-store`, preload settings APIs, AI provider settings, chunk duration, save folder, summary model, and correction model.
```

done

### Prompt 5

```md
Add first-launch readiness logic to the Study Capture app.
```

done

### Prompt 6

```md
Implement desktop source listing for the Study Capture MVP.
```

done

### Prompt 7

```md
Implement audio capture controls in the dashboard.
```

done

### Prompt 8

```md
Implement local chunk saving in the Study Capture app.
```

done

### Prompt 9

```md
Create local transcription runner infrastructure.
```

done

### Prompt 10

```md
Wire chunk transcription into the dashboard flow.
```

done

### Prompt 11

```md
Improve local ASR integration robustness for Windows.
```

done

### Prompt 12

```md
Implement transcript editors for the Study Capture dashboard.
```

done

### Prompt 13

```md
Add session state aggregation to the Study Capture app.
```

done

## Rubai-First ASR Prompts

### Prompt 14

```md
Finish the Rubai-first ASR cleanup in the Study Capture app.

Requirements:
- make Rubai via `faster-whisper` + CTranslate2 int8 the only active local ASR backend
- remove Whisper as required setup, UI wording, readiness gate, and runtime fallback
- validate `.venv-rubai`, `faster-whisper`, `ctranslate2`, and the converted Rubai CT2 model before recording
- default chunk duration should be `30` seconds
- keep transcription serialized so only one chunk is `transcribing` and later chunks are `pending`
- surface Rubai runtime errors clearly

Do not send raw audio to OpenAI or any cloud service.
Run typecheck and build.
```

done

### Prompt 15

```md
Implement local book import and Hybrid-lite book search.

Requirements:
- support manual text import and `.txt` file import
- store imported books locally with name, import date, full text, and segmented sections
- segment by headings when possible, otherwise by practical text blocks
- expose `importBookText`, `listBookDocuments`, and `searchBook` through preload
- implement local normalized keyword matching for Uzbek, Arabic, and transliterated terms
- return ranked `BookSnippet[]` with heading, source name, score, matched terms, and excerpt
- allow selecting snippets for the dashboard correction workflow

Keep this local. Do not add vector search yet.
Run typecheck and build.
```

done

### Prompt 16

```md
Implement book-assisted transcript correction.

Requirements:
- add a main-process text-only correction API using the configured AI provider
- input is raw transcript text and selected `BookSnippet[]`
- reject audio paths, blobs, buffers, binary media, and empty transcript text
- use the correction prompt from `OPENAI_AND_PROMPTS.md`
- use book snippets only as evidence for terminology and Arabic phrase repair
- do not invent missing content; mark unclear parts as `[noaniq]`
- store corrected transcript in session state
- wire a dashboard `Correct transcript` action with loading, retry, and clear errors

Raw audio must never leave the machine.
Run typecheck and build.
```

done

### Prompt 17

```md
Add Arabic and Islamic terminology repair support.

Requirements:
- create a prompt/helper layer for Arabic phrases, aqida terms, and common transliteration variants
- use selected book snippets as the source of truth when fixing phrases
- preserve Arabic transliteration when exact Arabic script is not supported by context
- mark unsupported or uncertain terms as `[noaniq]`
- show a short evidence list of which snippets affected the correction

Run typecheck and build.
```

### Prompt 18

```md
Implement topic extraction for each lesson session.

Requirements:
- split corrected transcript into practical topics
- prefer imported book headings when snippets match transcript sections
- store detected topics in session state
- show topics on the dashboard with related snippet references
- keep deterministic local heuristics for MVP; do not add embeddings yet

Run typecheck and build.
```

done

### Prompt 19

```md
Generate study notes, flashcards, and review checklist.

Requirements:
- expose a text-only `generateStudyNotes` API through preload
- use corrected transcript, detected topics, and selected snippets
- output Uzbek Latin Markdown
- include main topic, key points, aqida terms, book-related points, test points, quick review, flashcards, and unclear parts
- store summary and review items in session state
- add dashboard loading, retry, and error states

Run typecheck and build.
```

done

## Export, History, and Polish Prompts

### Prompt 20

```md
Implement Markdown and JSON session export.

Requirements:
- export title, date, source, raw transcript, corrected transcript, summary, detected topics, review items, and book context used
- save into configured folder
- use Windows-safe filenames
- expose a save API through preload

Run typecheck and build.
```
done
### Prompt 21

```md
Implement the History screen for exported sessions.

Requirements:
- list exported JSON/Markdown sessions newest first
- show title, date, source, and key topic count
- allow opening Markdown file and containing folder

Run typecheck and build.
```
done
### Prompt 22

```md
Do a focused privacy and security review.

Check:
- raw audio never reaches AI provider calls
- preload exposes only narrow safe APIs
- imported book text is local
- path handling is Windows-safe
- Rubai worker errors cannot crash the app
- failed chunk retry still respects the transcription queue

Fix concrete issues, then run typecheck and build.
```
done
### Prompt 23

```md
Prepare the app for first real Windows testing.

Requirements:
- improve user-facing errors
- document Rubai setup and converted model expectations
- verify settings without Whisper paths
- verify local book import/search
- verify one-chunk-at-a-time transcription behavior

Run typecheck and build.
```
done
### Prompt 24

```md
Update README documentation for the current Rubai-first implementation.

Include:
- what the app does
- local-first privacy rule
- Rubai ASR setup
- OpenAI-compatible text provider setup
- how to run
- how book context helps correction
- what is still not in MVP
```

## Continuation Prompts

### Prompt 25

```md
Implement the next unfinished Rubai-first milestone and stop at a coherent checkpoint.

Rules:
- inspect the current repository first
- choose the next blocking gap from `IMPLEMENTATION_PLAN.md`
- keep raw audio local
- run typecheck and build
- update docs if architecture or setup changed
```
done
### Prompt 26

```md
Continue building the learning-time reducer flow:

`audio -> Rubai raw transcript -> book search -> corrected transcript -> topic split -> notes/flashcards/review list`

Implement the next missing step end to end and verify it.
```

## Debug Prompts

### Prompt 27

```md
Debug why Rubai local transcription is failing.

Check:
- `.venv-rubai`
- `faster-whisper` and `ctranslate2` imports
- converted Rubai CT2 model path
- audio chunk validity
- worker process lifecycle
- queue behavior

Fix the root cause and run typecheck and build.
```

### Prompt 28

```md
Debug why captured audio chunks are not producing usable Uzbek transcript text.

Check:
- desktop source audio availability
- MediaRecorder MIME type
- chunk duration
- worker runtime status
- Rubai model output quality

Fix the smallest concrete issue and run typecheck and build.
```

### Prompt 29

```md
Debug why book-assisted correction or summary generation is failing.

Check:
- API key and base URL loading
- text-only request payloads
- selected snippet payload size
- prompt assembly
- correction and summary error handling

Run typecheck and build.
```

## Refactor Prompt

### Prompt 30

```md
Refactor the current Study Capture codebase for maintainability without changing product behavior.

Focus on:
- separating main, preload, and renderer responsibilities
- centralizing shared types
- reducing duplicated prompt-building logic
- simplifying session state flow
- keeping Rubai-only ASR clear

Run typecheck and build.
```

______________________________________________

## Next Product Prompts

### Prompt 31

```md
Fix the slow app startup problem.

Current issue:
- the app stays on "Starting..." for more than 15 seconds
- the user cannot start working quickly

Requirements:
- measure what blocks startup in Electron main, preload, renderer, Rubai worker setup, settings load, and model/path validation
- make the first usable screen appear fast, ideally under 3 seconds on a normal Windows machine
- defer heavy checks until after the UI is visible
- show clear background status for Rubai/model readiness instead of blocking the whole app
- if Rubai is not ready, allow the user to still open courses, books, lessons, and settings
- add a timeout/fallback so "Starting..." cannot hang forever
- keep raw audio local

Verification:
- run typecheck, tests if available, and build
- manually verify app launch from a cold start
- document before/after startup timing in the prompt report
```
done
### Prompt 32

```md
Add pause and resume controls during chunk-based recording/transcription.

Current issue:
- while audio is being recorded or processed in chunks, the user cannot pause cleanly

Requirements:
- add a visible Pause/Resume control during active capture
- pausing must stop new audio chunk capture without corrupting already captured chunks
- already queued chunks may finish processing, but the UI must clearly show whether capture is paused or transcription is still catching up
- resuming must continue the same lesson/session timeline
- add a Stop/Finish behavior that finalizes the current session safely
- prevent duplicate pause/resume clicks from creating inconsistent state
- persist enough session state so a paused session is not lost by a renderer refresh
- keep raw audio local

Verification:
- run typecheck, tests if available, and build
- manually verify: start recording, pause, wait, resume, stop, then inspect transcript continuity
- include UI manual check steps in the report
```
done
### Prompt 33

```md
Make Rubai transcription significantly faster.

Current issue:
- Rubai local transcription is too slow for practical lesson capture

Goal:
- improve real transcription throughput noticeably, not just refactor code

Requirements:
- profile current chunk processing time, queue delay, worker startup time, and model load time
- keep the Rubai model loaded between chunks instead of reloading per chunk
- avoid unnecessary audio file conversions/copies
- tune chunk duration and queue concurrency for best Windows performance without losing transcript quality
- expose useful runtime status: model loading, chunk queued, chunk transcribing, chunk completed, backlog count
- if Python/faster-whisper is the bottleneck, design and implement a faster worker path where practical
- consider a Go or C++ worker only if it can be run locally from the Electron app and gives a real speed improvement
- document the chosen worker architecture and why it is faster
- keep raw audio local and do not send audio to OpenAI

Verification:
- run typecheck, tests if available, and build
- benchmark at least one short sample before and after the change
- report chunk duration, processing time, and real-time factor if measurable
```

### Prompt 34

```md
Implement course creation and lesson-based study capture.

User flow:
- user can create a course
- user can add books and sources to that course
- user can create a new lesson by entering a lesson name
- user starts recording/capture inside that lesson
- generated transcript, corrections, notes, flashcards, and review items are attached to the selected lesson

Requirements:
- add course, source/book, and lesson entities if missing
- update storage/schema safely without losing existing sessions
- add UI for course list, course detail, source list, lesson list, and new lesson creation
- require an active course and lesson before starting lesson capture
- make it clear which course and lesson the current capture belongs to
- preserve existing local-first privacy behavior
- add empty states for courses, books/sources, and lessons

Verification:
- run typecheck, tests if available, and build
- manually verify creating a course, adding a lesson, recording into it, and reopening the app
- include changed data model notes in the report
```

### Prompt 35

```md
Add PDF and DOCX book/source import for course context.

User flow:
- user opens a course
- user uploads or selects a book/source file
- supported formats: PDF, DOCX, and existing plain text formats if present
- the app extracts text, chunks it, indexes it, and uses it for transcript correction and lesson notes

Requirements:
- support PDF import
- support DOCX import
- store imported source metadata: title, filename, file type, course id, import date, page/section info when available
- extract text robustly and show useful errors for encrypted, scanned, empty, or unsupported files
- chunk extracted text for local search and AI context
- keep imported source content local unless the user explicitly sends text context to the configured text provider
- add UI progress/status for long imports
- allow deleting a source from a course

Verification:
- run typecheck, tests if available, and build
- manually verify one PDF and one DOCX import
- verify imported text can be found by local search and used in correction context
```
done
### Prompt 36

```md
Connect lesson audio to AI polishing with course, lesson, topic, book, and source context.

User flow:
- user selects a course and lesson
- user records audio for that lesson
- Rubai creates the raw local transcript
- the app finds relevant snippets from the lesson's books/sources
- AI polishes the transcript and attaches it to the correct course, lesson, topic, and source references

Requirements:
- build a structured polishing prompt that includes:
  - course name
  - lesson name
  - detected or selected topic
  - raw Rubai transcript
  - relevant book/source snippets
  - clear instruction to preserve meaning and improve Uzbek clarity
- output structured results: polished transcript, topic title, summary, key points, terms, flashcards, review questions, and source references
- make source references visible in the lesson output where possible
- handle low-confidence or missing book context gracefully
- do not send raw audio to OpenAI or any text provider
- keep correction/polishing retryable per lesson

Verification:
- run typecheck, tests if available, and build
- manually verify a lesson with one imported book source
- confirm generated notes are saved under the correct course and lesson
```
done
### Prompt 37

```md
Improve chunk pipeline UX and reliability for long lessons.

Current issue:
- long lesson capture needs clear state, pause support, and predictable processing

Requirements:
- show live capture state: recording, paused, stopping, processing backlog, completed, failed
- show chunk count and pending backlog count
- make failures retryable per chunk or per lesson
- ensure stopping waits for important queued work or clearly offers "finish now" behavior
- prevent losing processed transcript if one later chunk fails
- save intermediate transcript results incrementally
- make the UI usable during background processing

Verification:
- run typecheck, tests if available, and build
- manually verify with a multi-minute recording or simulated chunks
- include failure/retry manual check instructions in the report
```
done

### Prompt 38

```md
Fix sentence cut-offs caused by rigid chunk boundaries.

Current issue:
- transcript chunks are being cut in the middle of a sentence
- fixed chunk timing causes broken phrase boundaries and worse Rubai output quality

Requirements:
- replace rigid fixed-length chunking with adaptive chunk timing
- keep every chunk length within `25-40` seconds
- do not always use the same exact duration; vary chunk length naturally inside that range
- determine the best cut point from the audio itself, especially short silence or pause regions near the end of the chunk window
- prefer ending a chunk where the speaker has likely finished a sentence or phrase
- avoid splitting active speech in the middle of a word or sentence unless forced by the `40` second hard limit
- if no good pause exists near the preferred boundary, continue scanning until a reasonable pause is found or stop at the safe fallback limit
- keep chunk ordering, transcription queue behavior, and saved transcript aggregation correct after this change
- surface enough debug information to verify why a chunk ended where it did
- keep raw audio local and do not send audio to OpenAI

Verification:
- run typecheck, tests if available, and build
- manually verify with at least one multi-sentence recording where speech crosses the old fixed boundary
- confirm chunk durations vary inside the `25-40` second range
- confirm sentence endings improve compared with the previous rigid chunking behavior
- document the chunk-end heuristic and observed results in the report
```
