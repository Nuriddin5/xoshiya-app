import { useEffect, useState, type ReactNode } from 'react';
import type { Course, Lesson, SessionExportSummary, StorageEnvironment } from '../../shared/types.js';

type HistoryScreenProps = {
  activeSaveFolder: string | null;
  storageEnvironment: StorageEnvironment | null;
};

type LoadState = 'loading' | 'ready' | 'error';

function storageEnvironmentLabel(storageEnvironment: StorageEnvironment | null): string {
  return storageEnvironment === 'main' ? 'Development / main' : storageEnvironment === 'production' ? 'Production' : 'Loading...';
}

export function HistoryScreen({ activeSaveFolder, storageEnvironment }: HistoryScreenProps) {
  const [historySessions, setHistorySessions] = useState<SessionExportSummary[]>([]);
  const [savedSessions, setSavedSessions] = useState<SessionExportSummary[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [lessonsByCourseId, setLessonsByCourseId] = useState<Record<string, Lesson[]>>({});
  const [selectedCourseBySession, setSelectedCourseBySession] = useState<Record<string, string>>({});
  const [selectedLessonBySession, setSelectedLessonBySession] = useState<Record<string, string>>({});
  const [attachingSessionId, setAttachingSessionId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      if (!activeSaveFolder) {
        if (!cancelled) {
          setLoadState('loading');
          setHistorySessions([]);
          setSavedSessions([]);
          setError(null);
        }
        return;
      }

      if (
        !window.studyCapture?.listSessionHistory
        || !window.studyCapture.listSessionExports
        || !window.studyCapture.listCourses
        || !window.studyCapture.listLessons
      ) {
        if (!cancelled) {
          setLoadState('error');
          setError('History bridge unavailable. Restart the app to reload the preload bridge.');
          setHistorySessions([]);
          setSavedSessions([]);
          setCourses([]);
          setLessonsByCourseId({});
        }
        return;
      }

      if (!cancelled) {
        setLoadState('loading');
        setActionMessage(null);
        setError(null);
      }

      try {
        const [nextHistorySessions, nextSavedSessions, nextCourses] = await Promise.all([
          window.studyCapture.listSessionHistory(),
          window.studyCapture.listSessionExports(),
          window.studyCapture.listCourses(),
        ]);
        const lessonEntries = await Promise.all(
          nextCourses.map(async (course) => [course.id, await window.studyCapture!.listLessons(course.id)] as const),
        );
        const nextLessonsByCourseId = Object.fromEntries(lessonEntries);

        if (!cancelled) {
          setHistorySessions(nextHistorySessions);
          setSavedSessions(nextSavedSessions);
          setCourses(nextCourses);
          setLessonsByCourseId(nextLessonsByCourseId);
          setSelectedCourseBySession((current) => seedCourseSelections(current, nextHistorySessions, nextCourses));
          setSelectedLessonBySession((current) => seedLessonSelections(current, nextHistorySessions, nextLessonsByCourseId));
          setLoadState('ready');
        }
      } catch (loadError) {
        if (!cancelled) {
          setHistorySessions([]);
          setSavedSessions([]);
          setCourses([]);
          setLessonsByCourseId({});
          setLoadState('error');
          const message = loadError instanceof Error ? loadError.message : 'Failed to load session history.';
          setError(`Could not load session history. ${message}`);
        }
      }
    }

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [reloadKey, activeSaveFolder]);

  async function openMarkdown(session: SessionExportSummary) {
    if (!window.studyCapture?.openSessionExportMarkdown) {
      throw new Error('Markdown opener unavailable. Restart the app to reload the preload bridge.');
    }

    await window.studyCapture.openSessionExportMarkdown(session.markdownPath);
  }

  async function openFolder(session: SessionExportSummary) {
    if (!window.studyCapture?.openSessionExportFolder) {
      throw new Error('Folder opener unavailable. Restart the app to reload the preload bridge.');
    }

    await window.studyCapture.openSessionExportFolder(session.folderPath);
  }

  async function handleAction(action: () => Promise<boolean | void>, successMessage: string) {
    try {
      setError(null);
      setActionMessage(null);
      const completed = await action();
      if (completed !== false) {
        setActionMessage(successMessage);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'History action failed.');
    }
  }

  async function deleteHistorySession(session: SessionExportSummary) {
    if (!window.studyCapture?.deleteSessionHistory) {
      throw new Error('History delete bridge unavailable. Restart the app to reload the preload bridge.');
    }

    await window.studyCapture.deleteSessionHistory(session.sessionId);
    setReloadKey((current) => current + 1);
  }

  async function clearHistory(): Promise<boolean> {
    if (!window.studyCapture?.clearSessionHistory) {
      throw new Error('History clear bridge unavailable. Restart the app to reload the preload bridge.');
    }

    const confirmed = window.confirm('Clear autosaved history? Saved exports will not be deleted.');
    if (!confirmed) {
      return false;
    }

    await window.studyCapture.clearSessionHistory();
    setReloadKey((current) => current + 1);
    return true;
  }

  function getSelectedCourseId(session: SessionExportSummary): string {
    return selectedCourseBySession[session.sessionId] ?? session.courseId ?? courses[0]?.id ?? '';
  }

  function getSelectedLessonId(session: SessionExportSummary): string {
    const selectedCourseId = getSelectedCourseId(session);
    return selectedLessonBySession[session.sessionId]
      ?? (session.courseId === selectedCourseId ? session.lessonId : undefined)
      ?? lessonsByCourseId[selectedCourseId]?.[0]?.id
      ?? '';
  }

  function handleCourseSelection(session: SessionExportSummary, courseId: string) {
    const firstLessonId = lessonsByCourseId[courseId]?.[0]?.id ?? '';
    setSelectedCourseBySession((current) => ({ ...current, [session.sessionId]: courseId }));
    setSelectedLessonBySession((current) => ({ ...current, [session.sessionId]: firstLessonId }));
  }

  async function attachHistorySession(session: SessionExportSummary): Promise<void> {
    if (!window.studyCapture?.attachSessionHistoryToLesson) {
      throw new Error('History attachment bridge unavailable. Restart the app to reload the preload bridge.');
    }

    const courseId = getSelectedCourseId(session);
    const lessonId = getSelectedLessonId(session);
    if (!courseId || !lessonId) {
      throw new Error('Select a course and lesson before attaching this history entry.');
    }

    setAttachingSessionId(session.sessionId);
    try {
      await window.studyCapture.attachSessionHistoryToLesson({
        courseId,
        lessonId,
        sessionId: session.sessionId,
      });
      setReloadKey((current) => current + 1);
    } finally {
      setAttachingSessionId(null);
    }
  }

  const historyCount = historySessions.length;
  const savedCount = savedSessions.length;
  const newestHistorySession = historySessions[0] ?? null;

  return (
    <div className="grid gap-6 2xl:grid-cols-[0.94fr_1.06fr]">
      <div className="min-w-0 space-y-4">
        <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-glow">
          <p className="text-xs uppercase tracking-[0.28em] text-amber-300/70">History</p>
          <h3 className="mt-2 text-3xl font-semibold text-white">Autosaved session history</h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            History is now the live autosave trail for recording sessions. Saved exports are listed separately, so reset
            actions and manual exports do not erase the latest captured transcript history.
          </p>

          <div className="mt-6 grid gap-3 lg:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-4 lg:col-span-3">
              <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Active root</div>
              <div className="mt-2 text-sm text-white">{storageEnvironmentLabel(storageEnvironment)}</div>
              <div className="mt-1 break-words font-mono text-xs text-slate-300">{activeSaveFolder ?? 'Loading settings...'}</div>
            </div>
            <StatTile label="History entries" value={loadState === 'ready' ? String(historyCount) : 'Loading'} />
            <StatTile label="Saved exports" value={loadState === 'ready' ? String(savedCount) : 'Loading'} />
            <StatTile label="Retention" value="7 days" />
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-4 text-sm leading-6 text-slate-300">
            Autosaved history is stored in the active root under <span className="font-mono text-slate-100">_history</span>.
            Entries older than 7 days are cleaned automatically when history is loaded or updated.
          </div>

          {newestHistorySession ? (
            <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-100/80">Latest autosave</div>
              <div className="mt-2 text-sm font-semibold text-white">{newestHistorySession.title}</div>
              <div className="mt-1 text-sm text-cyan-50/80">Updated {formatDateTime(newestHistorySession.exportedAt)}</div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!activeSaveFolder || loadState === 'loading'}
              onClick={() => setReloadKey((current) => current + 1)}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium uppercase tracking-[0.24em] text-slate-300 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              type="button"
              disabled={!activeSaveFolder || loadState === 'loading' || historyCount === 0}
              onClick={() => void handleAction(clearHistory, 'History cleared. Saved exports were not changed.')}
              className="rounded-full border border-rose-300/20 bg-rose-500/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.24em] text-rose-100 transition hover:border-rose-200/40 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear history
            </button>
          </div>

          {actionMessage ? (
            <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50">
              {actionMessage}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
        </section>

        <aside className="space-y-4 rounded-[28px] border border-white/10 bg-slate-950/45 p-6">
          <InfoPanel title="Reset behavior">
            Resetting the recorder clears recorder controls, not the current autosaved session history.
          </InfoPanel>
          <InfoPanel title="Saved is separate">
            Exported notes remain in the root save folder and are listed under Saved. History cleanup does not delete them.
          </InfoPanel>
          <InfoPanel title="Manual cleanup">
            Use Clear history or Delete on a history card when you want to remove autosaved entries immediately.
          </InfoPanel>
        </aside>
      </div>

      <section className="min-w-0 space-y-5 rounded-[28px] border border-white/10 bg-slate-950/45 p-4 sm:p-6">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Session index</p>
          <h4 className="mt-2 text-xl font-semibold text-white">{loadState === 'loading' ? 'Loading sessions...' : 'History and Saved'}</h4>
        </div>

        {loadState === 'loading' ? (
          <div className="rounded-[24px] border border-dashed border-white/10 bg-slate-950/35 p-6 text-sm text-slate-300">
            {activeSaveFolder ? 'Scanning autosaved history and saved exports...' : 'Waiting for settings to load the active save folder...'}
          </div>
        ) : null}

        {loadState === 'error' ? (
          <div className="rounded-[24px] border border-rose-300/20 bg-rose-500/10 p-6 text-sm text-rose-100">
            {error ?? 'Unable to load history. Check the configured save folder and try again.'}
          </div>
        ) : null}

        {loadState === 'ready' ? (
          <>
            <SessionGroup
              emptyText="No autosaved history yet. Start recording or polish a transcript and the session will be saved here automatically."
              label="History"
              sessions={historySessions}
            >
              {historySessions.map((session) => (
                <SessionCard
                  key={`history-${session.sessionId}-${session.markdownPath}`}
                  attachmentControls={
                    <AttachmentControls
                      courses={courses}
                      isAttaching={attachingSessionId === session.sessionId}
                      lessons={lessonsByCourseId[getSelectedCourseId(session)] ?? []}
                      onAttach={() => void handleAction(() => attachHistorySession(session), 'History entry attached to lesson.')}
                      onCourseChange={(courseId) => handleCourseSelection(session, courseId)}
                      onLessonChange={(lessonId) => setSelectedLessonBySession((current) => ({ ...current, [session.sessionId]: lessonId }))}
                      selectedCourseId={getSelectedCourseId(session)}
                      selectedLessonId={getSelectedLessonId(session)}
                      session={session}
                    />
                  }
                  label="Autosaved history"
                  onDelete={() => void handleAction(() => deleteHistorySession(session), 'History entry deleted.')}
                  onOpenFolder={() => void handleAction(() => openFolder(session), 'Folder opened.')}
                  onOpenMarkdown={() => void handleAction(() => openMarkdown(session), 'Markdown opened.')}
                  session={session}
                  timestampLabel="Updated"
                />
              ))}
            </SessionGroup>

            <SessionGroup
              emptyText="No saved exports were found yet. Use Export Session from the dashboard to create a saved note."
              label="Saved"
              sessions={savedSessions}
            >
              {savedSessions.map((session) => (
                <SessionCard
                  key={`saved-${session.sessionId}-${session.markdownPath}`}
                  label="Saved export"
                  onOpenFolder={() => void handleAction(() => openFolder(session), 'Folder opened.')}
                  onOpenMarkdown={() => void handleAction(() => openMarkdown(session), 'Markdown opened.')}
                  session={session}
                  timestampLabel="Exported"
                />
              ))}
            </SessionGroup>
          </>
        ) : null}
      </section>
    </div>
  );
}

function seedCourseSelections(
  current: Record<string, string>,
  sessions: SessionExportSummary[],
  courses: Course[],
): Record<string, string> {
  const fallbackCourseId = courses[0]?.id ?? '';
  return sessions.reduce<Record<string, string>>((next, session) => {
    next[session.sessionId] = current[session.sessionId] ?? session.courseId ?? fallbackCourseId;
    return next;
  }, {});
}

function seedLessonSelections(
  current: Record<string, string>,
  sessions: SessionExportSummary[],
  lessonsByCourseId: Record<string, Lesson[]>,
): Record<string, string> {
  return sessions.reduce<Record<string, string>>((next, session) => {
    const courseId = session.courseId ?? Object.keys(lessonsByCourseId)[0] ?? '';
    next[session.sessionId] = current[session.sessionId]
      ?? session.lessonId
      ?? lessonsByCourseId[courseId]?.[0]?.id
      ?? '';
    return next;
  }, {});
}

type SessionGroupProps = {
  children: ReactNode;
  emptyText: string;
  label: string;
  sessions: SessionExportSummary[];
};

function SessionGroup({ children, emptyText, label, sessions }: SessionGroupProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h5 className="text-lg font-semibold text-white">{label}</h5>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
          {sessions.length} {sessions.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-white/10 bg-slate-950/35 p-6 text-sm text-slate-300">
          {emptyText}
        </div>
      ) : children}
    </div>
  );
}

type SessionCardProps = {
  attachmentControls?: ReactNode;
  label: string;
  onDelete?: () => void;
  onOpenFolder: () => void;
  onOpenMarkdown: () => void;
  session: SessionExportSummary;
  timestampLabel: string;
};

function SessionCard({ attachmentControls, label, onDelete, onOpenFolder, onOpenMarkdown, session, timestampLabel }: SessionCardProps) {
  return (
    <article className="min-w-0 rounded-[24px] border border-white/10 bg-white/5 p-4 shadow-[0_20px_60px_rgba(2,6,23,0.25)] sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{label}</p>
          <h6 className="mt-2 break-words text-xl font-semibold text-white sm:text-2xl">{session.title}</h6>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusBadge tone="cyan">{session.hasMarkdown ? 'Markdown ready' : 'Markdown missing'}</StatusBadge>
            <StatusBadge tone="amber">{session.hasJson ? 'JSON ready' : 'JSON missing'}</StatusBadge>
          </div>
        </div>

        <div className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3 text-left lg:w-auto lg:max-w-[18rem] lg:text-right">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Session date</div>
          <div className="mt-2 break-words text-sm font-medium text-white">{formatDateTime(session.date)}</div>
          <div className="mt-1 break-words text-xs text-slate-500">{timestampLabel} {formatDateTime(session.exportedAt)}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <InfoTile label="Source" value={session.source} />
        <InfoTile label="Key topics" value={`${session.topicCount} topic${session.topicCount === 1 ? '' : 's'}`} />
        <InfoTile label="Folder" value={session.folderPath} mono />
      </div>

      {attachmentControls}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!session.hasMarkdown}
          onClick={onOpenMarkdown}
          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:border-cyan-300/30 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Open Markdown
        </button>
        <button
          type="button"
          onClick={onOpenFolder}
          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/10"
        >
          Open folder
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-100 transition hover:border-rose-200/40 hover:bg-rose-500/20"
          >
            Delete history
          </button>
        ) : null}
      </div>
    </article>
  );
}

