# Prompt Report: UI Verification Rules

## Prompt

Add instructions for how the user can verify UI changes, and require every prompt to create a temporary or persistent report file with the prompt, verification instructions, unresolved items, fix recommendations, and larger-model follow-up prompt when needed.

## Implementation Summary

- Added `UI_VERIFICATION.md` with manual UI check instructions and report structure.
- Updated `PROMPT_EXECUTION_RULES.md` so every prompt must create a report under `reports/`.
- Updated `PROMPTS.md` mandatory final protocol to require UI verification instructions and report creation.
- Added `reports/.gitkeep` so the reports folder exists in git.
- Updated docs tests to enforce the new report and UI verification rules.

## Changed Files

- `UI_VERIFICATION.md`
- `PROMPT_EXECUTION_RULES.md`
- `PROMPTS.md`
- `README.md`
- `tests/docs.test.js`
- `reports/.gitkeep`
- `reports/2026-05-06_17-00_prompt-ui-verification-rules.md`

## Verification Commands

```txt
npm test
```

## Automated Test Result

Passed. `npm test` ran 3 tests and all passed.

## UI Affected

None. This task changes documentation and prompt workflow only.

## Manual UI Check

No manual UI check is needed for this documentation-only task.

## Not Verified

- Runtime Electron UI was not started because no application UI code was changed.
- Typecheck and build were not run because the project has not yet been bootstrapped with TypeScript/Vite scripts.

## Failures Fixed In Place

None so far.

## Remaining Risks

- Future agents must actually follow the report requirement; the docs test can verify wording exists, but cannot force behavior at runtime.

## Recommended Follow-Up Prompt

Implement the next Study Capture MVP milestone and follow `PROMPT_EXECUTION_RULES.md` and `UI_VERIFICATION.md`.

Context:
- reports are now mandatory under `reports/`
- UI changes need manual UI check instructions
- verification failures must be fixed before commit
- each prompt must commit verified changes and its report

Verification required:
- run the full available verification suite
- create a report file
- commit only verified changes

## Recommended Larger-Model Prompt

Use a larger reasoning model to review the prompt governance docs for completeness.

Focus on:
- whether the report format captures enough evidence
- whether UI verification instructions are actionable
- whether the git commit rules avoid committing unrelated user changes
- whether local-first and OpenAI text-only boundaries are preserved

Inputs to read first:
- `PROMPTS.md`
- `PROMPT_EXECUTION_RULES.md`
- `UI_VERIFICATION.md`
- this report file

Expected output:
- implemented doc fixes if needed
- tests passing
- updated report
- git commit
