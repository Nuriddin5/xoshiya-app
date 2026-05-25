# Testing and Acceptance

## Acceptance Checklist

- app launches on Windows 10/11
- settings persist across restart
- OpenAI API key is saved locally and not logged
- Rubai runtime status is visible
- Settings work without Whisper paths
- desktop source list renders
- user can start and stop capture
- audio chunks are saved locally
- each chunk is transcribed locally
- raw transcript appears in UI
- failed chunks show error state
- chunk retry works
- correction request uses text only
- summary request uses text only
- book `.txt` import works
- book search returns relevant snippets
- selected snippets feed the prompt builder
- Markdown export works
- JSON export works
- history list works
- open file and open folder actions work
- no raw audio is sent to OpenAI

## Manual Test Scenarios

### First Launch

- open app
- enter API key
- confirm no Whisper path fields are present in Settings
- verify Local Rubai ASR runtime is ready
- save settings
- restart app
- verify settings remain

### Recording Flow

- select a Chrome or screen source
- start capture
- wait for one chunk
- verify temp audio is saved
- verify transcription starts
- verify raw transcript appends

### Correction Flow

- click Correct Transcript
- verify corrected transcript returns
- inspect that obvious recognition errors are improved
- confirm uncertain phrases are not invented

### Summary Flow

- click Generate Notes
- verify Markdown sections are present
- confirm output is Uzbek Latin

### Book Context Flow

- import `.txt` book
- search for a known term
- select snippets
- regenerate notes
- verify context-sensitive terms improve

### Concurrent Transcription Flow

- start capture
- wait for several chunks
- verify no more than two chunks are `transcribing` at a time
- verify later chunks remain `pending` when the two local transcription slots are busy
- verify Local Rubai ASR shows backlog, startup/model-load timing, and last chunk processing timing
- verify a failed chunk can be retried

### Export Flow

- save Markdown
- confirm both `.md` and `.json` exist
- open markdown file
- inspect formatting

## Non-Functional Checks

- no secret logging
- paths with spaces work
- failures are recoverable
- repeated retries do not crash app
- long transcript text remains editable
