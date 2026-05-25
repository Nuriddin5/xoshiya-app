# Changelog

## 1.1.13 - 2026-05-25

- Added a lesson session organizer in Courses so attached sessions can be moved to another lesson and reordered inside the selected lesson.
- Made lesson transcript loading honor the stored lesson session order instead of always falling back to recording timestamps.
- Stopped History from defaulting unattached sessions to the first course and lesson, preventing accidental first-lesson attachments.

## 1.1.12 - 2026-05-25

- Kept paused recorder sessions resumable when reconnecting to the desktop source or ASR runtime fails, preserving the existing session and recorded chunks for another resume attempt.
- Persisted recorder course and lesson attribution so refreshed or resumed sessions keep their original lesson instead of adopting the currently selected lesson.
- Cleared stale lesson session indexes when autosaved history is cleared and refreshed lesson session parts when a new session starts.

## 1.1.11 - 2026-05-25

- Added Windows taskbar progress and title text fallbacks so recording, paused, and stopping states remain visible even when Windows does not render overlay badges.

## 1.1.10 - 2026-05-25

- Set a stable Windows AppUserModelID so the taskbar recording overlay can attach to portable app windows reliably.
- Applied the last known recording indicator state when a window is created and aligned the title bar with the packaged Xoshiya App name.

## 1.1.9 - 2026-05-25

- Fixed the dashboard capture target header so long course, lesson, and window names truncate inside their columns instead of overlapping neighboring controls.
- Kept the Windows taskbar capture overlay visible during stopping and final processing with a distinct orange stop indicator.

## 1.1.8 - 2026-05-25

- Added a Windows taskbar recording overlay so the app shows a red status dot while recording and a yellow status dot while paused.
- Cleared the overlay for all non-capture states and prevented restored non-live paused sessions from showing a misleading paused indicator after refresh.

## 1.1.7 - 2026-05-18

- Reverted the oversized portable packaging change so `.venv-rubai` is not embedded inside the `.exe`.
- Restored Rubai as a shared sidecar runtime for both development and production builds, with runtime discovery checking the portable executable folder before Electron's temporary resources folder.
- Corrected default save folders so production keeps using `Documents\StudyCapture` while development uses `Documents\StudyCaptureDev`.

## 1.1.6 - 2026-05-18

- Fixed the portable Windows release so the Rubai Python runtime and worker script are embedded in Electron resources instead of relying on sidecar folders beside the `.exe`.
- This resolves packaged app startup errors where Local Rubai ASR looked for `.venv-rubai` and `rubai_worker.py` inside Electron's temporary extraction folder and could not find them.

## 1.1.5 - 2026-05-18

- Fixed dashboard lesson switching so a newly created or newly selected lesson no longer reuses the previous lesson's live recording session.
- Cleared lesson polishing, corrected transcript, and summary state immediately on course or lesson changes to avoid stale transcript flashes before the next lesson state loads.
- Added regression coverage for lesson-scoped session state and current selection matching.

## 1.1.4 - 2026-05-16

- Added the dashboard Savol-javob/test panel for asking AI lesson questions and multiple-choice tests.
- Answers now use the polished lesson output plus matching book/source snippets from the selected course context.
- Added coverage for lesson question answering requests and source-context forwarding.

## 1.1.3 - 2026-05-16

- Hardened lesson polishing against DeepSeek/OpenAI-compatible responses that contain unescaped control characters or trailing commas in JSON output.
- Enabled JSON response mode for lesson polishing requests and tightened the prompt so multiline transcript fields are escaped as valid JSON.
- Added a text-only correction fallback so lesson polishing still returns corrected transcript text when the provider's structured JSON is irreparably broken.
- Improved book-context lookup so polishing can still use course-imported or fallback source books when `course.bookIds` is empty.

## 1.1.2 - 2026-05-16

- Added lesson session replay support so a lesson can list its saved transcript parts, combine selected parts into one transcript, and export that combined lesson capture.
- Added backend repair logic so lesson-to-session links can be reconstructed from history files when needed.

## 1.1.1 - 2026-05-16

- Fixed the History screen layout so session cards, metadata, and lesson attachment controls fit cleanly on narrower window widths without horizontal overflow.

## 1.1.0 - 2026-05-14

- Added adaptive transcription chunk timing and chunk boundary controls to improve transcript quality during long recordings.
- Added recovery controls for stuck transcription sessions so recordings can be force-finished instead of abandoned.
- Preserved recorder sessions in history and added the ability to attach history sessions to lessons for better study organization.
- Updated prompt verification tracking to keep the project prompt checklist in sync with delivered work.

## 1.0.0 - 2026-05-13

- Initial portable desktop MVP release.
