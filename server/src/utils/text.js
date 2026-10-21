/**
 * Deterministic text/attribute similarity used by the matching engine.
 *
 * These helpers are pure functions with no external dependency, so match scores
 * are reproducible and testable (spec 13.1: "documented deterministic rules").
 * They are deliberately simple and explainable rather than state of the art.
 */

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'my', 'i', 'it', 'is', 'was', 'near', 'by', 'from', 'this', 'that', 'some',
]);

/** Lower-cases, removes punctuation and collapses whitespace. */
export function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits normalized text into meaningful tokens, dropping stop words. */
export function tokenize(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(' ').filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

/** Set-based Jaccard similarity in [0, 1]. */
export function jaccardSimilarity(left, right) {
  const a = new Set(tokenize(left));
  const b = new Set(tokenize(right));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function trigrams(value) {
  const padded = `  ${normalizeText(value)} `;
  const grams = new Set();
  for (let i = 0; i < padded.length - 2; i += 1) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** Character-trigram Dice coefficient in [0, 1]. Tolerant of typos. */
export function trigramSimilarity(left, right) {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) if (b.has(gram)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

/**
 * Blended text similarity: 60% trigram (handles "iphone"/"i phone") and
 * 40% token Jaccard (handles word order and extra words). Result in [0, 1].
 */
export function textSimilarity(left, right) {
  if (!normalizeText(left) || !normalizeText(right)) return 0;
  return 0.6 * trigramSimilarity(left, right) + 0.4 * jaccardSimilarity(left, right);
}

// ---------------------------------------------------------------------------
// Colour handling
// ---------------------------------------------------------------------------
// Basic colour vocabulary. Two colours in the same group count as similar
// (e.g. "grey" vs "silver"), which is more useful than string equality alone.
const COLOUR_GROUPS = [
  ['black', 'dark', 'charcoal'],
  ['white', 'cream', 'ivory'],
  ['grey', 'gray', 'silver'],
  ['red', 'maroon', 'burgundy', 'crimson'],
  ['blue', 'navy', 'azure', 'denim'],
  ['green', 'olive', 'emerald'],
  ['yellow', 'gold', 'golden', 'amber'],
  ['orange', 'peach'],
  ['brown', 'tan', 'beige', 'chocolate'],
  ['purple', 'violet', 'lilac'],
  ['pink', 'rose', 'magenta'],
  ['transparent', 'clear'],
];

const COLOUR_LOOKUP = new Map();
for (const group of COLOUR_GROUPS) {
  for (const colour of group) COLOUR_LOOKUP.set(colour, group[0]);
}

/**
 * Colour similarity in [0, 1] with explicit null handling.
 * @returns {{score: number|null, exact: boolean}} score is null when either
 *          value is missing, so the caller can re-normalise the weights.
 */
export function colourSimilarity(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return { score: null, exact: false };
  if (a === b) return { score: 1, exact: true };
  const groupA = COLOUR_LOOKUP.get(a);
  const groupB = COLOUR_LOOKUP.get(b);
  if (groupA && groupB && groupA === groupB) return { score: 0.6, exact: false };
  if (a.includes(b) || b.includes(a)) return { score: 0.5, exact: false };
  return { score: 0, exact: false };
}

/**
 * Brand similarity in [0, 1]. Missing data returns null so the caller can
 * re-normalise. Contains-matching absorbs "Apple" vs "Apple Inc.".
 */
export function brandSimilarity(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return { score: null, exact: false };
  if (a === b) return { score: 1, exact: true };
  if (a.includes(b) || b.includes(a)) return { score: 0.7, exact: false };
  return { score: 0, exact: false };
}

export default {
  normalizeText,
  tokenize,
  jaccardSimilarity,
  trigramSimilarity,
  textSimilarity,
  colourSimilarity,
  brandSimilarity,
};
