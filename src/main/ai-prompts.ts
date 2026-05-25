import type {
  BookSnippet,
  CorrectTranscriptPayload,
  DetectedTopic,
  GenerateStudyNotesPayload,
  LessonQuestionAnswerPayload,
  PolishLessonTranscriptPayload,
} from '../shared/types.js';
import { buildTerminologyRepairContext } from './terminology-repair.js';
import { pickPrimaryTopicTitle } from '../shared/lesson-polishing.js';

export type ChatMessage = {
  content: string;
  role: 'system' | 'user';
};

export type CorrectTranscriptPrompt = {
  evidenceSnippets: BookSnippet[];
  messages: ChatMessage[];
};

function formatBookContext(snippets: BookSnippet[]): string {
  if (snippets.length === 0) {
    return '[kitob context yoq]';
  }

  return snippets.map((snippet, index) => [
    `Snippet ${index + 1}`,
    `Reference ID: ${snippet.id}`,
    `Source: ${snippet.sourceName}`,
    `Heading: ${snippet.heading}`,
    typeof snippet.pageNumber === 'number' ? `Page: ${snippet.pageNumber}` : null,
    `Matched terms: ${snippet.matchedTerms.join(', ') || 'none'}`,
    snippet.text,
  ].filter(Boolean).join('\n')).join('\n\n---\n\n');
}

function formatTopics(topics: DetectedTopic[]): string {
  if (topics.length === 0) {
    return '[detected topics yoq]';
  }

  return topics.map((topic, index) => `${index + 1}. ${topic.title}`).join('\n');
}

export function buildCorrectTranscriptPrompt(payload: CorrectTranscriptPayload): CorrectTranscriptPrompt {
  const repairContext = buildTerminologyRepairContext(payload.rawTranscript, payload.bookContext);
  const contextHeader = [
    payload.courseName ? `Kurs: ${payload.courseName}` : null,
    payload.lessonName ? `Dars: ${payload.lessonName}` : null,
  ].filter(Boolean).join(' | ');

  return {
    evidenceSnippets: repairContext.evidenceSnippets,
    messages: [
      {
        role: 'system',
        content: [
          'You are a transcript correction assistant for Uzbek-speaking Islamic studies learners.',
          'Correct local Rubai ASR transcript text.',
          'Preserve meaning. Do not invent. Use book context only as evidence.',
          'Improve Uzbek clarity and flow while keeping the speaker`s intent.',
          'Fix Uzbek Latin, Arabic phrases, and aqida terminology only when context supports it.',
          'Use selected snippets as the source of truth for Arabic repair.',
          'Preserve transliteration when exact Arabic script is not supported by the selected context.',
          'Mark unclear parts as [noaniq].',
          'Return only the corrected transcript text. Do not add headings or an evidence list.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          contextHeader ? `Kontekst: ${contextHeader}` : '',
          '',
          'Quyidagi raw transcriptni tuzat.',
          '',
          repairContext.promptBlock,
          '',
          'Kitob context:',
          formatBookContext(payload.bookContext),
          '',
          'Raw transcript:',
          payload.rawTranscript,
        ].join('\n'),
      },
    ],
  };
}

export function buildStudyNotesPrompt(payload: GenerateStudyNotesPayload): ChatMessage[] {
  const contextHeader = [
    payload.courseName ? `Kurs: ${payload.courseName}` : null,
    payload.lessonName ? `Dars: ${payload.lessonName}` : null,
  ].filter(Boolean).join(' | ');

  return [
    {
      role: 'system',
      content: [
        'You are a study assistant for Uzbek-speaking aqida learners.',
        'Generate concise, accurate, test-focused study notes.',
        'Use only the corrected transcript and provided book context.',
        'Do not invent facts. Use Uzbek Latin script.',
        'Structure the output clearly with headers.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        contextHeader ? `Kontekst: ${contextHeader}` : '',
        '',
        'Quyidagi corrected transcriptdan konspekt tuz.',
        '',
        'Natija bo`limlari:',
        '- Mavzu sarlavhasi',
        '- Qisqa xulosa',
        '- Eng muhim fikrlar (Key points)',
        '- Aqida terminlari va tushunchalari',
        '- Kitob/Manbalarga havolalar (Source references)',
        '- Flashcards (Savol: javob)',
        '- Takrorlash uchun savollar (Review questions)',
        '- Noaniq joylar (agar bo`lsa)',
        '',
        'Kitob context:',
        formatBookContext(payload.bookContext),
        '',
        'Detected topics:',
        formatTopics(payload.detectedTopics),
        '',
        'Corrected transcript:',
        payload.correctedTranscript,
      ].join('\n'),
    },
  ];
}

