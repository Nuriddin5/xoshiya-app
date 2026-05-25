# UI Verification Instructions

Use this file when a prompt changes the renderer, user flow, Electron window behavior, recording flow, settings UI, history UI, or any visible state.

## Required UI Report

After every prompt, create a report file:

```txt
reports/YYYY-MM-DD_HH-mm_prompt-XX.md
```

If the prompt does not have a number, use:

```txt
reports/YYYY-MM-DD_HH-mm_manual-task.md
```

The report must include:

- prompt title or task summary
- commit hash
- files changed
- verification commands run
- automated test result
- UI areas affected
- exact manual UI check instructions for the user
- what could not be verified locally
- failures found and how they were fixed
- remaining risks
- recommended fix prompt if follow-up is needed
- recommended larger-model prompt if the issue is complex

## Manual UI Check Format

Write UI checks as direct instructions:

```md
## Manual UI Check

1. Run `npm run dev`.
2. Open the Electron window.
3. Go to Settings.
4. Enter a fake API key and save.
5. Restart the app.
6. Confirm the settings remain saved.
7. Confirm the API key is not printed in terminal logs.
```

## When UI Cannot Be Verified

If the agent cannot verify UI locally, the report must say so plainly.

Use this format:

```md
## Not Verified

- I could not verify desktop audio capture because no selectable audio source was available in this environment.
- I could not verify local Rubai transcription because the Rubai Python runtime or converted CT2 model was unavailable.
```

Do not claim a UI flow works unless it was actually run or backed by a passing automated test.

## Recommended Follow-Up Prompt Format

When a fix should be done by a later prompt, include:

```md
## Recommended Follow-Up Prompt

Fix the issue where <specific problem>.

Context:
- observed behavior: <what happened>
- expected behavior: <what should happen>
- affected files: <files>
- verification required: <commands and UI checks>

Follow `PROMPT_EXECUTION_RULES.md` and `UI_VERIFICATION.md`.
```

## Recommended Larger-Model Prompt Format

Use this only when the issue is broad, ambiguous, or needs deeper architecture review:

```md
## Recommended Larger-Model Prompt

Use a larger reasoning model to review and fix <specific area>.

Focus on:
- root cause analysis
- architecture boundary correctness
- Windows/Electron behavior
- security and local-first constraints
- full test and UI verification plan

Inputs to read first:
- `PROJECT.md`
- `ARCHITECTURE.md`
- `PROMPT_EXECUTION_RULES.md`
- this report file

Expected output:
- implemented fix
- tests passing
- updated report
- git commit
```

## UI Areas To Check By Feature

### Settings

- settings load on app start
- settings save successfully
- required fields show missing state
- API key is not logged
- settings work without Whisper path fields
- Rubai-only setup text mentions the converted model folder and required files

### Dashboard

- source picker renders usable source names
- start and stop buttons reflect recording state
- chunk timer updates
- raw transcript remains editable
- corrected transcript remains editable
- summary remains editable
- disabled actions explain missing prerequisites

### Recording

- selected source is used
- chunk files are created locally
- failed chunk state is visible
- retry action exists for failed chunks
- at most two chunks enter `transcribing` at a time
- later chunks stay `pending` while both local transcription slots are busy
- no audio is sent to OpenAI

### Rubai ASR

- missing `RUBAI_PYTHON_PATH` or default `.venv-rubai` Python runtime shows useful error
- missing converted model path shows useful error
- missing converted model files show useful error
- worker stderr is visible enough to debug
- status shows model loading, backlog, completed chunks, and last chunk timing
- successful transcript appends to raw transcript

### Book

- `.txt` import works
- search returns snippets
- import success and search result counts are visible
- selected snippets are visible before correction or summary

### History

- saved sessions are newest first
- open file works
- open folder works
- missing files are handled clearly
