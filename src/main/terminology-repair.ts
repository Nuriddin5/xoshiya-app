import type { BookSnippet } from '../shared/types.js';

type TerminologyFamily = {
  canonical: string;
  category: 'arabic phrase' | 'aqida term' | 'transliteration variant';
  variants: string[];
};

type TerminologyRepairContext = {
  evidenceSnippets: BookSnippet[];
  focusTerms: string[];
  promptBlock: string;
};

const MAX_EVIDENCE_SNIPPETS = 3;

const TERMINOLOGY_FAMILIES: TerminologyFamily[] = [
  {
    canonical: 'aqida',
    category: 'aqida term',
    variants: ['aqida', 'aqidah', 'aqeeda', 'aqeedah'],
  },
  {
    canonical: 'iman',
    category: 'aqida term',
    variants: ['iman', 'eeman', 'iymon'],
  },
  {
    canonical: 'islam',
    category: 'aqida term',
    variants: ['islam', 'islom'],
  },
  {
    canonical: 'sunnah',
    category: 'aqida term',
    variants: ['sunnah', 'sunna', 'sunnat'],
  },
  {
    canonical: 'bidah',
    category: 'aqida term',
    variants: ['bidah', "bid'ah", 'bid`ah', 'bidat'],
  },
  {
    canonical: 'shirk',
    category: 'aqida term',
    variants: ['shirk'],
  },
  {
    canonical: 'tawhid',
    category: 'aqida term',
    variants: ['tawhid', 'tauhid', 'tavhid', 'towhid'],
  },
  {
    canonical: 'rububiyah',
    category: 'aqida term',
    variants: ['rububiyah', 'rububiyya', 'ruboobiyyah'],
  },
  {
    canonical: 'uluhiyah',
    category: 'aqida term',
    variants: ['uluhiyah', 'uloohiyyah', 'uluhiyya'],
  },
  {
    canonical: 'asma wa sifat',
    category: 'aqida term',
    variants: ['asma wa sifat', 'asma ul husna', 'asmau sifat'],
  },
  {
    canonical: 'bismillahir rohmanir rohim',
    category: 'arabic phrase',
    variants: [
      'bismillahir rohmanir rohim',
      'bismillahir rahmanir rahim',
      'bismillahi r-rahmani r-rahim',
      'bismillah ir rahman ir rahim',
    ],
  },
  {
    canonical: 'la ilaha illallah',
    category: 'arabic phrase',
    variants: [
      'la ilaha illallah',
      'laa ilaha illallah',
      'la ilaha illa allah',
      'la ilaha illa llah',
    ],
  },
  {
    canonical: 'subhanahu wa taala',
    category: 'arabic phrase',
    variants: ['subhanahu wa taala', 'subhanahu wataala', "subhanahu wata'ala"],
  },
  {
    canonical: 'sallallahu alayhi wa sallam',
    category: 'arabic phrase',
    variants: [
      'sallallahu alayhi wa sallam',
      'salallahu alayhi wasallam',
      'sallallahu alaihi wasallam',
    ],
  },
  {
    canonical: 'astaghfirullah',
    category: 'arabic phrase',
    variants: ['astaghfirullah', 'astagfirullah', 'astaghfirullaah'],
  },
];

