import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock3,
  LayoutDashboard,
  Library,
  Moon,
  Settings,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import type {
  AppSettings,
  BookSnippet,
  DetectedTopic,
  DesktopSourceSummary,
  LessonPolishingResult,
  RubaiRuntimeStatus,
  StudyCaptureStartupState,
  StudySession,
  Course,
  Lesson,
} from '../shared/types.js';
import { buildSetupReadiness } from '../shared/readiness.js';
import { applyStudySessionArtifacts, isStudySessionForLesson, type StudySessionArtifacts } from '../shared/session-state.js';
import { renderLessonPolishingMarkdown } from '../shared/lesson-polishing.js';
import { BookScreen } from './components/BookScreen.js';
import { CourseScreen } from './components/CourseScreen.js';
import { Dashboard } from './components/Dashboard.js';
import { HistoryScreen } from './components/HistoryScreen.js';
import { SettingsScreen } from './components/SettingsScreen.js';

type TabId = 'settings' | 'dashboard' | 'courses' | 'book' | 'history';

type Tab = {
  id: TabId;
  label: string;
  description: string;
  Icon: LucideIcon;
};

type ThemeMode = 'light' | 'dark';

const tabs: Tab[] = [
  {
    id: 'settings',
    label: 'Settings',
    description: 'App preferences and bridge configuration',
    Icon: Settings,
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Session overview and capture controls',
    Icon: LayoutDashboard,
  },
  {
    id: 'courses',
    label: 'Courses',
    description: 'Organize study material by course and lesson',
    Icon: Library,
  },
  {
    id: 'book',
    label: 'Book',
    description: 'Reference material and imported sources',
    Icon: BookOpen,
  },
  {
    id: 'history',
    label: 'History',
    description: 'Saved sessions, exports, and review trail',
    Icon: Clock3,
  },
];

function buildRubaiRuntimeFailureStatus(error: unknown): RubaiRuntimeStatus {
  const message = error instanceof Error ? error.message : 'Failed to load Rubai runtime status.';

  return {
    backend: null,
    isReady: false,
    message: `Local Rubai ASR status check failed. ${message}`,
    missingItems: [message],
    modelPath: '',
    pythonPath: '',
    worker: {
      activeCount: 0,
      backlogCount: 0,
      completedCount: 0,
      concurrency: 2,
      failedCount: 0,
      lastCompletedAt: null,
      lastProcessingMs: null,
      lastQueueDelayMs: null,
      lastRealTimeFactor: null,
      modelLoadMs: null,
      startupMs: null,
      state: 'failed',
    },
  };
}

