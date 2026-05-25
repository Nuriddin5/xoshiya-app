import { useEffect, useMemo, useState } from 'react';
import {
  BookMarked,
  BrainCircuit,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  FileDown,
  FileText,
  Library,
  ListChecks,
  Mic,
  MonitorUp,
  SearchCheck,
  SendHorizontal,
  Sparkles,
  TriangleAlert,
  GraduationCap,
  LayoutList,
  type LucideIcon,
} from 'lucide-react';
import type {
  AppSettings,
  BookSnippet,
  DesktopSourceSummary,
  DetectedTopic,
  LessonPolishingResult,
  LessonSourceReference,
  SessionExportResult,
  RubaiRuntimeStatus,
  SetupReadiness,
  StudySession,
  Course,
  Lesson,
  LessonSessionRecord,
} from '../../shared/types.js';
import { buildStudyReducerArtifacts } from '../../shared/study-reducer.js';
import { isStudySessionForLesson } from '../../shared/session-state.js';
import { buildSelectedLessonTranscript } from '../../shared/lesson-session-selection.js';
import { renderLessonPolishingMarkdown } from '../../shared/lesson-polishing.js';
import { RecorderControls } from './RecorderControls.js';
import { SourcePicker } from './SourcePicker.js';
import { TranscriptEditor } from './TranscriptEditor.js';
import type { Dispatch, SetStateAction } from 'react';
import type { RecorderSnapshot } from '../audio-recorder.js';

type DashboardProps = {
  settings: AppSettings;
  readiness: SetupReadiness;
  rubaiRuntime: RubaiRuntimeStatus | null;
  correctedTranscriptText: string;
  correctionEvidence: BookSnippet[];
  polishingResult: LessonPolishingResult | null;
  summaryText: string;
  session: StudySession | null;
  selectedBookSnippets: BookSnippet[];
  selectedSource: DesktopSourceSummary | null;
  activeCourse: Course | null;
  activeLesson: Lesson | null;
  onBookContextChange: (snippets: BookSnippet[]) => void;
  onCorrectedTranscriptTextChange: Dispatch<SetStateAction<string>>;
  onCorrectionEvidenceChange: Dispatch<SetStateAction<BookSnippet[]>>;
  onLearningArtifactsChange: (artifacts: { detectedTopics: DetectedTopic[]; reviewItems: string[] }) => void;
  onPolishingResultChange: Dispatch<SetStateAction<LessonPolishingResult | null>>;
  onExportSession: (session: StudySession) => Promise<SessionExportResult>;
  onSummaryTextChange: Dispatch<SetStateAction<string>>;
  onSessionChange: (session: StudySession | null) => void;
  onSelectSource: (source: DesktopSourceSummary) => void;
  onTranscriptSessionReset: () => void;
  onSelectCourse: (course: Course | null) => void;
  onSelectLesson: (lesson: Lesson | null) => void;
};

type BookSearchOptions = { documentIds?: string[] };

const dashboardActions = [
  { label: 'Polish transcript', description: 'Polish the Rubai transcript with available source context', Icon: Sparkles },
  { label: 'Retry polish', description: 'Rerun structured polishing for the current transcript', Icon: BrainCircuit },
  { label: 'Export session', description: 'Write Markdown and JSON to the save folder', Icon: FileDown },
  { label: 'Export selected lesson', description: 'Export the selected lesson parts as one continuous transcript', Icon: FileDown },
];

