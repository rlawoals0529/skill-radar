import { describe, expect, it } from "vitest";
import { cosine, rank, pairs } from "./similarity.js";

const v = (...n: number[]) => Float32Array.from(n);

describe("cosine", () => {
  it("is 1 for identical directions", () => {
    expect(cosine(v(1, 0, 0), v(1, 0, 0))).toBeCloseTo(1);
  });
  it("is 0 for orthogonal vectors", () => {
    expect(cosine(v(1, 0), v(0, 1))).toBeCloseTo(0);
  });
  it("is -1 for opposite directions", () => {
    expect(cosine(v(1, 0), v(-1, 0))).toBeCloseTo(-1);
  });
  it("ignores magnitude", () => {
    expect(cosine(v(2, 0), v(9, 0))).toBeCloseTo(1);
  });
  it("returns NaN against a zero vector rather than a fake 0", () => {
    // A zero vector has no direction. Reporting 0 would read as "unrelated", which is a
    // different and answerable claim.
    expect(Number.isNaN(cosine(v(0, 0), v(1, 0)))).toBe(true);
  });
  it("throws on a dimension mismatch instead of comparing the overlap", () => {
    expect(() => cosine(v(1, 0), v(1, 0, 0))).toThrow(/mismatch/i);
  });
});

describe("rank", () => {
  const skills = [
    { name: "near", vector: v(1, 0, 0) },
    { name: "mid", vector: v(0.7, 0.7, 0) },
    { name: "far", vector: v(0, 0, 1) },
  ];

  it("orders by similarity, highest first", () => {
    expect(rank(v(1, 0, 0), skills).map((r) => r.name)).toEqual(["near", "mid", "far"]);
  });

  it("marks two skills inside the margin as contested", () => {
    const tie = [
      { name: "a", vector: v(1, 0) },
      { name: "b", vector: v(0.999, 0.045) },
    ];
    const out = rank(v(1, 0), tie, 0.02);
    expect(out.every((r) => r.contested)).toBe(true);
  });

  it("does not mark a clear winner as contested", () => {
    expect(rank(v(1, 0, 0), skills, 0.02).every((r) => !r.contested)).toBe(true);
  });

  it("returns an empty list for no skills rather than throwing", () => {
    expect(rank(v(1, 0), [])).toEqual([]);
  });
});

describe("pairs", () => {
  it("returns every distinct pair once, most similar first", () => {
    const out = pairs([
      { name: "a", vector: v(1, 0) },
      { name: "b", vector: v(1, 0) },
      { name: "c", vector: v(0, 1) },
    ]);
    expect(out).toHaveLength(3);
    expect([out[0]!.a, out[0]!.b].sort()).toEqual(["a", "b"]);
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score);
  });
  it("has no pairs for a single skill", () => {
    expect(pairs([{ name: "solo", vector: v(1, 0) }])).toEqual([]);
  });
});
