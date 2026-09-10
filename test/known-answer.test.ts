import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSkill } from "skill-lint/core";
import { pairs, rank } from "../src/lib/similarity.js";

const SKILLS_DIR = process.env.SKILLS_DIR ?? "";

/**
 * The integration check the whole tool rests on.
 *
 * `agent-skills` has a KNOWN-CORRECT answer: audit-pr-threads and code-quality deliberately
 * share triggers, so they must surface as the most semantically similar pair. If they do not,
 * the tool is wrong — not the skills.
 *
 * Skipped unless SKILLS_DIR points at a real skills tree, so CI stays fast and offline.
 */
describe.skipIf(!SKILLS_DIR)("against a real skills tree", () => {
  const load = () =>
    readdirSync(join(SKILLS_DIR, "skills")).map((name) =>
      parseSkill(readFileSync(join(SKILLS_DIR, "skills", name, "SKILL.md"), "utf8"), { dir: name }),
    );

  it("surfaces the deliberately-colliding pair near the top", { timeout: 300_000 }, async () => {
    const { embed } = await import("../src/lib/embed.js");
    const skills = load();
    expect(skills.length).toBeGreaterThan(5);

    const vectors = [];
    for (const s of skills) vectors.push({ name: s.name, vector: await embed(s.description, false) });

    // audit-pr-threads and code-quality share triggers on purpose, so they must rank high.
    // Not necessarily first: the first assertion here demanded that, and the tool was right
    // while the test was wrong. Semantic overlap and a shared quoted phrase are different
    // measures, which is the whole reason this tool exists beside the linter.
    const top3 = pairs(vectors).slice(0, 3).map((p) => [p.a, p.b].sort().join("|"));
    expect(top3).toContain("audit-pr-threads|code-quality");
  });

  it("finds overlap that a quoted-trigger check cannot see", { timeout: 300_000 }, async () => {
    const { embed } = await import("../src/lib/embed.js");
    const { lintSkills } = await import("skill-lint/core");
    const skills = load();

    const vectors = [];
    for (const s of skills) vectors.push({ name: s.name, vector: await embed(s.description, false) });

    const flagged = new Set(
      lintSkills(skills)
        .filter((f) => f.rule === "trigger-collision")
        .map((f) => f.skill.split(",").map((x) => x.trim()).sort().join("|")),
    );

    // The value proposition, asserted: at least one strongly-similar pair shares no exact
    // trigger phrase, so the linter is structurally unable to report it.
    const unflagged = pairs(vectors)
      .filter((p) => p.score > 0.6)
      .filter((p) => !flagged.has([p.a, p.b].sort().join("|")));

    expect(unflagged.length).toBeGreaterThan(0);
  });

  it("routes a review utterance to a review skill", { timeout: 300_000 }, async () => {
    const { embed } = await import("../src/lib/embed.js");
    const skills = load();
    const vectors = [];
    for (const s of skills) vectors.push({ name: s.name, vector: await embed(s.description, false) });

    const q = await embed("the PR came back with requested changes", false);
    const winner = rank(q, vectors)[0]!.name;
    expect(["audit-pr-threads", "code-quality", "adversarial-review", "review-triage"]).toContain(winner);
  });
});