export function Dashboard({
  correctedTranscriptText,
  correctionEvidence,
  polishingResult,
  onExportSession,
  onCorrectionEvidenceChange,
  onCorrectedTranscriptTextChange,
  onBookContextChange,
  onLearningArtifactsChange,
  onPolishingResultChange,
  onSummaryTextChange,
  onSessionChange,
  onSelectSource,
  onTranscriptSessionReset,
  onSelectCourse,
  onSelectLesson,
  readiness,
  rubaiRuntime,
  session,
  selectedBookSnippets,
  selectedSource,
  settings,
  summaryText,
  activeCourse,
  activeLesson,
}: DashboardProps) {
  const [autoSnippetError, setAutoSnippetError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<'idle' | 'polishing' | 'retrying' | 'exporting' | 'exporting-lesson' | 'answering-question'>('idle');
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [lessonSessionLoadError, setLessonSessionLoadError] = useState<string | null>(null);
  const [lessonSessionRecords, setLessonSessionRecords] = useState<LessonSessionRecord[]>([]);
  const [selectedLessonSessionIds, setSelectedLessonSessionIds] = useState<string[]>([]);
  const [recorderSnapshot, setRecorderSnapshot] = useState<RecorderSnapshot | null>(null);
  const [bookSearchOptions, setBookSearchOptions] = useState<BookSearchOptions>({});
  const [lessonQuestion, setLessonQuestion] = useState('');
  const [lessonAnswer, setLessonAnswer] = useState<string | null>(null);
  const [lessonQuestionError, setLessonQuestionError] = useState<string | null>(null);
  const [lessonQuestionContext, setLessonQuestionContext] = useState<BookSnippet[]>([]);

  useEffect(() => {
    window.studyCapture?.listCourses().then(setCourses);
  }, []);

  useEffect(() => {
    if (activeCourse) {
      window.studyCapture?.listLessons(activeCourse.id).then(setLessons);
    } else {
      setLessons([]);
    }
  }, [activeCourse]);

  useEffect(() => {
    let cancelled = false;

    async function resolveBookSearchOptions() {
      if (!activeCourse || activeCourse.bookIds.length > 0) {
        setBookSearchOptions(activeCourse?.bookIds.length ? { documentIds: activeCourse.bookIds } : {});
        return;
      }

      try {
        const courseBooks = await window.studyCapture?.listBookDocuments({ courseId: activeCourse.id }) ?? [];
        if (!cancelled && courseBooks.length > 0) {
          setBookSearchOptions({ documentIds: courseBooks.map((book) => book.id) });
          return;
        }
      } catch (error) {
        console.warn('Failed to resolve course book context:', error);
      }

      if (!cancelled) {
        setBookSearchOptions({});
      }
    }

    void resolveBookSearchOptions();

    return () => {
      cancelled = true;
    };
  }, [activeCourse?.bookIds, activeCourse?.id]);

  const activeLessonSessionId = isStudySessionForLesson(session, activeCourse?.id, activeLesson?.id)
    ? session?.id ?? null
    : null;

  useEffect(() => {
    if (!activeCourse || !activeLesson) {
      setLessonSessionRecords([]);
      setSelectedLessonSessionIds([]);
      setLessonSessionLoadError(null);
      return;
    }

    let cancelled = false;
    window.studyCapture?.listLessonSessionRecords({ courseId: activeCourse.id, lessonId: activeLesson.id })
      .then((records) => {
        if (!cancelled) {
          setLessonSessionRecords(records);
          setSelectedLessonSessionIds(records.map((record) => record.sessionId));
          setLessonSessionLoadError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLessonSessionRecords([]);
          setSelectedLessonSessionIds([]);
          setLessonSessionLoadError(error instanceof Error ? error.message : 'Could not load lesson session parts.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeCourse?.id, activeLesson?.id, activeLessonSessionId]);

  const isRecorderReady = Boolean(readiness.isComplete && (rubaiRuntime?.isReady ?? false));
  const isTranscriptPolishReady = readiness.isComplete;
  const recorderStatus = recorderSnapshot?.status ?? 'idle';
  const isRecorderBusy = recorderStatus === 'starting'
    || recorderStatus === 'recording'
    || recorderStatus === 'pausing'
    || recorderStatus === 'paused'
    || recorderStatus === 'stopping'
    || recorderStatus === 'processing';
  const setupStatusMessage = !readiness.isComplete
    ? readiness.statusMessage
    : rubaiRuntime === null
      ? 'Checking local Rubai ASR status...'
      : rubaiRuntime.message;
  const rubaiStatusDetail = rubaiRuntime
    ? `${setupStatusMessage} ${formatRubaiWorkerDetail(rubaiRuntime)}`
    : setupStatusMessage;
  const visibleSession = activeLessonSessionId ? session : null;
  const sessionTitle = visibleSession?.title ?? 'No session available';
  const sessionSourceLabel = visibleSession ? `${visibleSession.sourceName} | ${formatTimestamp(visibleSession.startedAt)}` : 'Waiting for a recording session';
  const sessionStatusLabel = recorderSnapshot
    ? formatRecorderSnapshotLabel(recorderSnapshot)
    : visibleSession
      ? visibleSession.endedAt
        ? `Ended ${formatTimestamp(visibleSession.endedAt)}`
        : 'Recording in progress'
    : polishingResult
      ? 'Saved lesson polishing loaded'
      : 'No raw transcript has been aggregated yet';
  const selectedLessonSessionIdSet = useMemo(() => new Set(selectedLessonSessionIds), [selectedLessonSessionIds]);
  const combinedLessonTranscript = useMemo(() => buildSelectedLessonTranscript(
    lessonSessionRecords,
    selectedLessonSessionIds,
    visibleSession
      ? { rawTranscript: visibleSession.rawTranscript, sessionId: visibleSession.id }
      : null,
  ), [lessonSessionRecords, selectedLessonSessionIds, visibleSession?.id, visibleSession?.rawTranscript]);
  const rawTranscript = combinedLessonTranscript || visibleSession?.rawTranscript || polishingResult?.rawTranscript || '';
  const analysisTranscript = correctedTranscriptText.trim() || rawTranscript;
  const studyReducerArtifacts = useMemo(
    () => buildStudyReducerArtifacts(analysisTranscript, correctionEvidence, selectedBookSnippets),
    [analysisTranscript, correctionEvidence, selectedBookSnippets],
  );
  const detectedTopics = polishingResult?.detectedTopics.length
    ? polishingResult.detectedTopics
    : studyReducerArtifacts.topics;
  const reviewItems = polishingResult?.reviewQuestions.length
    ? polishingResult.reviewQuestions
    : studyReducerArtifacts.reviewItems;
  const lessonSections = studyReducerArtifacts.sections;
  const sourceReferences = polishingResult?.sourceReferences ?? [];

  useEffect(() => {
    const studyCapture = window.studyCapture;
    if (!studyCapture?.searchBook || rawTranscript.trim().length < 40 || selectedBookSnippets.length > 0) {
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      studyCapture.searchBook(rawTranscript, bookSearchOptions).then((snippets) => {
        if (!cancelled) {
          onBookContextChange(snippets.slice(0, 3));
          setAutoSnippetError(null);
        }
      }).catch((error) => {
        if (!cancelled) {
          setAutoSnippetError(error instanceof Error ? error.message : 'Book context search failed.');
        }
      });
    }, 700);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [bookSearchOptions, onBookContextChange, rawTranscript, selectedBookSnippets.length]);

  useEffect(() => {
    onLearningArtifactsChange({ detectedTopics, reviewItems });
  }, [detectedTopics, onLearningArtifactsChange, reviewItems]);

  async function resolveBookContextForPolishing(): Promise<BookSnippet[]> {
    if (selectedBookSnippets.length > 0) {
      return selectedBookSnippets;
    }

    if (!window.studyCapture?.searchBook || !rawTranscript.trim()) {
      return [];
    }

    const snippets = await window.studyCapture.searchBook(rawTranscript, bookSearchOptions);
    const nextSnippets = snippets.slice(0, 4);
    onBookContextChange(nextSnippets);
    return nextSnippets;
  }

  async function persistLessonPolishing(result: LessonPolishingResult): Promise<void> {
    if (!activeLesson || !window.studyCapture?.updateLesson) {
      return;
    }

    const updatedLesson = await window.studyCapture.updateLesson(activeLesson.id, {
      lastPolishingResult: result,
    });
    setLessons((current) => current.map((lesson) => (lesson.id === updatedLesson.id ? updatedLesson : lesson)));
    onSelectLesson(updatedLesson);
  }

  async function runLessonPolishing(mode: 'polish' | 'retry') {
    if (!window.studyCapture?.polishLessonTranscript || !rawTranscript.trim()) {
      return;
    }

    try {
      setActionStatus(mode === 'retry' ? 'retrying' : 'polishing');
      setActionError(null);
      setActionMessage(null);

      const bookContext = await resolveBookContextForPolishing();
      const nextDetectedTopics = studyReducerArtifacts.topics;
      const result = await window.studyCapture.polishLessonTranscript({
        bookContext,
        courseId: activeCourse?.id,
        courseName: activeCourse?.name,
        detectedTopics: nextDetectedTopics,
        lessonId: activeLesson?.id,
        lessonName: activeLesson?.name,
        rawTranscript,
        selectedTopic: nextDetectedTopics[0]?.title,
      });

      onCorrectedTranscriptTextChange(result.correctedTranscript);
      onCorrectionEvidenceChange(result.bookContextUsed);
      onPolishingResultChange(result);
      onSummaryTextChange(renderLessonPolishingMarkdown(result));
      onLearningArtifactsChange({
        detectedTopics: result.detectedTopics,
        reviewItems: result.reviewQuestions,
      });
      await persistLessonPolishing(result);

      const messageParts = [
        mode === 'retry'
          ? 'Transcript polishing retried.'
          : activeLesson
            ? 'Transcript polished and attached to the selected lesson.'
            : 'Transcript polished.',
        result.contextWarning || (result.sourceReferences.length === 0 ? 'No strong source references were found for this run.' : ''),
      ].filter(Boolean);
      setActionMessage(messageParts.join(' '));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Lesson polishing failed.');
    } finally {
      setActionStatus('idle');
    }
  }

  async function handleExportSession() {
    if (!visibleSession) {
      return;
    }

    try {
      setActionStatus('exporting');
      setActionError(null);
      setActionMessage(null);
      const result = await onExportSession(visibleSession);
      setActionMessage(`Saved Markdown to ${result.markdownPath} and JSON to ${result.jsonPath}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Session export failed.');
    } finally {
      setActionStatus('idle');
    }
  }

  function handleLessonSessionSelection(sessionId: string, selected: boolean) {
    setSelectedLessonSessionIds((current) => {
      if (selected) {
        return current.includes(sessionId) ? current : [...current, sessionId];
      }

      return current.filter((currentSessionId) => currentSessionId !== sessionId);
    });
  }

  async function handleExportSelectedLesson() {
    if (!activeCourse || !activeLesson || !rawTranscript.trim()) {
      return;
    }

    const selectedRecords = lessonSessionRecords.filter((record) => selectedLessonSessionIdSet.has(record.sessionId));
    const timestamps = selectedRecords
      .map((record) => Date.parse(record.date))
      .filter((timestamp) => Number.isFinite(timestamp));
    const startedAt = timestamps.length > 0 ? Math.min(...timestamps) : visibleSession?.startedAt ?? Date.now();
    const endedAt = visibleSession?.endedAt ?? (timestamps.length > 0 ? Math.max(...timestamps) : null);
    const exportSession: StudySession = {
      bookContextUsed: selectedBookSnippets,
      correctedTranscript: correctedTranscriptText,
      courseId: activeCourse.id,
      courseName: activeCourse.name,
      detectedTopics,
      endedAt,
      id: `lesson-${activeLesson.id}-${Date.now()}`,
      lessonId: activeLesson.id,
      lessonName: activeLesson.name,
      polishingResult,
      rawTranscript,
      reviewItems,
      sourceName: selectedRecords.length > 0
        ? `Selected lesson parts (${selectedRecords.length})`
        : visibleSession?.sourceName ?? 'Selected lesson',
      startedAt,
      summary: summaryText,
      title: `${activeLesson.name} - selected lesson transcript`,
    };

    try {
      setActionStatus('exporting-lesson');
      setActionError(null);
      setActionMessage(null);
      const result = await onExportSession(exportSession);
      setActionMessage(`Saved selected lesson Markdown to ${result.markdownPath} and JSON to ${result.jsonPath}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Selected lesson export failed.');
    } finally {
      setActionStatus('idle');
    }
  }

  async function handleAskLessonQuestion() {
    const question = lessonQuestion.trim();
    if (!question || !window.studyCapture?.answerLessonQuestion) {
      return;
    }

    try {
      setActionStatus('answering-question');
      setLessonQuestionError(null);
      setLessonAnswer(null);

      const searchedSnippets = window.studyCapture.searchBook
        ? await window.studyCapture.searchBook(question, bookSearchOptions)
        : [];
      const contextSnippets = mergeBookSnippets(
        searchedSnippets,
        selectedBookSnippets,
        correctionEvidence,
        polishingResult?.bookContextUsed ?? [],
      ).slice(0, 6);
      setLessonQuestionContext(contextSnippets);

      const result = await window.studyCapture.answerLessonQuestion({
        bookContext: contextSnippets,
        courseName: activeCourse?.name,
        lessonName: activeLesson?.name,
        lessonOutput: summaryText.trim() || (polishingResult ? renderLessonPolishingMarkdown(polishingResult) : undefined),
        polishedLessonText: polishingResult?.correctedTranscript || correctedTranscriptText || rawTranscript || undefined,
        question,
      });

      setLessonAnswer(result.answerText);
      setLessonQuestionContext(result.bookContextUsed);
    } catch (error) {
      setLessonQuestionError(error instanceof Error ? error.message : 'Could not answer this question.');
    } finally {
      setActionStatus('idle');
    }
  }

  return (
    <div className="dashboard-layout">
      <section className="dashboard-main">
        <div className="capture-target-bar">
          <div className="capture-target-copy">
            <p className="eyebrow">Step 1</p>
            <h3>Course & Lesson</h3>
            <div className="selector-row">
              <div className="selector-group">
                <GraduationCap size={16} />
                <select
                  value={activeCourse?.id || ''}
                  onChange={(e) => {
                    const course = courses.find((c) => c.id === e.target.value);
                    onSelectCourse(course || null);
                    onSelectLesson(null);
                  }}
                >
                  <option value="">Select Course...</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="selector-group">
                <LayoutList size={16} />
                <select
                  value={activeLesson?.id || ''}
                  disabled={!activeCourse}
                  onChange={(e) => {
                    const lesson = lessons.find((l) => l.id === e.target.value);
                    onSelectLesson(lesson || null);
                  }}
                >
                  <option value="">Select Lesson...</option>
                  {lessons.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="capture-target-copy">
            <p className="eyebrow">Step 2</p>
            <h3>Capture target</h3>
            <strong>{selectedSource ? selectedSource.name : 'Choose a screen or window first'}</strong>
          </div>
          <button
            type="button"
            className="capture-target-button"
            onClick={() => setIsSourcePickerOpen(true)}
          >
            <MonitorUp size={18} />
            <span>{selectedSource ? 'Change target' : 'Choose target'}</span>
            <ExternalLink size={16} />
          </button>
        </div>

        <div className="session-command">
          <div>
            <p className="eyebrow">Current session</p>
            <h3>{sessionTitle}</h3>
            <p>{sessionSourceLabel}</p>
          </div>
          <div className={isRecorderReady ? 'record-state ready' : 'record-state blocked'}>
            {isRecorderReady ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}
            <span>{isRecorderReady ? 'Ready' : 'Blocked'}</span>
          </div>
        </div>

        <RecorderControls
          isSetupComplete={isRecorderReady}
          setupStatusMessage={setupStatusMessage}
          settings={settings}
          selectedSource={selectedSource}
          onRecorderSnapshotChange={setRecorderSnapshot}
          onSessionChange={onSessionChange}
          onTranscriptSessionReset={onTranscriptSessionReset}
          activeCourse={activeCourse}
          activeLesson={activeLesson}
        />

        <div className="action-grid">
          <WorkflowButton
            description={dashboardActions[0]!.description}
            disabled={!isTranscriptPolishReady || !rawTranscript.trim() || actionStatus !== 'idle' || isRecorderBusy}
            icon={dashboardActions[0]!.Icon}
            label={
              actionStatus === 'polishing'
                ? 'Polishing...'
                : dashboardActions[0]!.label
            }
            onClick={() => runLessonPolishing('polish')}
          />
          <WorkflowButton
            description={dashboardActions[1]!.description}
            disabled={!isTranscriptPolishReady || !rawTranscript.trim() || actionStatus !== 'idle' || isRecorderBusy}
            icon={dashboardActions[1]!.Icon}
            label={actionStatus === 'retrying' ? 'Retrying...' : dashboardActions[1]!.label}
            onClick={() => runLessonPolishing('retry')}
          />
          <WorkflowButton
            description={dashboardActions[2]!.description}
          disabled={!visibleSession || actionStatus !== 'idle' || isRecorderBusy}
            icon={dashboardActions[2]!.Icon}
            label={actionStatus === 'exporting' ? 'Exporting...' : dashboardActions[2]!.label}
            onClick={handleExportSession}
          />
          <WorkflowButton
            description={dashboardActions[3]!.description}
            disabled={!activeLesson || !rawTranscript.trim() || actionStatus !== 'idle' || isRecorderBusy}
            icon={dashboardActions[3]!.Icon}
            label={actionStatus === 'exporting-lesson' ? 'Exporting lesson...' : dashboardActions[3]!.label}
            onClick={handleExportSelectedLesson}
          />
        </div>

        {isRecorderBusy ? (
          <InlineNotice tone="success" message="Capture is still active or processing backlog. Use Force finish for stuck local transcription, or Reset recorder to clear the session state." />
        ) : null}
        {actionError ? <InlineNotice tone="danger" message={actionError} /> : null}
        {actionMessage ? <InlineNotice tone="success" message={actionMessage} /> : null}
        {lessonSessionLoadError ? <InlineNotice tone="danger" message={lessonSessionLoadError} /> : null}

        {activeLesson ? (
          <LessonSessionPartsPanel
            currentSessionId={visibleSession?.id ?? null}
            records={lessonSessionRecords}
            selectedSessionIds={selectedLessonSessionIds}
            onToggleSession={handleLessonSessionSelection}
          />
        ) : null}

        <div className="transcript-grid">
          <TranscriptEditor
            badge={combinedLessonTranscript ? 'Combined' : 'Live'}
            description={combinedLessonTranscript ? 'Selected lesson parts are combined in recording order.' : 'Finished chunks appear here automatically.'}
            label={combinedLessonTranscript ? 'Selected lesson transcript' : 'Raw transcript'}
            readOnly
            placeholder="Captured chunks will appear here."
            tone="raw"
            value={rawTranscript}
          />
          <TranscriptEditor
            badge="Draft"
            description="Edit the corrected transcript before generating notes."
            label="Corrected transcript"
            onChange={onCorrectedTranscriptTextChange}
            placeholder="Run correction, then refine the transcript."
            tone="corrected"
            value={correctedTranscriptText}
          />
        </div>

        <TranscriptEditor
          badge="Output"
          description="Structured lesson output with summary, terms, flashcards, questions, and source references."
          label="Lesson output"
          onChange={onSummaryTextChange}
          placeholder="Generated notes appear here."
          tone="notes"
          value={summaryText}
        />
      </section>

      <aside className="dashboard-side">
        <InfoPanel
          icon={CircleDot}
          title="Session state"
          value={sessionStatusLabel}
          detail={selectedSource ? `${selectedSource.type} | ${selectedSource.name}` : 'Choose a source before recording.'}
        />

        <InfoPanel
          icon={Mic}
          title="Local Rubai ASR"
          value={rubaiRuntime ? (rubaiRuntime.isReady ? `Ready (${rubaiRuntime.worker.state})` : 'Unavailable') : 'Loading...'}
          detail={rubaiStatusDetail}
          tone={rubaiRuntime ? (rubaiRuntime.isReady ? 'success' : 'danger') : 'neutral'}
        />

        <SnippetPanel
          icon={BookMarked}
          title="Relevant source context"
          empty="Import a book or record transcript text to auto-search context."
          snippets={selectedBookSnippets}
        />
        {autoSnippetError ? <InlineNotice tone="danger" message={autoSnippetError} /> : null}

        <SnippetPanel
          icon={FileText}
          title="Polishing context used"
          empty="Run lesson polishing to see which snippets shaped the output."
          snippets={correctionEvidence}
          showTerms
        />

        <SourceReferencePanel
          empty="Structured source references appear after lesson polishing runs."
          references={sourceReferences}
        />

        <ListPanel
          icon={BrainCircuit}
          title="Detected topics"
          subtitle={`${lessonSections.length} section${lessonSections.length === 1 ? '' : 's'}`}
          empty="Topics appear after transcript or book context exists."
          items={detectedTopics.map((topic) => topic.title)}
        />

        <ListPanel
          icon={ListChecks}
          title="Review list"
          empty="Review items are generated from detected topics and matched book terms."
          items={reviewItems}
        />

        <LessonQuestionPanel
          answer={lessonAnswer}
          contextSnippets={lessonQuestionContext}
          disabled={!isTranscriptPolishReady || actionStatus !== 'idle' || !lessonQuestion.trim()}
          error={lessonQuestionError}
          isLoading={actionStatus === 'answering-question'}
          question={lessonQuestion}
          onAsk={handleAskLessonQuestion}
          onQuestionChange={setLessonQuestion}
        />
      </aside>

      {isSourcePickerOpen ? (
        <SourcePicker
          selectedSource={selectedSource}
          onSelectSource={(source) => {
            onSelectSource(source);
            setIsSourcePickerOpen(false);
          }}
          onClose={() => setIsSourcePickerOpen(false)}
          presentation="modal"
        />
      ) : null}
    </div>
  );
}

type WorkflowButtonProps = {
  description: string;
  disabled: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void | Promise<void>;
};

function WorkflowButton({ description, disabled, icon: Icon, label, onClick }: WorkflowButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void onClick()}
      className="workflow-button"
    >
      <Icon aria-hidden="true" size={20} />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </button>
  );
}

type InlineNoticeProps = {
  message: string;
  tone: 'danger' | 'success';
};

function InlineNotice({ message, tone }: InlineNoticeProps) {
  return <div className={`inline-notice ${tone}`}>{message}</div>;
}

type InfoPanelProps = {
  detail: string;
  icon: LucideIcon;
  title: string;
  value: string;
  tone?: 'success' | 'danger' | 'neutral';
};

function InfoPanel({ detail, icon: Icon, title, value, tone = 'neutral' }: InfoPanelProps) {
  return (
    <section className={`side-panel ${tone}`}>
      <div className="panel-title">
        <Icon aria-hidden="true" size={18} />
        <span>{title}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </section>
  );
}

type SnippetPanelProps = {
  empty: string;
  icon: LucideIcon;
  showTerms?: boolean;
  snippets: BookSnippet[];
  title: string;
};

function SnippetPanel({ empty, icon: Icon, showTerms = false, snippets, title }: SnippetPanelProps) {
  return (
    <section className="side-panel">
      <div className="panel-title">
        <Icon aria-hidden="true" size={18} />
        <span>{title}</span>
      </div>
      <div className="snippet-stack">
        {snippets.length > 0 ? snippets.map((snippet) => (
          <article key={snippet.id} className="snippet-card">
            <div className="snippet-meta">
              <strong>{snippet.heading}</strong>
              <small>{snippet.sourceName}</small>
            </div>
            <p>{snippet.text}</p>
            {showTerms && snippet.matchedTerms.length > 0 ? (
              <div className="term-row">
                {snippet.matchedTerms.slice(0, 4).map((term) => <span key={term}>{term}</span>)}
              </div>
            ) : null}
          </article>
        )) : <p className="muted-copy">{empty}</p>}
      </div>
    </section>
  );
}

type LessonSessionPartsPanelProps = {
  currentSessionId: string | null;
  onToggleSession: (sessionId: string, selected: boolean) => void;
  records: LessonSessionRecord[];
  selectedSessionIds: string[];
};

function LessonSessionPartsPanel({ currentSessionId, onToggleSession, records, selectedSessionIds }: LessonSessionPartsPanelProps) {
  const selectedSessionIdSet = new Set(selectedSessionIds);

  return (
    <section className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow">Lesson session parts</p>
          <h3 className="text-lg font-semibold text-white">Selected transcript parts</h3>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
          {selectedSessionIds.length}/{records.length} selected
        </span>
      </div>

      {records.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-slate-300">
          No saved session parts are attached to this lesson yet. New recordings will appear here after autosave.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {records.map((record) => (
            <label
              key={record.sessionId}
              className="flex min-w-0 gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200"
            >
              <input
                type="checkbox"
                checked={selectedSessionIdSet.has(record.sessionId)}
                onChange={(event) => onToggleSession(record.sessionId, event.target.checked)}
                className="mt-1"
              />
              <span className="min-w-0">
                <strong className="block break-words text-white">{record.title}</strong>
                <span className="mt-1 block text-xs text-slate-400">{formatSessionRecordDate(record.date)}</span>
                <span className="mt-1 block text-xs text-slate-500">
                  {record.rawTranscript.trim().length.toLocaleString()} chars
                  {record.sessionId === currentSessionId ? ' | current live session' : ''}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      {currentSessionId && !records.some((record) => record.sessionId === currentSessionId) ? (
        <p className="mt-3 text-sm text-cyan-100">The current live session is included automatically with the selected saved parts.</p>
      ) : null}
    </section>
  );
}

type SourceReferencePanelProps = {
  empty: string;
  references: LessonSourceReference[];
};

function SourceReferencePanel({ empty, references }: SourceReferencePanelProps) {
  return (
    <section className="side-panel">
      <div className="panel-title">
        <Library aria-hidden="true" size={18} />
        <span>Source references</span>
      </div>
      <div className="snippet-stack">
        {references.length > 0 ? references.map((reference) => (
          <article key={reference.id} className="snippet-card">
            <div className="snippet-meta">
              <strong>{reference.heading}</strong>
              <small>{reference.sourceName}{typeof reference.pageNumber === 'number' ? ` | ${reference.pageNumber}-bet` : ''}</small>
            </div>
            <p>{reference.note || reference.citation}</p>
          </article>
        )) : <p className="muted-copy">{empty}</p>}
      </div>
    </section>
  );
}

type ListPanelProps = {
  empty: string;
  icon: LucideIcon;
  items: string[];
  subtitle?: string;
  title: string;
};

function ListPanel({ empty, icon: Icon, items, subtitle, title }: ListPanelProps) {
  return (
    <section className="side-panel">
      <div className="panel-title">
        <Icon aria-hidden="true" size={18} />
        <span>{title}</span>
        {subtitle ? <small>{subtitle}</small> : null}
      </div>
      <div className="list-stack">
        {items.length > 0 ? items.map((item) => <div key={item}>{item}</div>) : <p className="muted-copy">{empty}</p>}
      </div>
    </section>
  );
}

type LessonQuestionPanelProps = {
  answer: string | null;
  contextSnippets: BookSnippet[];
  disabled: boolean;
  error: string | null;
  isLoading: boolean;
  onAsk: () => void | Promise<void>;
  onQuestionChange: (question: string) => void;
  question: string;
};

function LessonQuestionPanel({
  answer,
  contextSnippets,
  disabled,
  error,
  isLoading,
  onAsk,
  onQuestionChange,
  question,
}: LessonQuestionPanelProps) {
  return (
    <section className="side-panel question-panel">
      <div className="panel-title">
        <SearchCheck aria-hidden="true" size={18} />
        <span>Savol-javob & test</span>
      </div>
      <textarea
        className="question-input"
        value={question}
        onChange={(event) => onQuestionChange(event.target.value)}
        placeholder="Савол ёки тест вариантларини киритинг..."
        rows={5}
      />
      <div className="question-actions">
        <small>{contextSnippets.length > 0 ? `${contextSnippets.length} source match` : 'Lesson + book context'}</small>
        <button
          type="button"
          className="compact-primary-button"
          disabled={disabled}
          onClick={() => void onAsk()}
        >
          <SendHorizontal aria-hidden="true" size={15} />
          <span>{isLoading ? 'Thinking...' : 'Ask AI'}</span>
        </button>
      </div>
      {error ? <InlineNotice tone="danger" message={error} /> : null}
      {answer ? (
        <article className="answer-card">
          <strong>AI answer</strong>
          <p>{answer}</p>
        </article>
      ) : null}
      {contextSnippets.length > 0 ? (
        <div className="source-mini-list">
          {contextSnippets.slice(0, 3).map((snippet) => (
            <span key={snippet.id}>{snippet.sourceName} | {snippet.heading}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function mergeBookSnippets(...snippetGroups: BookSnippet[][]): BookSnippet[] {
  const snippetsById = new Map<string, BookSnippet>();

  for (const snippet of snippetGroups.flat()) {
    if (!snippetsById.has(snippet.id)) {
      snippetsById.set(snippet.id, snippet);
    }
  }

  return [...snippetsById.values()];
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

function formatSessionRecordDate(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? formatTimestamp(timestamp) : 'Unknown date';
}

function formatRecorderSnapshotLabel(snapshot: RecorderSnapshot): string {
  switch (snapshot.status) {
    case 'completed':
      return snapshot.stoppedAt ? `Completed ${formatTimestamp(snapshot.stoppedAt)}` : 'Completed';
    case 'failed':
      return snapshot.statusMessage || 'Capture failed';
    case 'paused':
    case 'pausing':
      return 'Paused';
    case 'processing':
      return snapshot.statusMessage;
    case 'recording':
    case 'starting':
      return 'Recording in progress';
    case 'stopping':
      return 'Stopping capture';
    case 'idle':
      return 'No active capture';
  }
}

function formatRubaiWorkerDetail(status: RubaiRuntimeStatus): string {
  const { worker } = status;
  const parts = [
    `backlog ${worker.backlogCount}`,
    `active ${worker.activeCount}/${worker.concurrency}`,
  ];

  if (worker.modelLoadMs !== null) {
    parts.push(`model ${worker.modelLoadMs}ms`);
  }

  if (worker.startupMs !== null) {
    parts.push(`startup ${worker.startupMs}ms`);
  }

  if (worker.lastProcessingMs !== null) {
    parts.push(`last chunk ${worker.lastProcessingMs}ms`);
  }

  if (worker.lastQueueDelayMs !== null) {
    parts.push(`queue ${worker.lastQueueDelayMs}ms`);
  }

  if (worker.lastRealTimeFactor !== null) {
    parts.push(`RTF ${worker.lastRealTimeFactor}`);
  }

  return parts.join(' | ');
}
