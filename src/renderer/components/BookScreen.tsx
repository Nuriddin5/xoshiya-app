import { useEffect, useState, type FormEvent } from 'react';
import { FileText, FileType, Trash2, Upload } from 'lucide-react';
import type { BookDocument, BookSnippet } from '../../shared/types.js';

type BookScreenProps = {
  onSelectedSnippetsChange: (snippets: BookSnippet[]) => void;
  selectedSnippets: BookSnippet[];
};

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

function isSelected(snippets: BookSnippet[], snippet: BookSnippet): boolean {
  return snippets.some((selected) => selected.id === snippet.id);
}

export function BookScreen({ onSelectedSnippetsChange, selectedSnippets }: BookScreenProps) {
  const [documents, setDocuments] = useState<BookDocument[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [importName, setImportName] = useState('');
  const [importText, setImportText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BookSnippet[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.studyCapture?.listBookDocuments().then((nextDocuments) => {
      if (!cancelled) {
        setDocuments(nextDocuments);
      }
    }).catch((error) => {
      if (!cancelled) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load imported books.');
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.studyCapture?.importBookText) {
      setErrorMessage('Book import bridge is unavailable.');
      return;
    }

    try {
      setIsImporting(true);
      setErrorMessage(null);
      setStatusMessage(null);
      const document = await window.studyCapture.importBookText({
        name: importName,
        text: importText,
      });
      setDocuments((current) => [document, ...current]);
      setImportName('');
      setImportText('');
      setStatusMessage(`Imported "${document.name}" with ${document.sections.length} section${document.sections.length === 1 ? '' : 's'}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import book text.';
      setErrorMessage(`Could not import book text. ${message}`);
    } finally {
      setIsImporting(false);
    }
  }

  async function handleFileImport() {
    if (!window.studyCapture?.importBookFile) {
      setErrorMessage('File import bridge is unavailable.');
      return;
    }

    try {
      setIsImporting(true);
      setErrorMessage(null);
      setStatusMessage(null);
      const document = await window.studyCapture.importBookFile({});
      if (document) {
        setDocuments((current) => [document, ...current]);
        setStatusMessage(`Imported "${document.name}" (${document.fileType}) with ${document.sections.length} sections.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import file.';
      setErrorMessage(`Could not import file. ${message}`);
    } finally {
      setIsImporting(false);
    }
  }

  async function handleDeleteDocument(id: string) {
    if (!confirm('Are you sure you want to delete this book?')) {
      return;
    }

    try {
      if (!window.studyCapture?.deleteBookDocument) {
        throw new Error('Book delete bridge is unavailable.');
      }

      await window.studyCapture.deleteBookDocument(id);
      setDocuments((current) => current.filter((doc) => doc.id !== id));
      onSelectedSnippetsChange(selectedSnippets.filter((s) => s.documentId !== id));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete book.');
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.studyCapture?.searchBook) {
      setErrorMessage('Book search bridge is unavailable.');
      return;
    }

    try {
      setIsSearching(true);
      setErrorMessage(null);
      setStatusMessage(null);
      const nextResults = await window.studyCapture.searchBook(query);
      setResults(nextResults);
      setStatusMessage(nextResults.length > 0
        ? `Found ${nextResults.length} matching snippet${nextResults.length === 1 ? '' : 's'}.`
        : 'No matching snippets were found.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Book search failed.';
      setErrorMessage(`Could not search imported books. ${message}`);
    } finally {
      setIsSearching(false);
    }
  }

  function toggleSnippet(snippet: BookSnippet) {
    if (isSelected(selectedSnippets, snippet)) {
      onSelectedSnippetsChange(selectedSnippets.filter((selected) => selected.id !== snippet.id));
      return;
    }

    onSelectedSnippetsChange([...selectedSnippets, snippet].slice(0, 6));
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-6">
        <form onSubmit={handleImport} className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-glow">
          <p className="text-xs uppercase tracking-[0.28em] text-emerald-300/70">Book</p>
          <h3 className="mt-2 text-3xl font-semibold text-white">Imported text context</h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            Import local `.txt` material. Search stays on-device and selected snippets are sent only as text context for correction and notes.
          </p>

          {errorMessage ? <p className="mt-4 text-sm text-rose-200">{errorMessage}</p> : null}
          {statusMessage ? <p className="mt-4 text-sm text-emerald-200">{statusMessage}</p> : null}

          <div className="mt-6 grid gap-4">
            <input
              type="text"
              value={importName}
              onChange={(event) => setImportName(event.target.value)}
              placeholder="Book or lesson source name"
              className="w-full rounded-2xl border border-slate-600/30 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:ring-4 focus:ring-emerald-500/15"
            />
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder="Paste book text here, or choose a .txt file."
              rows={10}
              className="w-full resize-y rounded-2xl border border-slate-600/30 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:ring-4 focus:ring-emerald-500/15"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={isImporting}
                className="flex items-center gap-2 rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isImporting ? 'Importing...' : <><Upload size={16} /> Import text</>}
              </button>
              <button
                type="button"
                onClick={handleFileImport}
                disabled={isImporting}
                className="flex items-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-3 text-sm font-semibold text-cyan-50 transition hover:border-cyan-200/50 hover:bg-cyan-400/15 disabled:opacity-50"
              >
                <FileType size={16} />
                Choose PDF, DOCX, or TXT
              </button>
            </div>
          </div>
        </form>

        <form onSubmit={handleSearch} className="rounded-[28px] border border-white/10 bg-slate-950/45 p-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label className="text-xs uppercase tracking-[0.24em] text-slate-400">Hybrid-lite search</label>
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Uzbek term, Arabic phrase, or transliteration"
                className="mt-3 w-full rounded-2xl border border-slate-600/30 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:ring-4 focus:ring-emerald-500/15"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {results.length > 0 ? results.map((snippet) => {
              const selected = isSelected(selectedSnippets, snippet);
              return (
                <article key={snippet.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{snippet.heading}</div>
                      <div className="mt-1 text-xs text-slate-400">{snippet.sourceName} | score {snippet.score}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleSnippet(snippet)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] ${
                        selected
                          ? 'border-emerald-300/30 bg-emerald-400/15 text-emerald-100'
                          : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/20'
                      }`}
                    >
                      {selected ? 'Selected' : 'Use'}
                    </button>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{snippet.text}</p>
                  {snippet.matchedTerms.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {snippet.matchedTerms.map((term) => (
                        <span key={term} className="rounded-full border border-white/10 bg-slate-950/70 px-2.5 py-1 text-[11px] text-slate-300">
                          {term}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            }) : (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">
                Search results will appear here.
              </div>
            )}
          </div>
        </form>
      </div>

      <aside className="space-y-4 rounded-[28px] border border-white/10 bg-slate-950/45 p-6">
        <h4 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">Local library</h4>
        <div className="space-y-3 text-sm text-slate-300">
          {documents.length > 0 ? documents.map((document) => (
            <div key={document.id} className="group relative rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium text-white">
                    <FileText size={14} className="text-slate-400" />
                    <span className="truncate">{document.name}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{formatTimestamp(document.importedAt)}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase">{document.fileType}</span>
                    <span>{document.sections.length} sections</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteDocument(document.id)}
                  className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-500/20 hover:text-rose-400"
                  title="Delete book"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          )) : (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">No book has been imported yet.</div>
            )}
          </div>

        <div className="pt-3">
          <h4 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">Selected snippets</h4>
          <div className="mt-4 space-y-3 text-sm text-slate-300">
            {selectedSnippets.length > 0 ? selectedSnippets.map((snippet) => (
              <div key={snippet.id} className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3">
                <div className="font-medium text-white">{snippet.heading}</div>
                <div className="mt-1 line-clamp-3 text-xs leading-5 text-emerald-50/80">{snippet.text}</div>
              </div>
            )) : (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">No snippets selected yet.</div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
