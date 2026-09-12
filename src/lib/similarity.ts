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

/**
 * Where each ranking sits on one shared axis, and where the coin-flip window is.
 *
 * The list of scores is the same information either way; what a shared axis adds is that two
 * skills the model cannot separate land in the same PLACE, which is the whole finding. A
 * column of bars drawn from zero cannot show that: every bar starts at the same edge, so the
 * eye compares lengths that differ by a percent and sees nothing.
 *
 * The axis is zoomed to the scores rather than fixed at 0..1. Real utterances cluster in a
 * narrow band, and on a full-width axis the 0.02 that decides the answer is a pixel. Zoomed,
 * it is a gap you can see - which is why both ends carry their real value.
 */
export interface Axis {
  /** Score at the left and right edges. */
  from: number;
  to: number;
  /** 0..1 across the axis. Clamped, so a score outside the range cannot leave the plot. */
  at(score: number): number;
  /** The window within `margin` of the top score: anything inside it is a toss-up. */
  contested: { from: number; to: number } | null;
}

export function axisFor(ranked: readonly Ranked[], margin = 0.02, pad = 0.25): Axis {
  const scores = ranked.map((r) => r.score);
  const top = scores.length ? Math.max(...scores) : 0;
  const low = scores.length ? Math.min(...scores) : 0;
  // A single skill, or ten identical ones, would give a zero-width axis and divide by zero.
  const span = Math.max(top - low, margin * 2);
  const room = span * pad;
  const from = low - room;
  const to = top + room;

  return {
    from,
    to,
    at: (score) => Math.min(1, Math.max(0, (score - from) / (to - from))),
    contested: ranked.some((r) => r.contested) ? { from: top - margin, to: top } : null,
  };
}
