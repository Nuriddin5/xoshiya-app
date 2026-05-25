# Chunk Pipeline UX and Reliability Report

## Scope

Improved long-lesson chunk pipeline behavior so capture state is explicit, backlog processing is visible, failed chunks are retryable per chunk or per lesson, and transcript progress is saved incrementally instead of living only in renderer memory.

## What Changed

- Recorder state now distinguishes active capture from post-stop backlog processing and final settlement.
- Recorder UI now shows:
  - live capture state: `recording`, `paused`, `stopping`, `processing backlog`, `completed`, `failed`
  - chunk totals, backlog count, completed count, and failed count
  - `Finish now` while stop is waiting on queued chunk work
  - per-chunk retry and lesson-level retry for failed chunks
- Completed transcript text is still built only from successful chunks, so later chunk failures do not erase already processed text.
- Session drafts are now written incrementally to `saveFolder\\_drafts\\<sessionId>.json|md` while the session changes.
- Final export now deletes the matching draft after a successful export.
- Dashboard export and lesson-polish actions now stay blocked while capture or backlog processing is still active.

## Verification Run

### Automated

- `npm run typecheck`
- `npm test`
- `npm run build`

All passed.

### Simulated Long-Lesson Check

Because this environment does not expose a real Electron desktop-capture device, I ran a simulated multi-chunk lesson flow against the shared chunk/session helpers and draft persistence path.

Observed result:

- 4 simulated chunks produced:
  - `2` completed chunks
  - `1` failed chunk
  - `1` pending backlog chunk
- The aggregated raw transcript kept only the successful text:

```text
Birinchi chunk matni.

Ikkinchi chunk matni.
```

- Incremental draft saves wrote to the same `_drafts/session-sim-1.json|md` files and the second save updated the stored transcript in place instead of creating a separate final-only artifact.

## Manual Check Instructions

Run this on a Windows machine with working Rubai runtime and a real desktop audio source.

1. Open Dashboard and select a course, lesson, and desktop capture target.
2. Start a multi-minute recording and let at least 3-4 chunks accumulate.
3. Confirm the recorder status reads `recording`.
4. Confirm the stats row shows chunk count increasing and backlog count rising or falling as transcription catches up.
5. Click `Pause` during capture.
6. Confirm the state changes to `paused` and no new chunks start while any queued chunks may continue transcribing.
7. Click `Resume` and confirm the same lesson continues with the next chunk index.
8. Click `Stop` while at least one chunk is still pending or transcribing.
9. Confirm the state changes through `stopping` into `processing backlog`.
10. Confirm `Export session` and `Polish lesson` remain disabled until backlog settles.
11. While backlog exists, click `Finish now`.
12. Confirm the recorder clearly states that queued chunk processing continues in the background.
13. Wait until backlog reaches `0`.
14. Confirm the final state becomes `completed` when all chunks succeeded, or `failed` when one or more chunks still failed.

## Manual Failure and Retry Checks

1. Start another lesson capture and let at least one chunk finish successfully.
2. Force a later chunk failure.
   - Example: temporarily break the Rubai runtime path or model path after one chunk has already completed.
3. Confirm the recorder ends in `failed` instead of clearing the earlier transcript.
4. Confirm the raw transcript still contains the successfully processed earlier chunks.
5. In the chunk list, click `Retry` on the failed chunk.
6. Confirm that chunk returns to `pending` or `transcribing`, then `done` when the runtime is repaired.
7. Force two failed chunks in one lesson.
8. Click `Retry failed lesson`.
9. Confirm all failed chunks re-enter the queue without reprocessing already successful chunks.
10. After retries finish, confirm the final state becomes `completed` if no failed chunks remain.

## Residual Note

I could not perform a real Electron GUI capture pass in this headless environment, so the live desktop-audio verification above still needs one Windows run on the target machine.