function normalizeTerminologyText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[\u064b-\u065f\u0670\u06d6-\u06ed]/gu, '')
    .replace(/[\u2018\u2019`\u02bb\u02bc]/gu, "'")
    .replace(/[^\p{L}\p{N}'\u0600-\u06ff\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function hasArabicScript(text: string): boolean {
  return /[\u0600-\u06ff]/u.test(text);
}

function getMatchedFamilies(text: string): TerminologyFamily[] {
  const normalizedText = normalizeTerminologyText(text);
  return TERMINOLOGY_FAMILIES.filter((family) =>
    family.variants.some((variant) => normalizedText.includes(normalizeTerminologyText(variant))),
  );
}

function isKnownTerminologySnippet(snippet: BookSnippet): boolean {
  return getMatchedFamilies(`${snippet.heading} ${snippet.text} ${snippet.matchedTerms.join(' ')}`).length > 0;
}

function scoreEvidenceSnippet(snippet: BookSnippet, focusTerms: string[]): number {
  const normalizedText = normalizeTerminologyText(`${snippet.heading} ${snippet.text} ${snippet.matchedTerms.join(' ')}`);
  let score = snippet.score;

  for (const term of focusTerms) {
    if (normalizedText.includes(normalizeTerminologyText(term))) {
      score += 6;
    }
  }

  score += snippet.matchedTerms.length * 2;

  if (hasArabicScript(snippet.text)) {
    score += 2;
  }

  if (isKnownTerminologySnippet(snippet)) {
    score += 5;
  }

  return score;
}

function isRelevantEvidenceSnippet(snippet: BookSnippet, focusTerms: string[]): boolean {
  const normalizedText = normalizeTerminologyText(`${snippet.heading} ${snippet.text} ${snippet.matchedTerms.join(' ')}`);

  return hasArabicScript(snippet.text)
    || isKnownTerminologySnippet(snippet)
    || focusTerms.some((term) => normalizedText.includes(normalizeTerminologyText(term)));
}

function buildFocusTerms(rawTranscript: string, snippets: BookSnippet[]): string[] {
  const transcriptFamilies = getMatchedFamilies(rawTranscript);
  const snippetFamilies = snippets.flatMap((snippet) =>
    getMatchedFamilies(`${snippet.heading} ${snippet.text} ${snippet.matchedTerms.join(' ')}`),
  );

  return [...new Set([
    ...transcriptFamilies.map((family) => family.canonical),
    ...snippetFamilies.map((family) => family.canonical),
    ...snippets.flatMap((snippet) => snippet.matchedTerms),
  ])].slice(0, 12);
}

function formatFamilyHints(families: TerminologyFamily[]): string {
  if (families.length === 0) {
    return '- no explicit Arabic or aqida repair terms were detected';
  }

  return families
    .map((family) => `- ${family.category}: ${family.canonical} (${family.variants.join(', ')})`)
    .join('\n');
}

function formatEvidenceLines(snippets: BookSnippet[]): string {
  if (snippets.length === 0) {
    return '- no strong evidence snippets were selected';
  }

  return snippets
    .map((snippet, index) => {
      const matchedTerms = snippet.matchedTerms.length > 0 ? snippet.matchedTerms.join(', ') : 'no matched terms';
      return `${index + 1}. ${snippet.sourceName} | ${snippet.heading} | ${matchedTerms}`;
    })
    .join('\n');
}

export function buildTerminologyRepairContext(rawTranscript: string, snippets: BookSnippet[]): TerminologyRepairContext {
  const focusTerms = buildFocusTerms(rawTranscript, snippets);
  const focusedFamilies = TERMINOLOGY_FAMILIES.filter((family) =>
    focusTerms.some((term) =>
      family.canonical === term || family.variants.some((variant) => normalizeTerminologyText(variant) === normalizeTerminologyText(term)),
    ),
  );

  const evidenceSnippets = [...snippets]
    .filter((snippet) => isRelevantEvidenceSnippet(snippet, focusTerms))
    .sort((left, right) => scoreEvidenceSnippet(right, focusTerms) - scoreEvidenceSnippet(left, focusTerms))
    .slice(0, MAX_EVIDENCE_SNIPPETS);

  const promptBlock = [
    'Arabic and aqida repair focus:',
    formatFamilyHints(focusedFamilies),
    '',
    'Rules:',
    '- Treat the variants above as detection hints only, not as source text.',
    '- Use the selected book snippets as the source of truth for Arabic phrases and aqida terminology.',
    '- Preserve transliteration when the selected context does not support exact Arabic script.',
    '- If a term is unsupported or uncertain, keep it as [noaniq].',
    '- Do not invent theological wording, and do not add explanations.',
    '',
    'Evidence snippets to favor:',
    formatEvidenceLines(evidenceSnippets),
  ].join('\n');

  return {
    evidenceSnippets,
    focusTerms,
    promptBlock,
  };
}
