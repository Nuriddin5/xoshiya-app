import { useEffect, useMemo, useState } from 'react';
import { Monitor, RefreshCw, X } from 'lucide-react';
import type { DesktopSourceSummary } from '../../shared/types.js';

type SourcePickerProps = {
  onClose?: () => void;
  selectedSource: DesktopSourceSummary | null;
  onSelectSource: (source: DesktopSourceSummary) => void;
  presentation?: 'panel' | 'modal';
};

function isChromeWindow(source: DesktopSourceSummary) {
  return source.type === 'window' && /chrome/i.test(source.name);
}

function isMeetWindow(source: DesktopSourceSummary) {
  return source.type === 'window' && /meet/i.test(source.name);
}

function getSourceBadge(source: DesktopSourceSummary) {
  if (source.type === 'screen') {
    return 'Screen';
  }

  if (isMeetWindow(source)) {
    return 'Meet';
  }

  if (isChromeWindow(source)) {
    return 'Chrome';
  }

  return 'Window';
}

function groupSources(sources: DesktopSourceSummary[]) {
  const screens = sources.filter((source) => source.type === 'screen');
  const meetWindows = sources.filter(isMeetWindow);
  const chromeWindows = sources.filter((source) => isChromeWindow(source) && !isMeetWindow(source));
  const otherWindows = sources.filter((source) => (
    source.type === 'window' &&
    !isChromeWindow(source) &&
    !isMeetWindow(source)
  ));

  return {
    screens,
    chromeWindows,
    meetWindows,
    otherWindows,
  };
}

export function SourcePicker({
  onClose,
  selectedSource,
  onSelectSource,
  presentation = 'panel',
}: SourcePickerProps) {
  const [sources, setSources] = useState<DesktopSourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function loadSources() {
    setLoading(true);

    try {
      if (!window.studyCapture) {
        throw new Error('Desktop source bridge unavailable. Reload the app window to reconnect the preload bridge.');
      }

      const nextSources = await window.studyCapture.getDesktopSources();
      setSources(nextSources);
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load desktop sources.';
      setErrorMessage(`Could not load desktop sources. ${message}`);
      setSources([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSources();
  }, []);

  useEffect(() => {
    if (presentation !== 'modal' || !onClose) {
      return;
    }

    const handleClose = onClose;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        handleClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, presentation]);

  const groupedSources = useMemo(() => groupSources(sources), [sources]);
  const hasAnySources = sources.length > 0;

  const content = (
    <section className={presentation === 'modal' ? 'source-panel source-panel-modal' : 'source-panel'}>
      <div className="source-head">
        <div>
          <p className="eyebrow">{presentation === 'modal' ? 'Capture target' : 'Source'}</p>
          <h4>{presentation === 'modal' ? 'Choose where recording starts' : 'Capture target'}</h4>
        </div>
        <div className="source-head-actions">
          <button
            type="button"
            onClick={() => void loadSources()}
            disabled={loading}
            className="icon-button"
            title="Refresh sources"
          >
            <RefreshCw size={16} />
            <span>{loading ? 'Refreshing' : 'Refresh'}</span>
          </button>
          {presentation === 'modal' && onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="icon-button icon-button-close"
              title="Close source picker"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
      </div>

      {errorMessage ? (
        <div className="inline-notice danger">{errorMessage}</div>
      ) : null}

      <div className="source-groups">
        <SourceGroup
          title="Chrome"
          items={groupedSources.chromeWindows}
          selectedSource={selectedSource}
          onSelectSource={onSelectSource}
        />
        <SourceGroup
          title="Meet"
          items={groupedSources.meetWindows}
          selectedSource={selectedSource}
          onSelectSource={onSelectSource}
        />
        <SourceGroup
          title="Screens"
          items={groupedSources.screens}
          selectedSource={selectedSource}
          onSelectSource={onSelectSource}
        />
        <SourceGroup
          title="Other windows"
          items={groupedSources.otherWindows}
          selectedSource={selectedSource}
          onSelectSource={onSelectSource}
        />

        {!loading && !errorMessage && !hasAnySources ? (
          <div className="empty-mini">
            No desktop sources were found. Open a Chrome or Meet window, or use a full screen source, then refresh.
          </div>
        ) : null}
      </div>
    </section>
  );

  if (presentation === 'modal') {
    return (
      <div className="source-modal-backdrop" role="presentation" onClick={onClose}>
        <div role="dialog" aria-modal="true" className="source-modal-shell" onClick={(event) => event.stopPropagation()}>
          {content}
        </div>
      </div>
    );
  }

  return content;
}

type SourceGroupProps = {
  title: string;
  items: DesktopSourceSummary[];
  selectedSource: DesktopSourceSummary | null;
  onSelectSource: (source: DesktopSourceSummary) => void;
};

function SourceGroup({ title, items, selectedSource, onSelectSource }: SourceGroupProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="source-group">
      <div className="source-group-head">
        <h5>{title}</h5>
        <span>{items.length}</span>
      </div>

      <div className="source-list">
        {items.map((source) => {
          const isSelected = selectedSource?.id === source.id;

          return (
            <button
              key={source.id}
              type="button"
              onClick={() => onSelectSource(source)}
              className={isSelected ? 'source-option is-selected' : 'source-option'}
            >
              <div className="source-thumb">
                {source.thumbnailDataUrl ? (
                  <img
                    src={source.thumbnailDataUrl}
                    alt={source.name}
                  />
                ) : (
                  <Monitor size={18} />
                )}
              </div>

              <div className="source-copy">
                <strong>{source.name}</strong>
                <span>{getSourceBadge(source)}</span>
              </div>
              {isSelected ? <div className="selected-dot" aria-label="Selected" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
