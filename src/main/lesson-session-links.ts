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
