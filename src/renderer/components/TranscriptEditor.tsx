type TranscriptEditorProps = {
  badge: string;
  description: string;
  label: string;
  onChange?: (value: string) => void;
  placeholder: string;
  readOnly?: boolean;
  tone: 'raw' | 'corrected' | 'notes';
  value: string;
};

const toneClasses: Record<
  TranscriptEditorProps['tone'],
  {
    className: string;
  }
> = {
  raw: {
    className: 'raw',
  },
  corrected: {
    className: 'corrected',
  },
  notes: {
    className: 'notes',
  },
};

export function TranscriptEditor({ badge, description, label, onChange, placeholder, readOnly = false, tone, value }: TranscriptEditorProps) {
  const styles = toneClasses[tone];

  return (
    <section className={`transcript-panel ${styles.className}`}>
      <div className="transcript-panel-head">
        <div>
          <p>{badge}</p>
          <h4>{label}</h4>
          <span>{description}</span>
        </div>
        <strong>{readOnly ? 'Read only' : 'Editable'}</strong>
      </div>

      <textarea
        aria-label={label}
        spellCheck={false}
        value={value}
        onChange={readOnly ? undefined : (event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={readOnly ? 'is-readonly' : undefined}
      />
    </section>
  );
}
