import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, BookMarked, GraduationCap, LayoutList, MoveRight, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { BookDocument, Course, Lesson, LessonSessionRecord } from '../../shared/types.js';

type CourseScreenProps = {
  activeCourse: Course | null;
  activeLesson: Lesson | null;
  onOpenLesson: (lesson: Lesson) => void;
  onSelectCourse: (course: Course | null) => void;
  onSelectLesson: (lesson: Lesson | null) => void;
};

export function CourseScreen({
  activeCourse,
  activeLesson,
  onOpenLesson,
  onSelectCourse,
  onSelectLesson,
}: CourseScreenProps) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [books, setBooks] = useState<BookDocument[]>([]);
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseDescription, setNewCourseDescription] = useState('');
  const [newLessonName, setNewLessonName] = useState('');
  const [isCreatingCourse, setIsCreatingCourse] = useState(false);
  const [isCreatingLesson, setIsCreatingLesson] = useState(false);
  const [isImportingSource, setIsImportingSource] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lessonSessionRecords, setLessonSessionRecords] = useState<LessonSessionRecord[]>([]);
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);
  const [sessionOrganizerError, setSessionOrganizerError] = useState<string | null>(null);
  const [sessionOrganizerMessage, setSessionOrganizerMessage] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState<string | null>(null);
  const [targetLessonBySession, setTargetLessonBySession] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const studyCapture = window.studyCapture;

    if (!studyCapture) return;

    studyCapture.listCourses().then((list) => {
      if (!cancelled) setCourses(list);
    }).catch((err) => {
      if (!cancelled) setLoadError(err.message);
    });

    studyCapture.listBookDocuments().then((list) => {
      if (!cancelled) setBooks(list);
    });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!activeCourse) {
      setLessons([]);
      return;
    }

    let cancelled = false;
    window.studyCapture?.listLessons(activeCourse.id).then((list) => {
      if (!cancelled) setLessons(list);
    });

    return () => { cancelled = true; };
  }, [activeCourse]);

  useEffect(() => {
    let cancelled = false;

    async function loadLessonSessions() {
      if (!activeCourse || !activeLesson) {
        setLessonSessionRecords([]);
        setSessionOrganizerError(null);
        setSessionOrganizerMessage(null);
        return;
      }

      try {
        const records = await window.studyCapture?.listLessonSessionRecords({
          courseId: activeCourse.id,
          lessonId: activeLesson.id,
        }) ?? [];
        if (!cancelled) {
          setLessonSessionRecords(records);
          setSessionOrganizerError(null);
          setTargetLessonBySession((current) => {
            const next: Record<string, string> = {};
            for (const record of records) {
              next[record.sessionId] = current[record.sessionId] ?? activeLesson.id;
            }
            return next;
          });
        }
      } catch (err) {
        if (!cancelled) {
          setLessonSessionRecords([]);
          setSessionOrganizerError(err instanceof Error ? err.message : 'Failed to load lesson sessions');
        }
      }
    }

    void loadLessonSessions();

    return () => { cancelled = true; };
  }, [activeCourse?.id, activeLesson?.id]);

  async function handleCreateCourse() {
    if (!newCourseName.trim()) return;

    try {
      const course = await window.studyCapture?.createCourse({
        name: newCourseName,
        description: newCourseDescription,
      });
      if (course) {
        setCourses([...courses, course]);
        onSelectCourse(course);
        setNewCourseName('');
        setNewCourseDescription('');
        setIsCreatingCourse(false);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to create course');
    }
  }

  async function handleDeleteCourse(id: string) {
    if (!confirm('Are you sure you want to delete this course and all its lessons?')) return;

    try {
      await window.studyCapture?.deleteCourse(id);
      setCourses(courses.filter((c) => c.id !== id));
      if (activeCourse?.id === id) {
        onSelectCourse(null);
        onSelectLesson(null);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to delete course');
    }
  }

  async function handleCreateLesson() {
    if (!activeCourse || !newLessonName.trim()) return;

    try {
      const lesson = await window.studyCapture?.createLesson({
        courseId: activeCourse.id,
        name: newLessonName,
      });
      if (lesson) {
        setLessons([...lessons, lesson]);
        onSelectLesson(lesson);
        setNewLessonName('');
        setIsCreatingLesson(false);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to create lesson');
    }
  }

  async function handleDeleteLesson(id: string) {
    if (!confirm('Are you sure you want to delete this lesson?')) return;

    try {
      await window.studyCapture?.deleteLesson(id);
      setLessons(lessons.filter((l) => l.id !== id));
      if (activeLesson?.id === id) {
        onSelectLesson(null);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to delete lesson');
    }
  }

  async function refreshActiveLessonState(nextActiveLessonId = activeLesson?.id) {
    if (!activeCourse || !window.studyCapture) return;

    const nextLessons = await window.studyCapture.listLessons(activeCourse.id);
    setLessons(nextLessons);

    if (nextActiveLessonId) {
      const nextActiveLesson = nextLessons.find((lesson) => lesson.id === nextActiveLessonId) ?? null;
      onSelectLesson(nextActiveLesson);
      if (nextActiveLesson) {
        const records = await window.studyCapture.listLessonSessionRecords({
          courseId: activeCourse.id,
          lessonId: nextActiveLesson.id,
        });
        setLessonSessionRecords(records);
      } else {
        setLessonSessionRecords([]);
      }
    }
  }

  async function handleRefreshLessonSessions() {
    try {
      setSessionOrganizerError(null);
      setSessionOrganizerMessage(null);
      await refreshActiveLessonState();
    } catch (err) {
      setSessionOrganizerError(err instanceof Error ? err.message : 'Failed to refresh lesson sessions');
    }
  }

  async function handleMoveLessonSession(sessionId: string) {
    if (!activeCourse || !activeLesson || !window.studyCapture?.attachSessionHistoryToLesson) return;

    const targetLessonId = targetLessonBySession[sessionId] ?? activeLesson.id;
    if (!targetLessonId || targetLessonId === activeLesson.id) return;

    const targetLesson = lessons.find((lesson) => lesson.id === targetLessonId);
    if (!targetLesson) return;

    try {
      setSessionActionId(sessionId);
      setSessionOrganizerError(null);
      setSessionOrganizerMessage(null);
      await window.studyCapture.attachSessionHistoryToLesson({
        courseId: activeCourse.id,
        lessonId: targetLesson.id,
        sessionId,
      });
      await refreshActiveLessonState(activeLesson.id);
      setSessionOrganizerMessage(`Session moved to ${targetLesson.name}.`);
    } catch (err) {
      setSessionOrganizerError(err instanceof Error ? err.message : 'Failed to move session');
    } finally {
      setSessionActionId(null);
    }
  }

  async function handleReorderLessonSession(sessionId: string, direction: -1 | 1) {
    if (!activeCourse || !activeLesson || !window.studyCapture?.updateLessonSessionOrder) return;

    const currentIndex = lessonSessionRecords.findIndex((record) => record.sessionId === sessionId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= lessonSessionRecords.length) return;

    const nextRecords = [...lessonSessionRecords];
    const [movedRecord] = nextRecords.splice(currentIndex, 1);
    if (!movedRecord) return;
    nextRecords.splice(nextIndex, 0, movedRecord);

    try {
      setSessionActionId(sessionId);
      setSessionOrganizerError(null);
      setSessionOrganizerMessage(null);
      const updatedLesson = await window.studyCapture.updateLessonSessionOrder({
        courseId: activeCourse.id,
        lessonId: activeLesson.id,
        sessionIds: nextRecords.map((record) => record.sessionId),
      });
      setLessonSessionRecords(nextRecords);
      setLessons((current) => current.map((lesson) => (lesson.id === updatedLesson.id ? updatedLesson : lesson)));
      onSelectLesson(updatedLesson);
      setSessionOrganizerMessage('Lesson session order updated.');
    } catch (err) {
      setSessionOrganizerError(err instanceof Error ? err.message : 'Failed to update session order');
    } finally {
      setSessionActionId(null);
    }
  }

  async function handleToggleBook(bookId: string) {
    if (!activeCourse) return;

    const bookIds = activeCourse.bookIds.includes(bookId)
      ? activeCourse.bookIds.filter((id) => id !== bookId)
      : [...activeCourse.bookIds, bookId];

    try {
      const updated = await window.studyCapture?.updateCourse(activeCourse.id, { bookIds });
      if (updated) {
        setCourses(courses.map((c) => (c.id === updated.id ? updated : c)));
        onSelectCourse(updated);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to update course books');
    }
  }

  async function handleFileUpload() {
    if (!activeCourse || !window.studyCapture?.importBookFile) return;

    try {
      setIsImportingSource(true);
      setLoadError(null);
      setSourceStatus('Importing source...');
      const book = await window.studyCapture.importBookFile({ courseId: activeCourse.id });
      if (book) {
        setBooks((current) => [book, ...current]);
        const bookIds = [...activeCourse.bookIds, book.id];
        const updated = await window.studyCapture.updateCourse(activeCourse.id, { bookIds });
        if (updated) {
          setCourses(courses.map((c) => (c.id === updated.id ? updated : c)));
          onSelectCourse(updated);
        }
        setSourceStatus(`Imported ${book.filename ?? book.name} (${book.fileType}).`);
      } else {
        setSourceStatus(null);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to upload file');
      setSourceStatus(null);
    } finally {
      setIsImportingSource(false);
    }
  }

  return (
    <div className="course-screen-layout">
      <aside className="course-sidebar">
        <div className="sidebar-head">
          <GraduationCap size={20} />
          <h3>Courses</h3>
          <button
            type="button"
            className="icon-button"
            onClick={() => setIsCreatingCourse(true)}
            title="Create new course"
          >
            <Plus size={18} />
          </button>
        </div>

        <div className="course-list scrollable">
          {courses.length === 0 ? (
            <div className="empty-state-mini">No courses created yet.</div>
          ) : (
            courses.map((course) => (
              <div
                key={course.id}
                className={activeCourse?.id === course.id ? 'course-item active' : 'course-item'}
              >
                <button
                  type="button"
                  className="course-select-button"
                  onClick={() => {
                    onSelectCourse(course);
                    onSelectLesson(null);
                  }}
                >
                  <strong>{course.name}</strong>
                  <p>{course.description || 'No description'}</p>
                </button>
                <button
                  type="button"
                  className="delete-item-button"
                  onClick={() => handleDeleteCourse(course.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <main className="course-main">
        {loadError && (
          <div className="alert-panel danger">
            <p>{loadError}</p>
          </div>
        )}

        {isCreatingCourse && (
          <section className="modal-overlay">
            <div className="modal-content">
              <h3>Create New Course</h3>
              <div className="form-group">
                <label>Course Name</label>
                <input
                  type="text"
                  value={newCourseName}
                  onChange={(e) => setNewCourseName(e.target.value)}
                  placeholder="e.g. Arabic Grammar 101"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newCourseDescription}
                  onChange={(e) => setNewCourseDescription(e.target.value)}
                  placeholder="Short summary of the course..."
                />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setIsCreatingCourse(false)}>Cancel</button>
                <button type="button" className="primary" onClick={handleCreateCourse}>Create Course</button>
              </div>
            </div>
          </section>
        )}

        {activeCourse ? (
          <div className="course-detail-view">
            <div className="detail-head">
              <h2>{activeCourse.name}</h2>
              <p>{activeCourse.description}</p>
            </div>

            <div className="detail-grid">
              <section className="detail-section">
                <div className="section-title">
                  <LayoutList size={18} />
                  <h3>Lessons</h3>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setIsCreatingLesson(true)}
                  >
                    <Plus size={18} />
                  </button>
                </div>

                <div className="lesson-list">
                  {lessons.length === 0 ? (
                    <div className="empty-state-mini">No lessons added to this course.</div>
                  ) : (
                    lessons.map((lesson) => (
                      <div
                        key={lesson.id}
                        className={activeLesson?.id === lesson.id ? 'lesson-item active' : 'lesson-item'}
                      >
                        <button
                          type="button"
                          className="lesson-select-button"
                          onClick={() => onOpenLesson(lesson)}
                          title="Open lesson on Dashboard"
                        >
                          <span>{lesson.name}</span>
                        </button>
                        <div className="lesson-meta">
                          <small>{lesson.sessionIds.length} sessions</small>
                          <small>{lesson.lastPolishingResult ? 'saved polish' : 'no polish'}</small>
                          <button
                            type="button"
                            className="delete-item-button"
                            onClick={() => handleDeleteLesson(lesson.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {isCreatingLesson && (
                  <div className="inline-form">
                    <input
                      type="text"
                      value={newLessonName}
                      onChange={(e) => setNewLessonName(e.target.value)}
                      placeholder="Lesson name..."
                      autoFocus
                    />
                    <div className="form-actions">
                      <button type="button" onClick={() => setIsCreatingLesson(false)}>Cancel</button>
                      <button type="button" className="primary" onClick={handleCreateLesson}>Add</button>
                    </div>
                  </div>
                )}
              </section>

              <section className="detail-section lesson-session-organizer">
                <div className="section-title">
                  <MoveRight size={18} />
                  <h3>Lesson Sessions</h3>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void handleRefreshLessonSessions()}
                    title="Refresh lesson sessions"
                  >
                    <RefreshCw size={18} />
                  </button>
                </div>

                {!activeLesson ? (
                  <div className="empty-state-mini">Select a lesson to move sessions and set transcript order.</div>
                ) : lessonSessionRecords.length === 0 ? (
                  <div className="empty-state-mini">No autosaved sessions are attached to this lesson yet.</div>
                ) : (
                  <div className="lesson-session-list">
                    {lessonSessionRecords.map((record, index) => {
                      const targetLessonId = targetLessonBySession[record.sessionId] ?? activeLesson.id;
                      const isBusy = sessionActionId === record.sessionId;

                      return (
                        <article key={record.sessionId} className="lesson-session-card">
                          <div className="lesson-session-copy">
                            <strong>{record.title}</strong>
                            <span>{formatLessonSessionDate(record.date)} | {record.rawTranscript.trim().length.toLocaleString()} chars</span>
                            <small>{record.sessionId}</small>
                          </div>
                          <div className="lesson-session-actions">
                            <button
                              type="button"
                              className="session-order-button"
                              disabled={index === 0 || isBusy}
                              onClick={() => void handleReorderLessonSession(record.sessionId, -1)}
                              title="Move up"
                            >
                              <ArrowUp size={15} />
                            </button>
                            <button
                              type="button"
                              className="session-order-button"
                              disabled={index === lessonSessionRecords.length - 1 || isBusy}
                              onClick={() => void handleReorderLessonSession(record.sessionId, 1)}
                              title="Move down"
                            >
                              <ArrowDown size={15} />
                            </button>
                            <select
                              value={targetLessonId}
                              disabled={isBusy}
                              onChange={(event) => {
                                setTargetLessonBySession((current) => ({
                                  ...current,
                                  [record.sessionId]: event.target.value,
                                }));
                              }}
                            >
                              {lessons.map((lesson) => (
                                <option key={lesson.id} value={lesson.id}>{lesson.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="compact-move-button"
                              disabled={isBusy || !targetLessonId || targetLessonId === activeLesson.id}
                              onClick={() => void handleMoveLessonSession(record.sessionId)}
                            >
                              {isBusy ? 'Moving...' : 'Move'}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}

                {sessionOrganizerMessage ? <div className="inline-notice success">{sessionOrganizerMessage}</div> : null}
                {sessionOrganizerError ? <div className="inline-notice danger">{sessionOrganizerError}</div> : null}
              </section>

              <section className="detail-section">
                <div className="section-title">
                  <BookMarked size={18} />
                  <h3>Associated Books</h3>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={isImportingSource}
                    onClick={() => void handleFileUpload()}
                    title="Upload PDF, DOCX, or TXT"
                  >
                    <Upload size={18} />
                  </button>
                </div>
                {sourceStatus ? (
                  <div className="inline-notice neutral">{sourceStatus}</div>
                ) : null}
                <div className="book-assignment">
                  {books.length === 0 ? (
                    <div className="empty-state-mini">No books imported yet. Go to Book tab.</div>
                  ) : (
                    books.map((book) => (
                      <label key={book.id} className="book-toggle">
                        <input
                          type="checkbox"
                          checked={activeCourse.bookIds.includes(book.id)}
                          onChange={() => handleToggleBook(book.id)}
                        />
                        <span>{book.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <GraduationCap size={48} />
            <h2>Select or create a course to get started</h2>
            <p>Organizing your study into courses and lessons helps track your progress.</p>
            <button type="button" className="primary-button" onClick={() => setIsCreatingCourse(true)}>
              <Plus size={18} />
              <span>Create your first course</span>
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function formatLessonSessionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
