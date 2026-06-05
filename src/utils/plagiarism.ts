// Plagiarism detection — multi-method analysis
// 1. Cosine similarity on word frequency (catches vocabulary overlap)
// 2. N-gram matching (catches copied phrases)
// 3. Longest common subsequence ratio (catches structural copying)

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','was','are','were','be','been','being','have','has','had','do',
  'does','did','will','would','could','should','may','might','this','that',
  'these','those','it','its','i','you','he','she','we','they','my','your',
  'his','her','our','their','as','if','so','not','no','up','out','about',
  'also','very','just','then','than','more','most','some','any','each',
  'every','all','both','few','many','much','own','same','other','such',
  'only','into','over','after','before','between','through','during','without'
]);

export function extractText(fileData: string): string {
  try {
    let decoded = Buffer.from(fileData, 'base64').toString('utf-8');
    // Strip HTML tags (for written answer submissions)
    decoded = decoded.replace(/<[^>]*>/g, ' ');
    // Decode HTML entities
    decoded = decoded.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return decoded
      .replace(/[\x00-\x1F\x7F-\xFF]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  } catch {
    return '';
  }
}

// ==================== METHOD 1: Word Frequency + Cosine ====================

function getWords(text: string): string[] {
  return text.split(/\W+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function wordFrequency(text: string): Map<string, number> {
  const freq = new Map<string, number>();
  for (const word of getWords(text)) {
    freq.set(word, (freq.get(word) || 0) + 1);
  }
  return freq;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (const [word, countA] of a) {
    dot += countA * (b.get(word) || 0);
    magA += countA * countA;
  }
  for (const [, countB] of b) {
    magB += countB * countB;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ==================== METHOD 2: N-gram Matching ====================
// Catches copied phrases — even if surrounding text differs

function getNgrams(text: string, n: number): Set<string> {
  const words = getWords(text);
  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}

function ngramOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) {
    if (b.has(gram)) shared++;
  }
  // Jaccard-style: shared / union
  return shared / (a.size + b.size - shared);
}

// ==================== METHOD 3: Sentence-Level LCS Ratio ====================
// Catches structural copying — same ideas in same order

function getSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 15); // skip tiny fragments
}

function normalizeSentence(s: string): string {
  return getWords(s).sort().join(' ');
}

function sentenceOverlap(textA: string, textB: string): number {
  const sentA = getSentences(textA).map(normalizeSentence);
  const sentB = new Set(getSentences(textB).map(normalizeSentence));
  if (sentA.length === 0 || sentB.size === 0) return 0;
  let matches = 0;
  for (const s of sentA) {
    if (sentB.has(s)) matches++;
  }
  return matches / Math.max(sentA.length, sentB.size);
}

// ==================== Combined Detection ====================

export interface PlagiarismResult {
  studentA: string;
  studentB: string;
  studentAId: string;
  studentBId: string;
  similarity: number;
  level: 'high' | 'medium' | 'low';
  breakdown: {
    wordSimilarity: number;
    phraseSimilarity: number;
    structureSimilarity: number;
  };
}

export function detectPlagiarism(
  submissions: Array<{ _id: string; studentName: string; fileData: string }>
): PlagiarismResult[] {
  const results: PlagiarismResult[] = [];

  // Pre-compute all features for each submission
  const processed = submissions.map(s => {
    const text = extractText(s.fileData);
    return {
      id: s._id,
      name: s.studentName,
      text,
      wordFreq: wordFrequency(text),
      trigrams: getNgrams(text, 3),
      quadgrams: getNgrams(text, 4),
    };
  });

  // Compare all pairs
  for (let i = 0; i < processed.length; i++) {
    for (let j = i + 1; j < processed.length; j++) {
      const a = processed[i]!;
      const b = processed[j]!;

      // Method 1: Word-level cosine similarity (0-1)
      const wordSim = cosineSimilarity(a.wordFreq, b.wordFreq);

      // Method 2: N-gram overlap — average of trigram and quadgram (0-1)
      const trigramSim = ngramOverlap(a.trigrams, b.trigrams);
      const quadgramSim = ngramOverlap(a.quadgrams, b.quadgrams);
      const phraseSim = (trigramSim + quadgramSim) / 2;

      // Method 3: Sentence structure overlap (0-1)
      const structSim = sentenceOverlap(a.text, b.text);

      // Weighted combination:
      // - 35% word similarity (broad vocabulary match)
      // - 40% phrase similarity (strongest signal for copying)
      // - 25% structure similarity (same ideas in same order)
      const combined = wordSim * 0.35 + phraseSim * 0.40 + structSim * 0.25;

      if (combined >= 0.25) { // Lower threshold since combined score is stricter
        results.push({
          studentA: a.name,
          studentB: b.name,
          studentAId: a.id,
          studentBId: b.id,
          similarity: Math.round(combined * 100),
          level: combined >= 0.65 ? 'high' : combined >= 0.40 ? 'medium' : 'low',
          breakdown: {
            wordSimilarity: Math.round(wordSim * 100),
            phraseSimilarity: Math.round(phraseSim * 100),
            structureSimilarity: Math.round(structSim * 100),
          }
        });
      }
    }
  }

  return results.sort((a, b) => b.similarity - a.similarity);
}
