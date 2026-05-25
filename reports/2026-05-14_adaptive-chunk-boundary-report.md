# Adaptive Chunk Boundary Report

## Scope

Replaced rigid fixed-length chunk rotation with local adaptive chunk timing so chunk boundaries prefer short pauses and likely sentence ends while preserving chunk order, transcription queue behavior, and transcript aggregation.

## Chunk-End Heuristic

- Preferred chunk target stays configurable, but it is now normalized into an adaptive `25-40s` window and defaults to `30s`.
- The recorder opens a local `AudioContext` analyser on the captured desktop audio stream and samples RMS energy every `120ms`.
- A rolling low-percentile RMS floor estimates background noise. Silence threshold is derived from that floor and clamped so the detector still works when the stream is very quiet or very loud.
- Pause scanning opens at `max(25s, preferredTarget - 5s)`.
- Before the preferred target, a pause must remain quiet for about `420ms`.
- Around the preferred target, the required quiet window relaxes to about `280ms`.
- Later in the scan, the quiet window relaxes again to about `180ms` so the recorder does not hold speech too long waiting for a perfect break.
- If no reasonable pause is detected, chunk rotation falls back to the `40s` hard limit.
- Each chunk now stores structured `boundaryDebug` metadata and the recorder lifecycle log includes the reason, timing, and silence evidence for the chosen boundary.

## Verification

### Automated

- `npm run typecheck`
- `npm test`
- `npm run build`

All passed.

### Local Multi-Sentence Recording Check

I generated a local multi-sentence WAV recording with Windows `System.Speech`, then ran the same adaptive planner over the waveform to compare its chosen boundaries against the old rigid `30s` split.

Observed result:

- Recording duration: `70.29s`
- Adaptive chunk 1 ended at `32.04s`
- Adaptive chunk 2 ended at `37.56s`
- Both automatic chunk durations stayed inside the required `25-40s` range and did not reuse the same exact duration
- Old rigid boundaries would have landed at `30.00s` and `62.04s`
- RMS at old rigid boundaries: `0.0432` and `0.1208`
- RMS at adaptive boundaries: `0.0000` and `0.0000`

Interpretation:

- The old rigid boundary points were still inside active speech.
- The adaptive boundaries landed inside pause regions instead.
- That is the expected improvement for sentence and phrase endings: the chunk closes after a natural break instead of cutting a running phrase at the timer boundary.

## Implementation Notes

- Raw audio still stays local. The analyser runs in the renderer and no audio is sent to OpenAI.
- Transcription queueing remains unchanged: chunk indices still increase in order, save/transcribe tasks still flow through the existing queue, and raw transcript aggregation still sorts completed chunks by `chunkIndex`.
