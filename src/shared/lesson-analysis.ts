import type { BookSnippet, DetectedTopic } from './types.js';

export type LessonSectionAnalysis = {
  id: string;
  index: number;
  relatedSnippetIds: string[];
  text: string;
  title: string;
};

export type LessonAnalysis = {
  reviewItems: string[];
  sections: LessonSectionAnalysis[];
  topics: DetectedTopic[];
};

const MAX_SECTIONS = 12;
const MAX_RELATED_SNIPPETS = 3;
const MAX_REVIEW_ITEMS = 10;
const MAX_SECTION_LENGTH = 650;
const MAX_TITLE_LENGTH = 72;
const STOP_WORDS = new Set([
  'agar',
  'aslida',
  'bilan',
  'bir',
  'boladi',
  'bu',
  'degan',
  'eng',
  'ham',
  'haqida',
  'joylar',
  'keyingi',
  'kerak',
  'masalalari',
  'matn',
  'mavzu',
  'muhim',
  'qilib',
  'qismda',
  'qisqa',
  'shu',
  'shunaqa',
  'uchun',
  'va',
  'yoki',
]);

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[\u064b-\u065f\u0670\u06d6-\u06ed]/gu, '')
    .replace(/[\u2018\u2019`\u02bb\u02bc]/gu, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function tokenize(input: string): string[] {
  return [...new Set(
    normalizeText(input)
      .split(' ')
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  )];
}

function splitTranscriptIntoParagraphs(transcript: string): string[] {
  return transcript
    .replace(/\r\n?/gu, '\n')
    .split(/\n{2,}/gu)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function stripHeadingMarkers(text: string): string {
  return text.trim().replace(/^#{1,6}\s+/u, '').replace(/^(\d+[\.\)]|[IVXLCDM]+[\.\)])\s+/iu, '').trim();
}

function buildSectionTitle(text: string, relatedSnippets: BookSnippet[], index: number): string {
  const firstSentence = text
    .replace(/\s+/gu, ' ')
    .match(/[^.!?]+[.!?]?/u)?.[0]
    ?.trim() ?? text.trim();
  const candidate = stripHeadingMarkers(firstSentence || text).slice(0, MAX_TITLE_LENGTH).trim();

  if (candidate.length >= 24) {
    return candidate;
  }

  const snippetTitle = relatedSnippets[0]?.heading?.trim();
  if (snippetTitle) {
    return snippetTitle.slice(0, MAX_TITLE_LENGTH);
  }

  return `Lesson section ${index + 1}`;
}

function getHeadingTokens(snippet: BookSnippet): string[] {
  return tokenize(snippet.heading);
}

function getSnippetTextTokens(snippet: BookSnippet): string[] {
  return tokenize(snippet.text);
}

function scoreSnippetForSection(
  sectionText: string,
  snippet: BookSnippet,
): { isRelevant: boolean; matchedTerms: string[]; score: number } {
  const normalizedSection = normalizeText(sectionText);
  const normalizedSnippet = normalizeText(`${snippet.heading} ${snippet.text} ${snippet.matchedTerms.join(' ')}`);
  const matchedTerms = [...new Set(snippet.matchedTerms.filter((term) => normalizedSection.includes(normalizeText(term))))];
  const headingTokens = getHeadingTokens(snippet);
  const snippetTextTokens = getSnippetTextTokens(snippet);
  const headingMatches = headingTokens.filter((token) => normalizedSection.includes(token)).length;
  const textMatches = snippetTextTokens.filter((token) => normalizedSection.includes(token)).length;
  const headingMatched = normalizedSection.includes(normalizeText(snippet.heading));
  let score = 0;

  if (headingMatched) {
    score += 4;
  }

  score += matchedTerms.length * 3;
  score += headingMatches;
  score += textMatches > 0 ? 1 : 0;

  if (normalizedSnippet.length > 0 && normalizedSection.includes(normalizedSnippet.slice(0, 18))) {
    score += 1;
  }

  const isRelevant = matchedTerms.length > 0 || headingMatched || headingMatches > 0 || textMatches > 0;

  return {
    isRelevant,
    matchedTerms,
    score: isRelevant ? score + snippet.score : 0,
  };
}

function findRelatedSnippets(sectionText: string, snippets: BookSnippet[]): BookSnippet[] {
  return snippets
    .map((snippet) => ({
      snippet,
      ...scoreSnippetForSection(sectionText, snippet),
    }))
    .filter((candidate) => candidate.isRelevant)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.matchedTerms.length - left.matchedTerms.length;
    })
    .slice(0, MAX_RELATED_SNIPPETS)
    .map((candidate) => candidate.snippet);
}

function splitParagraphIntoPieces(paragraph: string): string[] {
  const trimmed = paragraph.trim();
  if (trimmed.length <= MAX_SECTION_LENGTH) {
    return [trimmed];
  }

  const sentences = trimmed
    .split(/(?<=[.!?])\s+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (sentences.length <= 1) {
    const pieces: string[] = [];
    for (let index = 0; index < trimmed.length; index += MAX_SECTION_LENGTH) {
      pieces.push(trimmed.slice(index, index + MAX_SECTION_LENGTH).trim());
    }
    return pieces.filter((piece) => piece.length > 0);
  }

  const pieces: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    const candidate = buffer ? `${buffer} ${sentence}` : sentence;
    if (candidate.length > MAX_SECTION_LENGTH && buffer) {
      pieces.push(buffer.trim());
      buffer = sentence;
      continue;
    }

    buffer = candidate;
  }

  if (buffer.trim().length > 0) {
    pieces.push(buffer.trim());
  }

  return pieces;
}

function createSections(transcript: string, snippets: BookSnippet[]): LessonSectionAnalysis[] {
  const paragraphs = splitTranscriptIntoParagraphs(transcript);
  const sections: LessonSectionAnalysis[] = [];

  for (const paragraph of paragraphs) {
    for (const piece of splitParagraphIntoPieces(paragraph)) {
      const relatedSnippets = findRelatedSnippets(piece, snippets);
      const sectionIndex = sections.length;
      sections.push({
        id: `section-${sectionIndex + 1}`,
        index: sectionIndex,
        relatedSnippetIds: relatedSnippets.map((snippet) => snippet.id),
        text: piece,
        title: buildSectionTitle(piece, relatedSnippets, sectionIndex),
      });
    }
  }

  if (sections.length === 0 && transcript.trim()) {
    const relatedSnippets = findRelatedSnippets(transcript, snippets);
    sections.push({
      id: 'section-1',
      index: 0,
      relatedSnippetIds: relatedSnippets.map((snippet) => snippet.id),
      text: transcript.trim(),
      title: buildSectionTitle(transcript, relatedSnippets, 0),
    });
  }

  return sections.slice(0, MAX_SECTIONS);
}

function buildTopics(sections: LessonSectionAnalysis[]): DetectedTopic[] {
  return sections.map((section) => ({
    id: `topic-${section.id}`,
    relatedSnippetIds: section.relatedSnippetIds,
    title: section.title,
  }));
}

function buildReviewItems(sections: LessonSectionAnalysis[], snippets: BookSnippet[]): string[] {
  const termItems = [...new Set(snippets.flatMap((snippet) => snippet.matchedTerms))]
    .filter((term) => term.trim().length > 0)
    .slice(0, 6)
    .map((term) => `Verify term from book context: ${term}`);

  const sectionItems = sections.slice(0, 4).map((section) => `Review lesson section: ${section.title}`);
  const snippetItems = sections
    .flatMap((section) => section.relatedSnippetIds.map((snippetId) => {
      const snippet = snippets.find((candidate) => candidate.id === snippetId);
      return snippet ? `Check supporting snippet: ${snippet.sourceName} | ${snippet.heading}` : null;
    }))
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);

  return [...sectionItems, ...termItems, ...snippetItems].slice(0, MAX_REVIEW_ITEMS);
}

export function buildLessonAnalysis(transcript: string, snippets: BookSnippet[]): LessonAnalysis {
  const sections = createSections(transcript, snippets);

  return {
    reviewItems: buildReviewItems(sections, snippets),
    sections,
    topics: buildTopics(sections),
  };
}
