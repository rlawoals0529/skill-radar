import { useCallback, useMemo, useRef, useState } from "react";
import type { Skill, Finding } from "skill-lint/core";
import { fromDirectory, fromFiles, fromGitHub, fromText, type Loaded } from "./lib/load.js";
import type { Progress } from "./lib/embed.js";
import { rank, pairs, type Ranked, type Pair } from "./lib/similarity.js";

interface Vectored {
  skill: Skill;
  vector: Float32Array;
  tokens: number;
}

type Tab = "routing" | "overlap" | "cost";

const DEMO_REPO = "rlawoals0529/agent-skills";

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [vectors, setVectors] = useState<Vectored[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [utterance, setUtterance] = useState("the PR came back with requested changes");
  const [ranked, setRanked] = useState<Ranked[] | null>(null);
  const [tab, setTab] = useState<Tab>("routing");
  const [repo, setRepo] = useState(DEMO_REPO);
  const [over, setOver] = useState(false);
  const [pasted, setPasted] = useState("");
  const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
  const fileInput = useRef<HTMLInputElement>(null);

  const guard = useCallback(async (label: string, fn: () => Promise<void>) => {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, []);

  const accept = useCallback((l: Loaded) => {
    setLoaded(l);
    setVectors(null);
    setRanked(null);
  }, []);

  // Dynamic, so the ~776 kB of runtime is fetched when the user asks for the model and not
  // on page open. Nothing above this point needs it.
  const engine = useCallback(() => import("./lib/embed.js"), []);

  const analyse = useCallback(
    () =>
      guard("Loading the model and embedding", async () => {
        if (!loaded) return;
        const { loadModel, embed, countTokens } = await engine();
        await loadModel(setProgress);
        const out: Vectored[] = [];
        for (const skill of loaded.skills) {
          // Route on the description, because that is what a harness actually reads.
          const text = skill.description || skill.name;
          out.push({ skill, vector: await embed(text), tokens: await countTokens(text) });
        }
        setVectors(out);
      }),
    [guard, loaded, engine],
  );

  const route = useCallback(
    () =>
      guard("Embedding the utterance", async () => {
        if (!vectors || !utterance.trim()) return;
        const { embed } = await engine();
        const q = await embed(utterance, false);
        setRanked(rank(q, vectors.map((v) => ({ name: v.skill.name || v.skill.dir, vector: v.vector }))));
      }),
    [guard, vectors, utterance, engine],
  );

  const overlap: Pair[] = useMemo(
    () => (vectors ? pairs(vectors.map((v) => ({ name: v.skill.name || v.skill.dir, vector: v.vector }))) : []),
    [vectors],
  );

  const totalTokens = useMemo(() => vectors?.reduce((n, v) => n + v.tokens, 0) ?? 0, [vectors]);

  return (
    <div className="wrap">
      <h1>
        skill&#8209;<span>radar</span>
      </h1>
      <p className="tagline">
        Load a skills folder, type what a user would actually say, and see which skills would fire.
        The check a string match cannot do, because it cannot tell that “the PR came back” and
        “requested changes” mean the same thing.
      </p>
      <div className="privacy">
        Runs entirely in your browser · no API key · nothing uploaded · works offline once cached
      </div>

      <section className="panel">
        <h2>1 · Load skills</h2>
        <div className="row">
          <button onClick={() => guard("Reading the folder", async () => accept(await fromDirectory()))}>
            Pick a folder
          </button>
          <button onClick={() => fileInput.current?.click()}>Choose files</button>
          <input
            ref={fileInput}
            type="file"
            accept=".md"
            multiple
            hidden
            onChange={(e) =>
              guard("Reading files", async () => accept(await fromFiles([...(e.target.files ?? [])])))
            }
          />
        </div>

        <div
          className={over ? "drop over" : "drop"}
          style={{ marginTop: 12 }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            guard("Reading dropped files", async () => accept(await fromFiles([...e.dataTransfer.files])));
          }}
        >
          or drop <code>SKILL.md</code> files here
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <input
            type="text"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            aria-label="Public GitHub repository"
            style={{ flex: 1, minWidth: 240 }}
          />
          <button onClick={() => guard("Fetching from GitHub", async () => accept(await fromGitHub(repo)))}>
            Load public repo
          </button>
        </div>
        <p className="note">
          No files to hand? The repo above is a set of real skills, and it has a known-correct answer:
          two of them deliberately share triggers.
        </p>

        <details style={{ marginTop: 12 }}>
          <summary className="note" style={{ cursor: "pointer" }}>or paste one skill</summary>
          <textarea
            rows={6}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="---&#10;name: my-skill&#10;description: ...&#10;---"
            style={{ marginTop: 8 }}
          />
          {/* An explicit action. Loading on blur is invisible: nothing tells you it happened,
              and nothing happens at all if you never click away. */}
          <button style={{ marginTop: 8 }} disabled={!pasted.trim()} onClick={() => accept(fromText(pasted))}>
            Load pasted skill
          </button>
        </details>

        {busy && !loaded && <p className="note">{busy}…</p>}
        {error && <p className="err">{error}</p>}

        {loaded && (
          <p className="note">
            <b>{loaded.skills.length}</b> skill{loaded.skills.length === 1 ? "" : "s"} from{" "}
            <b>{loaded.source}</b>
            {loaded.findings.length > 0 && (
              <> · {loaded.findings.length} lint finding{loaded.findings.length === 1 ? "" : "s"}</>
            )}
          </p>
        )}
      </section>

      {loaded && (
        <section className="panel">
          <h2>2 · Embed</h2>
          <div className="row">
            <button className="primary" onClick={analyse} disabled={!!busy}>
              {vectors ? "Re-embed" : "Load model and embed"}
            </button>
            <span className="note" style={{ margin: 0 }}>
              ~23 MB, once. Backend: <b>{hasWebGPU ? "webgpu" : "wasm"}</b>.
            </span>
          </div>
          {busy && (
            <div style={{ marginTop: 12 }}>
              <p className="note" style={{ marginTop: 0 }}>
                {busy}
                {progress?.status ? ` · ${progress.status}` : ""}
              </p>
              {typeof progress?.progress === "number" && <progress value={progress.progress} max={100} />}
            </div>
          )}
        </section>
      )}

      {vectors && (
        <>
          <div className="tabs" role="tablist">
            {(["routing", "overlap", "cost"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {t === "routing" ? "Routing" : t === "overlap" ? "Overlap" : "Cost"}
              </button>
            ))}
          </div>

          {tab === "routing" && (
            <section className="panel">
              <h2>What would fire</h2>
              <div className="row">
                <input
                  type="text"
                  value={utterance}
                  onChange={(e) => setUtterance(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && route()}
                  aria-label="What a user would say"
                  style={{ flex: 1, minWidth: 260 }}
                />
                <button className="primary" onClick={route} disabled={!!busy}>
                  Rank
                </button>
              </div>

              {ranked && (
                <div style={{ display: "grid", gap: 7, marginTop: 14 }}>
                  {ranked.map((r) => (
                    <div key={r.name} className={r.contested ? "bar contested" : "bar"}>
                      <i style={{ width: `${Math.max(0, r.score) * 100}%` }} />
                      <span>
                        <b>
                          {r.name} {r.contested && <span className="pill warn">contested</span>}
                        </b>
                        <code>{r.score.toFixed(3)}</code>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="note">
                <b>Contested</b> means two skills scored within 0.02 of each other. In practice that is
                a toss-up.
              </p>
            </section>
          )}

          {tab === "overlap" && (
            <section className="panel">
              <h2>Semantic overlap</h2>
              <table>
                <thead>
                  <tr>
                    <th>Pair</th>
                    <th className="num">Similarity</th>
                  </tr>
                </thead>
                <tbody>
                  {overlap.slice(0, 15).map((p) => (
                    <tr key={`${p.a}|${p.b}`} className={p.score > 0.7 ? "hot" : undefined}>
                      <td>
                        {p.a} <span style={{ color: "var(--dim)" }}>↔</span> {p.b}
                      </td>
                      <td className="num">{p.score.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="note">
                A linter reports an exactly shared trigger phrase. This reports skills that
                <i> mean</i> the same thing, which is the commoner and invisible version.
              </p>
            </section>
          )}

          {tab === "cost" && (
            <section className="panel">
              <h2>Context cost</h2>
              <table>
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th className="num">Description tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {[...vectors]
                    .sort((a, b) => b.tokens - a.tokens)
                    .map((v) => (
                      <tr key={v.skill.file}>
                        <td>{v.skill.name || v.skill.dir}</td>
                        <td className="num">{v.tokens}</td>
                      </tr>
                    ))}
                  <tr>
                    <td>
                      <b>Total, every turn</b>
                    </td>
                    <td className="num">
                      <b>{totalTokens}</b>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="note">
                Counted with the model's own tokenizer, not estimated. These are this model's tokens,
                not your agent's. A good proxy, not the exact bill.
              </p>
            </section>
          )}
        </>
      )}

      {loaded && loaded.findings.length > 0 && (
        <section className="panel">
          <h2>Lint findings</h2>
          <table>
            <thead>
              <tr>
                <th>Rule</th>
                <th>Skill</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {loaded.findings.map((f: Finding, i) => (
                <tr key={i}>
                  <td>
                    <span className={f.severity === "error" ? "pill err" : "pill warn"}>{f.rule}</span>
                  </td>
                  <td>{f.skill}</td>
                  <td style={{ color: "var(--dim)" }}>{f.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            From <code>skill-lint</code>, running here in the browser. The broken-reference rule is
            skipped, because there is no filesystem to check a path against and guessing would be
            worse than silence.
          </p>
        </section>
      )}

      <section className="panel">
        <h2>What this is not</h2>
        <p className="note" style={{ marginTop: 0 }}>
          Cosine similarity over descriptions is <b>not</b> how any particular agent harness routes.
          This is a proxy that surfaces overlap and cost, not a simulation of a specific router. Treat
          a contested pair as a prompt to go and read both descriptions, not as a verdict.
        </p>
      </section>
    </div>
  );
}
