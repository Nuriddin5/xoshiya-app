# UI Screens

## Settings Screen

Fields:

- OpenAI API key
- chunk duration
- save folder
- summary model
- correction model

Defaults:

```json
{
  "summaryModel": "gpt-4.1-mini",
  "correctionModel": "gpt-4.1-mini",
  "chunkSeconds": 30,
  "saveFolder": "~/Documents/StudyCapture"
}
```

UX requirements:

- clearly show whether required settings are missing
- never reveal stored API key in logs
- provide save feedback

## Dashboard

Must contain:

- source picker
- Start button
- Stop button
- current chunk timer
- current status label
- Local Rubai ASR runtime status
- raw transcript editor
- corrected transcript editor
- selected book snippets
- detected topics
- review checklist
- Correct Transcript button
- Generate Notes button
- summary editor
- Save Markdown button

Recommended layout:

- left column for controls and session state
- right column for transcript and summary panes

## Book Screen

Must contain:

- import `.txt`
- search input
- matched snippets list
- selection toggle for snippet usage

UX requirements:

- show source book name
- show small snippet preview
- allow multiple snippet selection

## History Screen

Show:

- title
- date
- source
- open markdown file
- open folder

UX requirements:

- newest first
- readable empty state
- show save location when useful

## State Indicators

Useful statuses:

- idle
- recording
- saving chunk
- transcribing
- correction in progress
- note generation in progress
- saved
- failed

## MVP UI Principles

- plain and reliable over fancy
- prioritize transcript visibility
- make failed chunks obvious
- make book context inclusion explicit
- keep Markdown export one click away
