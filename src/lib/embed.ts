/**
 * The model, and the cache in front of it.
 *
 * Everything runs in the browser. Nothing is uploaded, no key is needed, and once the model
 * is cached the page works offline.
 */
import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";

// Only ever fetch from the hub; never look for a local /models path that will 404.
env.allowLocalModels = false;

export const MODEL = "Xenova/all-MiniLM-L6-v2";

export type Progress = { status: string; loaded?: number; total?: number; progress?: number };

let extractor: Promise<FeatureExtractionPipeline> | null = null;

/** Loads on first call and never twice. WebGPU where available, WASM otherwise. */
export function loadModel(onProgress?: (p: Progress) => void): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    extractor = (async () => {
      // Only name a device when we are asking for WebGPU. The valid fallback differs by
      // environment -- "wasm" in a browser, "cpu" under Node -- so naming one breaks the
      // other. Omitting it lets the library pick the right default for wherever it is.
      const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
      const opts = { progress_callback: onProgress as never };
      if (!hasWebGPU) return await pipeline("feature-extraction", MODEL, opts);
      try {
        return await pipeline("feature-extraction", MODEL, { ...opts, device: "webgpu" });
      } catch (e) {
        // An adapter can exist and still fail to initialise. Falling back beats a blank
        // page, but say which path ran so a slow session is explicable.
        console.warn("[skill-radar] WebGPU failed, falling back to the default backend:", e);
        return await pipeline("feature-extraction", MODEL, opts);
      }
    })();
  }
  return extractor;
}

export function backendInUse(): "webgpu" | "wasm" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  return "gpu" in navigator ? "webgpu" : "wasm";
}

/** Stable key for a piece of text, so a reload does not re-embed unchanged skills. */
export async function hash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const DB = "skill-radar";
const STORE = "vectors";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cached(key: string): Promise<Float32Array | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Float32Array) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    // Private windows and blocked site data both throw here. A cache miss is the correct
    // degradation; it costs a re-embed and nothing else.
    return null;
  }
}

async function store(key: string, vec: Float32Array): Promise<void> {
  try {
    const db = await open();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(vec, key);
  } catch { /* caching is best-effort */ }
}

/** Embed one string, using the cache when the exact text has been seen before. */
export async function embed(text: string, useCache = true): Promise<Float32Array> {
  const key = useCache ? `${MODEL}:${await hash(text)}` : "";
  if (useCache) {
    const hit = await cached(key);
    if (hit) return hit;
  }
  const pipe = await loadModel();
  const out = await pipe(text, { pooling: "mean", normalize: true });
  const vec = Float32Array.from(out.data as Iterable<number>);
  if (useCache) await store(key, vec);
  return vec;
}

/** Token count from the model's own tokenizer, not an estimate. */
export async function countTokens(text: string): Promise<number> {
  const pipe = await loadModel();
  const enc = pipe.tokenizer(text, { add_special_tokens: true });
  return (enc.input_ids.dims?.[1] as number) ?? 0;
}
