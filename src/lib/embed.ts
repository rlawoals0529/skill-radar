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
export type Backend = "webgpu" | "wasm" | "unknown";

let extractor: Promise<FeatureExtractionPipeline> | null = null;

/**
 * The device the load actually ended up on, not the one we hoped for.
 *
 * `navigator.gpu` existing is not the same as an adapter being obtainable: a machine can
 * advertise WebGPU and still fail to initialise one. Reporting the capability check would
 * tell the reader "webgpu" through an entire run that was really on wasm.
 */
let device: Backend = "unknown";

/**
 * Whether WebGPU will actually work, asked of the adapter rather than of the namespace.
 *
 * This has to be settled BEFORE the model is built, not caught afterwards. Transformers.js
 * caches a model by id, so a failed webgpu build poisons that entry and a second call asking
 * for wasm fails with the first call's webgpu error. Probing first means only one pipeline is
 * ever constructed, on a device already known to work.
 */
async function webgpuUsable(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

/** Loads on first call and never twice. WebGPU where available, WASM otherwise. */
export function loadModel(onProgress?: (p: Progress) => void): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    extractor = (async () => {
      device = (await webgpuUsable()) ? "webgpu" : "wasm";
      const opts = { progress_callback: onProgress as never };
      // The non-GPU device must be NAMED, and which name is valid differs by environment.
      // In a browser transformers.js defaults to webgpu and does not fall back on its own,
      // so omitting this is what produced "no available backend found"; under Node there is
      // no wasm provider at all, so there the library's own default is the right one.
      const wasm = typeof window === "undefined" ? opts : { ...opts, device: "wasm" as const };
      return await pipeline(
        "feature-extraction",
        MODEL,
        device === "webgpu" ? { ...opts, device: "webgpu" as const } : wasm,
      );
    })();
    // A rejected promise left in the slot would make every later attempt fail with the
    // first attempt's error, so a retry after a dropped connection could never succeed.
    extractor.catch(() => {
      extractor = null;
      device = "unknown";
    });
  }
  return extractor;
}

/** "unknown" until the model has loaded, because until then nothing has been tried. */
export function backendInUse(): Backend {
  return device;
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
