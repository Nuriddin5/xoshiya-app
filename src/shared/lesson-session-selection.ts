export type LessonTranscriptPart = {
  rawTranscript: string;
  sessionId: string;
};

export type CurrentLessonTranscriptPart = LessonTranscriptPart | null;

export function buildSelectedLessonTranscript(
  records: LessonTranscriptPart[],
  selectedSessionIds: string[],
  currentSession: CurrentLessonTranscriptPart = null,
): string {
  const selectedSessionIdSet = new Set(selectedSessionIds);
  const selectedTranscript = records
    .filter((record) => selectedSessionIdSet.has(record.sessionId))
    .map((record) => (currentSession?.sessionId === record.sessionId ? currentSession.rawTranscript : record.rawTranscript).trim())
    .filter(Boolean)
    .join('\n\n');
  const currentSessionAlreadySelected = Boolean(currentSession && selectedSessionIdSet.has(currentSession.sessionId));

  return [
    selectedTranscript,
    currentSession && !currentSessionAlreadySelected ? currentSession.rawTranscript.trim() : '',
  ].filter(Boolean).join('\n\n');
}
