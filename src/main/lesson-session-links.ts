import type { Lesson } from '../shared/types.js';

export type SessionLessonLink = {
  courseId: string;
  lessonId: string;
  sessionId: string;
};

export type LessonLinkUpdate = {
  changed: boolean;
  lessons: Lesson[];
};

export type LessonSessionOrderUpdate = LessonLinkUpdate & {
  lesson: Lesson | null;
};

function uniqueSessionIds(sessionIds: string[]): string[] {
  return [...new Set(sessionIds.map((sessionId) => sessionId.trim()).filter(Boolean))];
}

export function linkSessionToLesson(lessons: Lesson[], link: SessionLessonLink): LessonLinkUpdate {
  let changed = false;
  const nextLessons = lessons.map((lesson) => {
    if (lesson.id === link.lessonId && lesson.courseId === link.courseId) {
      if (lesson.sessionIds.includes(link.sessionId)) {
        return lesson;
      }

      changed = true;
      return {
        ...lesson,
        sessionIds: [...lesson.sessionIds, link.sessionId],
      };
    }

    if (lesson.sessionIds.includes(link.sessionId)) {
      changed = true;
      return {
        ...lesson,
        sessionIds: lesson.sessionIds.filter((sessionId) => sessionId !== link.sessionId),
      };
    }

    return lesson;
  });

  return { changed, lessons: nextLessons };
}

export function reorderLessonSessions(
  lessons: Lesson[],
  payload: { courseId: string; lessonId: string; sessionIds: string[] },
): LessonSessionOrderUpdate {
  let changed = false;
  let updatedLesson: Lesson | null = null;
  const requestedSessionIds = uniqueSessionIds(payload.sessionIds);

  const nextLessons = lessons.map((lesson) => {
    if (lesson.id !== payload.lessonId || lesson.courseId !== payload.courseId) {
      return lesson;
    }

    const currentSessionIdSet = new Set(lesson.sessionIds);
    const orderedSessionIds = [
      ...requestedSessionIds.filter((sessionId) => currentSessionIdSet.has(sessionId)),
      ...lesson.sessionIds.filter((sessionId) => !requestedSessionIds.includes(sessionId)),
    ];

    const isSameOrder = orderedSessionIds.length === lesson.sessionIds.length
      && orderedSessionIds.every((sessionId, index) => sessionId === lesson.sessionIds[index]);

    updatedLesson = isSameOrder ? lesson : { ...lesson, sessionIds: orderedSessionIds };
    changed = changed || !isSameOrder;
    return updatedLesson;
  });

  return { changed, lesson: updatedLesson, lessons: nextLessons };
}

export function repairLessonSessionLinks(lessons: Lesson[], links: SessionLessonLink[]): LessonLinkUpdate {
  return links.reduce<LessonLinkUpdate>((current, link) => {
    const next = linkSessionToLesson(current.lessons, link);
    return {
      changed: current.changed || next.changed,
      lessons: next.lessons,
    };
  }, { changed: false, lessons });
}

export function unlinkSessionFromLessons(lessons: Lesson[], sessionId: string): LessonLinkUpdate {
  let changed = false;
  const nextLessons = lessons.map((lesson) => {
    if (!lesson.sessionIds.includes(sessionId)) {
      return lesson;
    }

    changed = true;
    return {
      ...lesson,
      sessionIds: lesson.sessionIds.filter((currentSessionId) => currentSessionId !== sessionId),
    };
  });

  return { changed, lessons: nextLessons };
}

export function clearLessonSessionLinks(lessons: Lesson[]): LessonLinkUpdate {
  let changed = false;
  const nextLessons = lessons.map((lesson) => {
    if (lesson.sessionIds.length === 0) {
      return lesson;
    }

    changed = true;
    return {
      ...lesson,
      sessionIds: [],
    };
  });

  return { changed, lessons: nextLessons };
}
