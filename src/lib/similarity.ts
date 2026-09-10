/**
 * Ranking maths. Pure, so it is tested with fixed vectors and never needs a model.
 */

export interface Ranked {
  name: string;
  score: number;
  /** True when the skill above it is close enough that routing is effectively a toss-up. */
  contested: boolean;
}

/** Cosine similarity. Inputs are already L2-normalised by the embedding pipeline. */
export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  if (a.length !== b.length) throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  // A zero vector has no direction, so similarity to it is undefined rather than 0.
  if (na === 0 || nb === 0) return Number.NaN;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Rank skills against one utterance.
 *
 * `margin` is what makes this a diagnostic rather than a leaderboard: two skills inside it
 * are reported as contested, because in practice which one fires is a toss-up.
 */
export function rank(
  query: Float32Array,
  skills: { name: string; vector: Float32Array }[],
  margin = 0.02,
): Ranked[] {
  const scored = skills
    .map((s) => ({ name: s.name, score: cosine(query, s.vector), contested: false }))
    .sort((a, b) => b.score - a.score);

  for (let i = 1; i < scored.length; i++) {
    if (scored[i - 1]!.score - scored[i]!.score <= margin) {
      scored[i - 1]!.contested = true;
      scored[i]!.contested = true;
    }
  }
  return scored;
}

export interface Pair {
  a: string;
  b: string;
  score: number;
}

/** Every distinct pair, most similar first. This is the semantic-overlap view. */
export function pairs(skills: { name: string; vector: Float32Array }[]): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      out.push({ a: skills[i]!.name, b: skills[j]!.name, score: cosine(skills[i]!.vector, skills[j]!.vector) });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}