function resolveActiveSaveFolder(settings: AppSettings, storageEnvironment: StudyCaptureStartupState['storageEnvironment']): string {
  return storageEnvironment === 'production'
    ? settings.productionSaveFolder
    : settings.mainSaveFolder;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') {
      return 'dark';
    }

    return window.localStorage.getItem('xoshiya-theme') === 'light' ? 'light' : 'dark';
  });
  const [correctedTranscriptText, setCorrectedTranscriptText] = useState('');
  const [detectedTopics, setDetectedTopics] = useState<DetectedTopic[]>([]);
  const [correctionEvidence, setCorrectionEvidence] = useState<BookSnippet[]>([]);
  const [polishingResult, setPolishingResult] = useState<LessonPolishingResult | null>(null);
  const [reviewItems, setReviewItems] = useState<string[]>([]);
  const [selectedBookSnippets, setSelectedBookSnippets] = useState<BookSnippet[]>([]);
  const [session, setSession] = useState<StudySession | null>(null);
  const [summaryText, setSummaryText] = useState('');
  const [startupState, setStartupState] = useState<StudyCaptureStartupState | null>(null);
  const [selectedSource, setSelectedSource] = useState<DesktopSourceSummary | null>(null);
  const [activeCourse, setActiveCourse] = useState<Course | null>(null);
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const activeSection = tabs.find((tab) => tab.id === activeTab) ?? tabs[1]!;
  const bridgeReady = typeof window !== 'undefined' && Boolean(window.studyCapture);
  const settings = startupState?.settings ?? null;
  const readiness = startupState?.readiness ?? null;
  const rubaiRuntime = startupState?.rubaiRuntime ?? null;

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
    window.localStorage.setItem('xoshiya-theme', themeMode);
  }, [themeMode]);

  function getStudySessionArtifacts(): StudySessionArtifacts {
    return {
      bookContextUsed: selectedBookSnippets,
      correctedTranscript: correctedTranscriptText,
      detectedTopics,
      polishingResult,
      reviewItems,
      summary: summaryText,
    };
  }

  function clearStudyDraftState() {
    setCorrectedTranscriptText('');
    setCorrectionEvidence([]);
    setDetectedTopics([]);
    setPolishingResult(null);
    setReviewItems([]);
    setSelectedBookSnippets([]);
    setSummaryText('');
  }

  function handleSelectCourse(nextCourse: Course | null) {
    setActiveCourse(nextCourse);
    setActiveLesson(null);
    clearStudyDraftState();
  }

  function handleSelectLesson(nextLesson: Lesson | null) {
    setActiveLesson(nextLesson);
    clearStudyDraftState();
  }

  useEffect(() => {
    const savedPolishing = activeLesson?.lastPolishingResult;
    if (!savedPolishing) {
      clearStudyDraftState();
      return;
    }

    setCorrectedTranscriptText(savedPolishing.correctedTranscript);
    setCorrectionEvidence(savedPolishing.bookContextUsed);
    setDetectedTopics(savedPolishing.detectedTopics);
    setPolishingResult(savedPolishing);
    setReviewItems(savedPolishing.reviewQuestions);
    setSelectedBookSnippets(savedPolishing.bookContextUsed);
    setSummaryText(renderLessonPolishingMarkdown(savedPolishing));
  }, [activeLesson?.id, activeLesson?.lastPolishingResult]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;

    async function loadStartupState() {
      if (!window.studyCapture) {
        if (!cancelled) {
          setLoadError('Settings bridge unavailable. Restart the app to reload the preload bridge.');
        }
        return;
      }

      timeoutId = window.setTimeout(() => {
        setLoadError((current) => current ?? 'Could not load startup settings. Startup state request timed out after 5 seconds.');
      }, 5000);

      try {
        const nextStartupState = await window.studyCapture.getStartupState();
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (!cancelled) {
          setStartupState(nextStartupState);
          setLoadError(null);

          if (!nextStartupState.rubaiRuntime) {
            window.studyCapture.getRubaiRuntimeStatus().then((status) => {
              if (!cancelled) {
                setStartupState((prev) => prev ? { ...prev, rubaiRuntime: status } : prev);
              }
            }).catch((error) => {
              console.error('Failed to load Rubai runtime status:', error);
              if (!cancelled) {
                setStartupState((prev) => prev ? { ...prev, rubaiRuntime: buildRubaiRuntimeFailureStatus(error) } : prev);
              }
            });
          }
        }
      } catch (error) {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load startup settings.';
          setLoadError(`Could not load startup settings. ${message}`);
        }
      }
    }

    void loadStartupState();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  useEffect(() => {
    if (!window.studyCapture?.getRubaiRuntimeStatus || !startupState) {
      return;
    }

    let cancelled = false;
    const refresh = () => {
      window.studyCapture?.getRubaiRuntimeStatus().then((status) => {
        if (!cancelled) {
          setStartupState((current) => current ? { ...current, rubaiRuntime: status } : current);
        }
      }).catch((error) => {
        if (!cancelled) {
          setStartupState((current) => current ? { ...current, rubaiRuntime: buildRubaiRuntimeFailureStatus(error) } : current);
        }
      });
    };

    const intervalId = window.setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [startupState?.settings]);

  async function handleSaveSettings(nextSettings: AppSettings) {
    if (!window.studyCapture) {
      throw new Error('Settings bridge unavailable. Restart the app to reload the preload bridge.');
    }

    const savedSettings = await window.studyCapture.saveSettings(nextSettings);
    const storageEnvironment = startupState?.storageEnvironment ?? 'main';
    setStartupState({
      activeSaveFolder: resolveActiveSaveFolder(savedSettings, storageEnvironment),
      readiness: buildSetupReadiness(savedSettings),
      rubaiRuntime: startupState?.rubaiRuntime ?? await window.studyCapture.getRubaiRuntimeStatus(),
      settings: savedSettings,
      storageEnvironment,
    });
    return savedSettings;
  }

  async function handleExportSession(sessionToExport: StudySession) {
    if (!window.studyCapture?.saveSessionExport) {
      throw new Error('Session export bridge unavailable. Restart the app to reload the preload bridge.');
    }

    const result = await window.studyCapture.saveSessionExport(sessionToExport);
    return result;
  }

  function handleTranscriptSessionReset() {
    setCorrectedTranscriptText('');
    setCorrectionEvidence([]);
    setPolishingResult(null);
    setSummaryText('');
  }

  function handleSessionChange(nextSession: StudySession | null) {
    if (!nextSession) {
      setSession(null);
      return;
    }

    const shouldApplyCurrentArtifacts = isStudySessionForLesson(nextSession, activeCourse?.id, activeLesson?.id);
    setSession(
      shouldApplyCurrentArtifacts
        ? applyStudySessionArtifacts(nextSession, getStudySessionArtifacts())
        : nextSession,
    );
  }

  useEffect(() => {
    if (!isStudySessionForLesson(session, activeCourse?.id, activeLesson?.id)) {
      return;
    }

    setSession((current) => current
      ? applyStudySessionArtifacts(current, getStudySessionArtifacts())
      : current);
  }, [correctedTranscriptText, detectedTopics, polishingResult, reviewItems, selectedBookSnippets, summaryText]);

  useEffect(() => {
    if (!session?.id || !window.studyCapture?.saveSessionHistory) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      window.studyCapture?.saveSessionHistory(session).catch((error) => {
        console.error('Failed to save session history:', error);
      });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [session]);

  return (
    <div className="app-frame min-h-screen">
      <main className="mx-auto flex min-h-screen w-full max-w-[1560px] flex-col px-3 py-3 sm:px-5 sm:py-5">
        <header className="app-topbar">
          <div className="min-w-0">
            <div className="brand-lockup">
              <div className="brand-mark">X</div>
              <div className="min-w-0">
                <p className="brand-kicker">Xoshiya App</p>
                <h1 className="brand-title">Study Capture</h1>
              </div>
            </div>
          </div>

          <nav className="tab-rail" role="tablist" aria-label="Study Capture sections">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab;
              const Icon = tab.Icon;

              return (
                <button
                  key={tab.id}
                  id={`${tab.id}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`panel-${tab.id}`}
                  title={tab.description}
                  onClick={() => setActiveTab(tab.id)}
                  className={isActive ? 'tab-button is-active' : 'tab-button'}
                >
                  <Icon aria-hidden="true" size={18} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="topbar-actions">
            <StatusPill
              icon={settings ? CheckCircle2 : Clock3}
              label={settings ? 'Renderer ready' : 'Renderer loading'}
              tone={settings ? 'success' : 'neutral'}
            />
            <StatusPill
              icon={readiness?.isComplete ? CheckCircle2 : AlertTriangle}
              label={readiness ? (readiness.isComplete ? 'Setup complete' : 'Setup needed') : 'Setup loading'}
              tone={readiness?.isComplete ? 'success' : 'warning'}
            />
            <StatusPill
              icon={rubaiRuntime ? (rubaiRuntime.isReady ? CheckCircle2 : AlertTriangle) : Clock3}
              label={rubaiRuntime ? (rubaiRuntime.isReady ? 'ASR ready' : 'ASR unavailable') : 'ASR loading'}
              tone={rubaiRuntime ? (rubaiRuntime.isReady ? 'success' : 'danger') : 'neutral'}
            />
            <StatusPill
              icon={bridgeReady ? CheckCircle2 : AlertTriangle}
              label={bridgeReady ? 'Bridge' : 'Bridge off'}
              tone={bridgeReady ? 'success' : 'danger'}
            />
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setThemeMode((current) => (current === 'dark' ? 'light' : 'dark'))}
              aria-label={`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} mode`}
            >
              {themeMode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              <span>{themeMode === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
          </div>
        </header>

        <section className="app-content">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Workspace</p>
              <h2>{activeSection.label}</h2>
            </div>
            <p>{activeSection.description}</p>
          </div>

          <div
            id={`panel-${activeSection.id}`}
            role="tabpanel"
            aria-labelledby={`${activeSection.id}-tab`}
            className="workspace-panel"
          >
            {loadError ? (
              <AlertPanel tone="danger" title="Startup failed" message={loadError} />
            ) : null}

            {readiness && !readiness.isComplete ? (
              <AlertPanel tone="warning" title="Setup incomplete" message={readiness.statusMessage} />
            ) : null}

            {rubaiRuntime && !rubaiRuntime.isReady ? (
              <AlertPanel tone="danger" title="Local Rubai ASR unavailable" message={rubaiRuntime.message} />
            ) : null}

            {!settings && !loadError ? (
              <div className="empty-state">Loading settings...</div>
            ) : null}

            {settings && readiness && activeTab === 'dashboard' ? (
                <Dashboard
                  correctedTranscriptText={correctedTranscriptText}
                  correctionEvidence={correctionEvidence}
                  onCorrectedTranscriptTextChange={setCorrectedTranscriptText}
                  onCorrectionEvidenceChange={setCorrectionEvidence}
                  polishingResult={polishingResult}
                  onPolishingResultChange={setPolishingResult}
                  onSummaryTextChange={setSummaryText}
                  onExportSession={handleExportSession}
                  onSessionChange={handleSessionChange}
                  onBookContextChange={setSelectedBookSnippets}
                  onLearningArtifactsChange={(artifacts) => {
                    setDetectedTopics(artifacts.detectedTopics);
                    setReviewItems(artifacts.reviewItems);
                  }}
                  settings={settings}
                  readiness={readiness}
                  rubaiRuntime={rubaiRuntime}
                  session={session}
                  summaryText={summaryText}
                  selectedBookSnippets={selectedBookSnippets}
                  selectedSource={selectedSource}
                  onSelectSource={setSelectedSource}
                  onTranscriptSessionReset={handleTranscriptSessionReset}
                  activeCourse={activeCourse}
                  activeLesson={activeLesson}
                  onSelectCourse={handleSelectCourse}
                  onSelectLesson={handleSelectLesson}
                />
              ) : null}
              {activeTab === 'courses' ? (
                <CourseScreen
                  activeCourse={activeCourse}
                  activeLesson={activeLesson}
                  onOpenLesson={(lesson) => {
                    handleSelectLesson(lesson);
                    setActiveTab('dashboard');
                  }}
                  onSelectCourse={handleSelectCourse}
                  onSelectLesson={handleSelectLesson}
                />
              ) : null}
              {settings && activeTab === 'settings' ? (
                <SettingsScreen
                  activeSaveFolder={startupState?.activeSaveFolder ?? settings.mainSaveFolder}
                  settings={settings}
                  storageEnvironment={startupState?.storageEnvironment ?? 'main'}
                  onSave={handleSaveSettings}
                />
              ) : null}
              {activeTab === 'book' ? (
                <BookScreen
                  selectedSnippets={selectedBookSnippets}
                  onSelectedSnippetsChange={setSelectedBookSnippets}
                />
              ) : null}
              {activeTab === 'history' ? (
                <HistoryScreen
                  activeSaveFolder={startupState?.activeSaveFolder ?? null}
                  storageEnvironment={startupState?.storageEnvironment ?? null}
                />
              ) : null}
            </div>
        </section>
      </main>
    </div>
  );
}

type StatusTone = 'success' | 'warning' | 'danger' | 'neutral';

type StatusPillProps = {
  icon: LucideIcon;
  label: string;
  tone: StatusTone;
};

function StatusPill({ icon: Icon, label, tone }: StatusPillProps) {
  return (
    <div className={`status-pill ${tone}`}>
      <Icon aria-hidden="true" size={16} />
      <span>{label}</span>
    </div>
  );
}

type AlertPanelProps = {
  message: string;
  title: string;
  tone: 'danger' | 'warning';
};

function AlertPanel({ message, title, tone }: AlertPanelProps) {
  return (
    <div className={`alert-panel ${tone}`}>
      <AlertTriangle aria-hidden="true" size={18} />
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}
