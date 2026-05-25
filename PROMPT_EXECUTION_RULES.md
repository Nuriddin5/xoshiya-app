# Prompt Execution Rules

These rules apply to every numbered prompt in `PROMPTS.md`.

## Work Carefully

- Inspect the current repository before editing.
- Read the relevant project docs before implementation:
  - `PROJECT.md`
  - `ARCHITECTURE.md`
  - `DATA_MODEL.md`
  - `OPENAI_AND_PROMPTS.md`
  - `MEMORY.md`
- Keep edits scoped to the requested milestone.
- Preserve existing user work.
- Do not hardcode secrets.
- Do not send raw audio to OpenAI.
- Keep OpenAI SDK calls in the Electron main process unless the project docs are explicitly changed.
- Follow `UI_VERIFICATION.md` for any prompt that changes UI or user-visible behavior.

## Verification Is Mandatory

Before finishing any prompt, run the available verification suite:

- dependency install when needed
- typecheck
- unit tests
- integration tests, if present
- build
- lint, if present

Expected command pattern after scripts exist:

```txt
npm run typecheck
npm test
npm run build
```

If the repository does not yet have a test suite or scripts, the implementation prompt should add the missing scripts at the earliest practical milestone. If a task is documentation-only, run the strongest relevant checks available and state that no runtime suite applies.

## Prompt Report Is Mandatory

At the end of every prompt, create one report file under `reports/`.

Report filename format:

```txt
reports/YYYY-MM-DD_HH-mm_prompt-XX.md
```

The report must include:

- original prompt or task summary
- implementation summary
- changed files
- verification commands and results
- UI manual check instructions when UI is affected
- what could not be verified
- failures fixed in place
- remaining risks
- recommended follow-up prompt if needed
- recommended larger-model prompt if the issue needs deeper analysis

If no UI changed, write `UI affected: none` and explain why no manual UI check is needed.

Use `UI_VERIFICATION.md` for the report content and manual checking format.

## Fix Failures In Place

If any verification command fails:

- inspect the actual error
- fix the root cause in the same turn
- rerun the failed command
- rerun the full relevant suite after the fix

Do not leave known failing tests, typecheck, lint, or build unless an external blocker makes the failure impossible to resolve locally. If that happens, document the blocker clearly and do not pretend the suite passed.

## Git Commit Is Mandatory

At the end of every implementation prompt:

- check `git status --short`
- review the files changed by the prompt
- include the prompt report file in the commit
- avoid staging unrelated user changes
- commit only the completed, verified work
- use a clear commit message

If the folder is not yet a git repository, initialize git before the first implementation commit. Keep `.gitignore` in place before staging files so generated dependencies and build output are not committed.

Recommended commit style:

```txt
git add <changed-files>
git commit -m "Implement <milestone>"
```

Do not commit if verification failed, unless the user explicitly asks for a work-in-progress commit.