export function buildPolishLessonPrompt(payload: PolishLessonTranscriptPayload): ChatMessage[] {
  const topicTitle = pickPrimaryTopicTitle(payload.selectedTopic, payload.detectedTopics, payload.rawTranscript);
  const contextHeader = [
    payload.courseName ? `Kurs: ${payload.courseName}` : null,
    payload.lessonName ? `Dars: ${payload.lessonName}` : null,
    topicTitle ? `Mavzu: ${topicTitle}` : null,
  ].filter(Boolean).join(' | ');

  return [
    {
      role: 'system',
      content: [
        'You are a transcript polishing and lesson notes assistant for Uzbek-speaking learners.',
        'The raw transcript came from a local Rubai ASR pipeline.',
        'Preserve meaning exactly. Improve Uzbek Latin clarity, punctuation, and readability without inventing claims.',
        'Use the provided book/source snippets only as supporting evidence.',
        'If source context is weak or missing, say so clearly and do not fabricate references.',
        'Return valid JSON only. Do not wrap the JSON in markdown fences.',
        'Every JSON string value must be a single valid JSON string: escape newlines as \\n, tabs as \\t, quotes as \\", and backslashes as \\\\.',
        'Never place literal line breaks or raw control characters inside JSON string values.',
        'Allowed source references are only the provided snippet Reference ID values.',
        'Output JSON schema:',
        '{',
        '  "topicTitle": "string",',
        '  "polishedTranscript": "string",',
        '  "summary": "string",',
        '  "keyPoints": ["string"],',
        '  "terms": [{"term": "string", "definition": "string", "sourceSnippetIds": ["string"]}],',
        '  "flashcards": [{"prompt": "string", "answer": "string", "sourceSnippetIds": ["string"]}],',
        '  "reviewQuestions": ["string"],',
        '  "sourceReferences": [{"sourceSnippetId": "string", "note": "string"}],',
        '  "contextConfidence": "high|medium|low|missing",',
        '  "contextWarning": "string"',
        '}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        contextHeader ? `Kontekst: ${contextHeader}` : '',
        '',
        'Vazifa:',
        '- Raw Rubai transcriptni mazmunini saqlagan holda sayqallang.',
        '- Uzbek matnni ravon, aniq va o`qishga qulay qiling.',
        '- Mavzu sarlavhasini aniqlang yoki quyidagi mavzudan foydalaning.',
        '- Faqat berilgan snippetlarga tayanib manba havolalarini qaytaring.',
        '',
        `Tanlangan yoki aniqlangan mavzu: ${topicTitle}`,
        '',
        'Relevant book/source snippets:',
        formatBookContext(payload.bookContext),
        '',
        'Detected topics:',
        formatTopics(payload.detectedTopics),
        '',
        'Raw Rubai transcript:',
        payload.rawTranscript,
      ].join('\n'),
    },
  ];
}

export function buildLessonQuestionAnswerPrompt(payload: LessonQuestionAnswerPayload): ChatMessage[] {
  const contextHeader = [
    payload.courseName ? `Kurs: ${payload.courseName}` : null,
    payload.lessonName ? `Dars: ${payload.lessonName}` : null,
  ].filter(Boolean).join(' | ');
  const polishedLessonText = payload.polishedLessonText?.trim() || '[sayqallangan dars matni yoq]';
  const lessonOutput = payload.lessonOutput?.trim() || '[dars output yoq]';

  return [
    {
      role: 'system',
      content: [
        'You are a precise Q&A assistant for Uzbek-speaking Islamic studies learners.',
        'Answer only from the polished lesson material and the provided book/source snippets.',
        'If the user provides a multiple-choice test, choose the best option letter and explain why.',
        'If the lesson/book context is insufficient, say exactly what is missing instead of guessing.',
        'Keep the answer concise, test-focused, and suitable for studying.',
        'Use the same language and script as the question. If the question is Uzbek Cyrillic, answer in Uzbek Cyrillic.',
        'Mention the strongest lesson/book evidence in plain text. Do not invent page numbers or citations.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        contextHeader ? `Kontekst: ${contextHeader}` : '',
        '',
        'Savol yoki test:',
        payload.question,
        '',
        'Sayqallangan dars matni:',
        polishedLessonText,
        '',
        'Dars output / konspekt:',
        lessonOutput,
        '',
        'Kitob/source snippets:',
        formatBookContext(payload.bookContext),
        '',
        'Javob formati:',
        '- Test bo`lsa: "Javob: <harf>) <variant>" bilan boshlang.',
        '- Keyin 2-4 jumlada izoh bering.',
        '- Oxirida "Manba:" qatorida dars yoki kitobdan tayangan qismlarni ayting.',
      ].join('\n'),
    },
  ];
}
