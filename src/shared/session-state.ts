import type { BookSnippet, DetectedTopic, LessonPolishingResult, StudySession } from './types.js';

export type StudySessionArtifacts = {
  bookContextUsed: BookSnippet[];
  correctedTranscript: string;
  detectedTopics: DetectedTopic[];
  polishingResult: LessonPolishingResult | null;
  reviewItems: string[];
  summary: string;
};

export function applyStudySessionArtifacts(session: StudySession, artifacts: StudySessionArtifacts): StudySession {
  return {
    ...session,
    ...artifacts,
  };
}

export function isStudySessionForLesson(
  session: StudySession | null | undefined,
  courseId: string | undefined,
  lessonId: string | undefined,
): boolean {
  return Boolean(
    session
    && courseId
    && lessonId
    && session.courseId === courseId
    && session.lessonId === lessonId,
  );
}
