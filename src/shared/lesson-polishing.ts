import type {
  BookSnippet,
  DetectedTopic,
  LessonPolishingResult,
  LessonSourceReference,
} from './types.js';

function escapePipe(value: string): string {
  return value.replace(/\|/gu, '\\|');
}

function formatCitation(reference: LessonSourceReference): string {
  const pageLabel = typeof reference.pageNumber === 'number' ? `, ${reference.pageNumber}-bet` : '';
  return `${reference.sourceName} | ${reference.heading}${pageLabel}`;
}

export function createSourceReferenceFromSnippet(snippet: BookSnippet, note: string): LessonSourceReference {
  const citationParts = [snippet.sourceName, snippet.heading];
  if (typeof snippet.pageNumber === 'number') {
    citationParts.push(`${snippet.pageNumber}-bet`);
  }

  return {
    citation: citationParts.join(' | '),
    documentId: snippet.documentId,
    heading: snippet.heading,
    id: snippet.id,
    matchedTerms: snippet.matchedTerms,
    note: note.trim(),
    pageNumber: snippet.pageNumber,
    snippetId: snippet.id,
    sourceName: snippet.sourceName,
  };
}

export function resolveLessonSourceReferences(
  bookContext: BookSnippet[],
  requestedIds: string[],
  notesById: Map<string, string>,
): LessonSourceReference[] {
  const lookup = new Map(bookContext.map((snippet) => [snippet.id, snippet]));
  const resolved = requestedIds
    .map((id) => lookup.get(id))
    .filter((snippet): snippet is BookSnippet => Boolean(snippet))
    .map((snippet) => createSourceReferenceFromSnippet(snippet, notesById.get(snippet.id) ?? ''));

  if (resolved.length > 0) {
    return resolved;
  }

  return bookContext.slice(0, 3).map((snippet) => createSourceReferenceFromSnippet(snippet, 'Relevant lesson context.'));
}

export function pickPrimaryTopicTitle(
  selectedTopic: string | undefined,
  detectedTopics: DetectedTopic[],
  rawTranscript: string,
): string {
  const explicitTopic = selectedTopic?.trim();
  if (explicitTopic) {
    return explicitTopic;
  }

  const detectedTopic = detectedTopics[0]?.title.trim();
  if (detectedTopic) {
    return detectedTopic;
  }

  const fallback = rawTranscript.trim().split(/\s+/u).slice(0, 8).join(' ');
  return fallback || 'Mavzu aniqlanmadi';
}

export function renderLessonPolishingMarkdown(result: LessonPolishingResult): string {
  const keyPoints = result.keyPoints.length > 0
    ? result.keyPoints.map((item) => `- ${item}`).join('\n')
    : '- Yo`q';
  const terms = result.terms.length > 0
    ? result.terms.map((item) => {
      const referencePart = item.sourceReferenceIds.length > 0
        ? ` [${item.sourceReferenceIds.join(', ')}]`
        : '';
      return `- ${item.term}: ${item.definition}${referencePart}`;
    }).join('\n')
    : '- Yo`q';
  const flashcards = result.flashcards.length > 0
    ? result.flashcards.map((item, index) => {
      const referencePart = item.sourceReferenceIds.length > 0
        ? ` [${item.sourceReferenceIds.join(', ')}]`
        : '';
      return `${index + 1}. Savol: ${item.prompt}\n   Javob: ${item.answer}${referencePart}`;
    }).join('\n')
    : '1. Yo`q';
  const reviewQuestions = result.reviewQuestions.length > 0
    ? result.reviewQuestions.map((item) => `- ${item}`).join('\n')
    : '- Yo`q';
  const sourceReferences = result.sourceReferences.length > 0
    ? result.sourceReferences.map((reference) => {
      const note = reference.note.trim() ? ` | ${reference.note.trim()}` : '';
      const matchedTerms = reference.matchedTerms.length > 0
        ? ` | atamalar: ${reference.matchedTerms.join(', ')}`
        : '';
      return `- [${reference.id}] ${formatCitation(reference)}${matchedTerms}${note}`;
    }).join('\n')
    : '- Manba topilmadi';

  return [
    `Mavzu: ${result.topicTitle}`,
    `Kontekst ishonchi: ${result.contextConfidence}`,
    result.contextWarning ? `Kontekst izohi: ${result.contextWarning}` : null,
    '',
    'Qisqa xulosa:',
    result.summary,
    '',
    'Asosiy fikrlar:',
    keyPoints,
    '',
    'Terminlar:',
    terms,
    '',
    'Flashcards:',
    flashcards,
    '',
    'Takrorlash savollari:',
    reviewQuestions,
    '',
    'Manba havolalari:',
    sourceReferences,
  ].filter((value): value is string => value !== null).join('\n');
}

export function renderLessonPolishingTable(result: LessonPolishingResult): string {
  const rows = result.sourceReferences.length > 0
    ? result.sourceReferences.map((reference) => `| ${reference.id} | ${escapePipe(reference.sourceName)} | ${escapePipe(reference.heading)} | ${reference.pageNumber ?? '-'} | ${escapePipe(reference.note || '-')} |`).join('\n')
    : '| - | - | - | - | Manba topilmadi |';

  return [
    '| Ref | Source | Heading | Page | Note |',
    '| --- | --- | --- | --- | --- |',
    rows,
  ].join('\n');
}
