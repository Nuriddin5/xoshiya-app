import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { BookDocument, BookSection, BookSnippet, Course } from '../shared/types.js';
import type { StudyCaptureStore } from './store.js';

const MAX_SNIPPETS = 8;
const MAX_SNIPPET_LENGTH = 900;
const SECTION_TARGET_LENGTH = 1800;

type ExtractedFileType = 'pdf' | 'docx';

type ExtractedSourceFile = {
  fileType: ExtractedFileType;
  sections?: BookSection[] | undefined;
  text: string;
};

type MammothModule = {
  extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
};

type PdfParseModule = {
  PDFParse: new (options: { data: Uint8Array }) => {
    destroy?: () => Promise<void>;
    getText: () => Promise<{
      pages: Array<{ num: number; text: string }>;
      text: string;
      total: number;
    }>;
  };
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function requireDependency<T>(name: string): T {
  const require = createRequire(import.meta.url);
  return require(name) as T;
}

function normalizeSearchText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[\u064b-\u065f\u0670]/gu, '')
    .replace(/[\u2018\u2019`\u02bb\u02bc]/gu, "'")
    .replace(/\u011f/gu, 'g')
    .replace(/\u00e7/gu, 'ch')
    .replace(/\u0131/gu, 'i')
    .replace(/\u015f/gu, 'sh')
    .replace(/[^\p{L}\p{N}'\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function tokenize(input: string): string[] {
  const stopWords = new Set([
    'va',
    'yoki',
    'bilan',
    'uchun',
    'mana',
    'shunaqa',
    'degan',
    'boladi',
    'qiladi',
    'agar',
    'ham',
    'bir',
    'bu',
    'shu',
  ]);

  return normalizeSearchText(input)
    .split(' ')
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

function getHeading(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  if (/^#{1,6}\s+/u.test(trimmed)) {
    return trimmed.replace(/^#{1,6}\s+/u, '').trim();
  }

  if (/^(\d+[\.\)]|[IVXLCDM]+[\.\)])\s+\S+/iu.test(trimmed) && trimmed.length <= 120) {
    return trimmed;
  }

  if (trimmed.length <= 90 && /^[A-Z\u0400-\u04ff0-9\s'\u2019:-]+$/u.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function pushSection(sections: BookSection[], heading: string, lines: string[], pageNumber?: number): void {
  const text = lines.join('\n').trim();
  if (!text) {
    return;
  }

  sections.push({
    heading,
    id: createId('section'),
    ...(pageNumber !== undefined ? { pageNumber } : {}),
    text,
  });
}

function splitLongSection(heading: string, text: string, pageNumber?: number): BookSection[] {
  if (text.length <= SECTION_TARGET_LENGTH) {
    return [{
      heading,
      id: createId('section'),
      ...(pageNumber !== undefined ? { pageNumber } : {}),
      text,
    }];
  }

  const paragraphs = text.split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean);
  const sections: BookSection[] = [];
  let buffer: string[] = [];
  let bufferLength = 0;

  for (const paragraph of paragraphs) {
    if (bufferLength + paragraph.length > SECTION_TARGET_LENGTH && buffer.length > 0) {
      pushSection(sections, heading, buffer, pageNumber);
      buffer = [];
      bufferLength = 0;
    }

    buffer.push(paragraph);
    bufferLength += paragraph.length;
  }

  pushSection(sections, heading, buffer, pageNumber);
  return sections;
}

function segmentBookText(text: string): BookSection[] {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  const sections: BookSection[] = [];
  let heading = 'Imported text';
  let buffer: string[] = [];

  for (const line of lines) {
    const nextHeading = getHeading(line);
    if (nextHeading) {
      const sectionText = buffer.join('\n').trim();
      if (sectionText) {
        sections.push(...splitLongSection(heading, sectionText));
      }

      heading = nextHeading;
      buffer = [];
      continue;
    }

    buffer.push(line);
  }

  const sectionText = buffer.join('\n').trim();
  if (sectionText) {
    sections.push(...splitLongSection(heading, sectionText));
  }

  return sections.length > 0 ? sections : [{ heading, id: createId('section'), text: text.trim() }];
}

function segmentPdfPages(pages: Array<{ num: number; text: string }>): BookSection[] {
  return pages.flatMap((page) => {
    const text = page.text.trim();
    if (!text) {
      return [];
    }

    return splitLongSection(`Page ${page.num}`, text, page.num).map((section, index) => ({
      ...section,
      heading: index === 0 ? section.heading : `${section.heading} (${index + 1})`,
    }));
  });
}

function assertExtractedTextUsable(fileType: 'pdf' | 'docx' | 'text', text: string): void {
  if (text.trim().length >= 20) {
    return;
  }

  if (fileType === 'pdf') {
    throw new Error('No selectable text was found in this PDF. It may be scanned or image-only; OCR is required before import.');
  }

  if (fileType === 'docx') {
    throw new Error('No readable text was found in this DOCX file. Check that the document is not empty or only contains images.');
  }

  throw new Error('Book text is too short to import.');
}

function formatExtractionError(fileType: ExtractedFileType, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('password') || lower.includes('encrypt')) {
    return new Error(`${fileType.toUpperCase()} import failed because the file is encrypted or password-protected.`);
  }

  if (lower.includes('invalid') || lower.includes('corrupt') || lower.includes('end of data')) {
    return new Error(`${fileType.toUpperCase()} import failed because the file appears to be damaged or invalid.`);
  }

  return new Error(`Failed to extract text from ${fileType.toUpperCase()}: ${message}`);
}

function excerptAroundMatch(text: string, terms: string[]): string {
  const normalized = normalizeSearchText(text);
  const firstMatch = terms
    .map((term) => normalized.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? 0;
  const start = Math.max(0, firstMatch - 220);
  const end = Math.min(text.length, start + MAX_SNIPPET_LENGTH);
  const excerpt = text.slice(start, end).trim();

  return `${start > 0 ? '...' : ''}${excerpt}${end < text.length ? '...' : ''}`;
}

function scoreSection(section: BookSection, queryTerms: string[]): { matchedTerms: string[]; score: number } {
  const sectionText = normalizeSearchText(`${section.heading} ${section.text}`);
  const matchedTerms = queryTerms.filter((term) => sectionText.includes(term));
  let score = 0;

  for (const term of matchedTerms) {
    const occurrences = sectionText.split(term).length - 1;
    score += occurrences;
    if (normalizeSearchText(section.heading).includes(term)) {
      score += 4;
    }
  }

  return { matchedTerms, score };
}

export function importBookText(
  store: StudyCaptureStore,
  payload: {
    courseId?: string | undefined;
    filename?: string | undefined;
    fileType?: BookDocument['fileType'] | undefined;
    name: string;
    sections?: BookSection[] | undefined;
    text: string;
  },
): BookDocument {
  const name = payload.name.trim();
  const text = payload.text.trim();

  if (!name) {
    throw new Error('Book name is required.');
  }

  const fileType = payload.fileType ?? 'text';
  assertExtractedTextUsable(fileType, text);

  const document: BookDocument = {
    id: createId('book'),
    importedAt: Date.now(),
    name,
    ...(payload.filename ? { filename: payload.filename } : {}),
    fileType,
    sections: payload.sections && payload.sections.length > 0 ? payload.sections : segmentBookText(text),
    text,
    courseId: payload.courseId,
  };

  store.set('books', [document, ...listStoreBookDocuments(store)]);
  return document;
}

export async function extractTextFromFile(filePath: string): Promise<ExtractedSourceFile> {
  const ext = extname(filePath).toLowerCase();
  const buffer = await readFile(filePath);

  if (ext === '.pdf') {
    let parser: InstanceType<PdfParseModule['PDFParse']> | null = null;

    try {
      const { PDFParse } = requireDependency<PdfParseModule>('pdf-parse');
      parser = new PDFParse({ data: new Uint8Array(buffer) });
      const data = await parser.getText();
      const text = data.text.trim();
      assertExtractedTextUsable('pdf', text);
      return { text, fileType: 'pdf', sections: segmentPdfPages(data.pages) };
    } catch (error) {
      throw formatExtractionError('pdf', error);
    } finally {
      await parser?.destroy?.();
    }
  }

  if (ext === '.docx') {
    try {
      const mammoth = requireDependency<MammothModule>('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value.trim();
      assertExtractedTextUsable('docx', text);
      return { text, fileType: 'docx' };
    } catch (error) {
      throw formatExtractionError('docx', error);
    }
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

export function deleteBookDocument(store: StudyCaptureStore, id: string): void {
  const books = listStoreBookDocuments(store);
  store.set('books', books.filter((b) => b.id !== id));

  const courses = store.get('courses') as Course[] | undefined;
  if (!courses) {
    return;
  }

  store.set('courses', courses.map((course) => ({
    ...course,
    bookIds: course.bookIds.filter((bookId) => bookId !== id),
  })));
}

function listStoreBookDocuments(store: StudyCaptureStore): BookDocument[] {
  return store.get('books') ?? [];
}

export function listBookDocuments(store: StudyCaptureStore, options?: { courseId?: string | undefined }): BookDocument[] {
  const books = listStoreBookDocuments(store);
  if (options?.courseId) {
    return books.filter((b) => b.courseId === options.courseId);
  }
  return books;
}

export function searchBook(
  store: StudyCaptureStore,
  query: string,
  options: { documentIds?: string[] } = {},
): BookSnippet[] {
  const queryTerms = [...new Set(tokenize(query))].slice(0, 24);
  if (queryTerms.length === 0) {
    return [];
  }

  const documentIdFilter = options.documentIds ? new Set(options.documentIds) : null;

  return listBookDocuments(store)
    .filter((document) => documentIdFilter === null || documentIdFilter.has(document.id))
    .flatMap((document) =>
      document.sections.map((section) => {
        const { matchedTerms, score } = scoreSection(section, queryTerms);
        return {
          document,
          matchedTerms,
          score,
          section,
        };
      }),
    )
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_SNIPPETS)
    .map((candidate): BookSnippet => ({
      documentId: candidate.document.id,
      heading: candidate.section.heading,
      id: candidate.section.id,
      matchedTerms: candidate.matchedTerms,
      pageNumber: candidate.section.pageNumber,
      score: candidate.score,
      sourceName: candidate.document.name,
      text: excerptAroundMatch(candidate.section.text, candidate.matchedTerms),
    }));
}