type AttachmentControlsProps = {
  courses: Course[];
  isAttaching: boolean;
  lessons: Lesson[];
  onAttach: () => void;
  onCourseChange: (courseId: string) => void;
  onLessonChange: (lessonId: string) => void;
  selectedCourseId: string;
  selectedLessonId: string;
  session: SessionExportSummary;
};

function AttachmentControls({
  courses,
  isAttaching,
  lessons,
  onAttach,
  onCourseChange,
  onLessonChange,
  selectedCourseId,
  selectedLessonId,
  session,
}: AttachmentControlsProps) {
  const isAttached = Boolean(session.courseId && session.lessonId);
  const attachedLabel = isAttached
    ? `Attached to ${session.courseName ?? 'course'} / ${session.lessonName ?? 'lesson'}`
    : 'Not attached to a lesson yet';

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Lesson attachment</div>
          <div className="mt-1 break-words text-sm text-white">{attachedLabel}</div>
        </div>
        <button
          type="button"
          disabled={courses.length === 0 || lessons.length === 0 || !selectedCourseId || !selectedLessonId || isAttaching}
          onClick={onAttach}
          className="w-full rounded-2xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-50 transition hover:border-emerald-200/40 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
        >
          {isAttaching ? 'Attaching...' : isAttached ? 'Move lesson' : 'Attach to lesson'}
        </button>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <label className="block min-w-0">
          <span className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Course</span>
          <select
            value={selectedCourseId}
            onChange={(event) => onCourseChange(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-300/40"
          >
            {courses.length === 0 ? <option value="">No courses</option> : null}
            {courses.map((course) => (
              <option key={course.id} value={course.id}>{course.name}</option>
            ))}
          </select>
        </label>

        <label className="block min-w-0">
          <span className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Lesson</span>
          <select
            value={selectedLessonId}
            onChange={(event) => onLessonChange(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-300/40"
          >
            {lessons.length === 0 ? <option value="">No lessons in course</option> : null}
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>{lesson.name}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

type StatusBadgeProps = {
  children: string;
  tone: 'amber' | 'cyan';
};

function StatusBadge({ children, tone }: StatusBadgeProps) {
  return (
    <span
      className={[
        'rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em]',
        tone === 'cyan'
          ? 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100'
          : 'border-amber-300/20 bg-amber-400/10 text-amber-100',
      ].join(' ')}
    >
      {children}
    </span>
  );
}

type InfoTileProps = {
  label: string;
  value: string;
  mono?: boolean;
};

function InfoTile({ label, value, mono = false }: InfoTileProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">{label}</div>
      <div className={['mt-2 text-sm text-white', mono ? 'break-all font-mono text-xs leading-5 text-slate-200' : 'break-words'].join(' ')}>
        {value}
      </div>
    </div>
  );
}

type StatTileProps = {
  label: string;
  value: string;
};

function StatTile({ label, value }: StatTileProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">{label}</div>
      <div className="mt-2 text-sm text-white">{value}</div>
    </div>
  );
}

type InfoPanelProps = {
  children: string;
  title: string;
};

function InfoPanel({ children, title }: InfoPanelProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
      <div className="text-sm font-semibold text-white">{title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-300">{children}</p>
    </div>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
