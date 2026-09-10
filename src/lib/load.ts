/**
 * Getting skills in. Three ways, none of which involve a server of ours.
 */
import { parseSkill, lintSkills, type Skill, type Finding } from "skill-lint/core";

export interface Loaded {
  skills: Skill[];
  findings: Finding[];
  source: string;
}

/**
 * `refExists` is deliberately not passed. There is no filesystem here, and skill-lint skips
 * the broken-reference rule rather than guessing — which is the behaviour we want surfaced.
 */
function assemble(skills: Skill[], source: string): Loaded {
  return { skills, findings: lintSkills(skills), source };
}

/** A directory the user picked, walked for SKILL.md. Chromium only; the UI offers fallbacks. */
export async function fromDirectory(): Promise<Loaded> {
  const picker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker;
  if (!picker) throw new Error("This browser has no directory picker. Drop files instead.");

  const root = await picker.call(window);
  const skills: Skill[] = [];

  const walk = async (handle: FileSystemDirectoryHandle, path: string, depth: number) => {
    if (depth > 4) return;
    for await (const [name, entry] of (handle as never as AsyncIterable<[string, FileSystemHandle]>)) {
      if (name.startsWith(".") || name === "node_modules") continue;
      if (entry.kind === "file" && name === "SKILL.md") {
        const text = await (entry as FileSystemFileHandle).getFile().then((f) => f.text());
        skills.push(parseSkill(text, { dir: path, file: `${path}/SKILL.md` }));
      } else if (entry.kind === "directory") {
        await walk(entry as FileSystemDirectoryHandle, `${path}/${name}`, depth + 1);
      }
    }
  };
  await walk(root, root.name, 0);
  return assemble(skills, root.name);
}

/** Dropped or picked files. A dropped folder arrives as files with a relative path. */
export async function fromFiles(files: File[]): Promise<Loaded> {
  const md = files.filter((f) => f.name.endsWith(".md"));
  const skills = await Promise.all(
    md.map(async (f) => {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : f.name.replace(/\.md$/, "");
      return parseSkill(await f.text(), { dir, file: rel });
    }),
  );
  return assemble(skills, `${md.length} file${md.length === 1 ? "" : "s"}`);
}

/** One pasted SKILL.md, for trying a single skill without any files at all. */
export function fromText(text: string, name = "pasted"): Loaded {
  return assemble([parseSkill(text, { dir: name })], name);
}

/**
 * A public GitHub repo, so the demo works with nothing local.
 *
 * Unauthenticated and rate-limited to 60 requests an hour per IP; the error says so rather
 * than reporting an empty repository, because those look identical and need opposite fixes.
 */
export async function fromGitHub(repo: string, path = ""): Promise<Loaded> {
  const clean = repo.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
  const skills: Skill[] = [];

  const walk = async (p: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    const res = await fetch(`https://api.github.com/repos/${clean}/contents/${p}`);
    if (res.status === 403) throw new Error("GitHub rate limit reached. Wait an hour, or drop the files instead.");
    if (res.status === 404) throw new Error(`No such public repository or path: ${clean}/${p}`);
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`);

    const entries = (await res.json()) as { name: string; path: string; type: string; download_url: string | null }[];
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      if (e.type === "file" && e.name === "SKILL.md" && e.download_url) {
        const text = await fetch(e.download_url).then((r) => r.text());
        const dir = e.path.slice(0, e.path.lastIndexOf("/")) || clean;
        skills.push(parseSkill(text, { dir, file: e.path }));
      } else if (e.type === "dir") {
        await walk(e.path, depth + 1);
      }
    }
  };

  await walk(path, 0);
  if (skills.length === 0) throw new Error(`Found no SKILL.md under ${clean}/${path || "the repository root"}.`);
  return assemble(skills, clean);
}
