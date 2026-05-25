import { buildLessonAnalysis, type LessonAnalysis } from './lesson-analysis.js';
import type { BookSnippet } from './types.js';

export type StudyReducerArtifacts = LessonAnalysis & {
  bookContext: BookSnippet[];
};

export function resolveStudyBookContext(correctionEvidence: BookSnippet[], selectedBookSnippets: BookSnippet[]): BookSnippet[] {
  return selectedBookSnippets.length > 0 ? selectedBookSnippets : correctionEvidence;
}

export function buildStudyReducerArtifacts(
  transcript: string,
  correctionEvidence: BookSnippet[],
  selectedBookSnippets: BookSnippet[],
): StudyReducerArtifacts {
  const bookContext = resolveStudyBookContext(correctionEvidence, selectedBookSnippets);
  const analysis = buildLessonAnalysis(transcript, bookContext);

  return {
    ...analysis,
    bookContext,
  };
}
