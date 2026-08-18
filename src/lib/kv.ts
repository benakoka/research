import fs from "node:fs";
import path from "node:path";

/**
 * Thin persistence layer. In production (Vercel) this reads/writes to Vercel KV
 * (Upstash Redis under the hood) via KV_REST_API_URL / KV_REST_API_TOKEN.
 *
 * In local dev, when those env vars aren't set, it falls back to a JSON file on
 * disk so `next dev` works out of the box without provisioning KV. Never used
 * in production — Vercel serverless functions don't share a writable, durable
 * filesystem across invocations, which is exactly why the real backend is KV.
 */

const hasRealKv =
  !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

const DATA_FILE = path.join(process.cwd(), ".data", "kv-store.json");

function readLocalStore(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeLocalStore(store: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store), "utf-8");
}

// Lazily import @vercel/kv only when actually configured, so local dev never
// needs real credentials in scope.
async function getRealKv() {
  const { kv } = await import("@vercel/kv");
  return kv;
}

export async function kvGet<T>(key: string): Promise<T | null> {
  if (hasRealKv) {
    const kv = await getRealKv();
    const val = await kv.get<T>(key);
    return val ?? null;
  }
  const store = readLocalStore();
  return (store[key] as T) ?? null;
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  if (hasRealKv) {
    const kv = await getRealKv();
    await kv.set(key, value as unknown as string);
    return;
  }
  const store = readLocalStore();
  store[key] = value;
  writeLocalStore(store);
}

export async function kvDel(key: string): Promise<void> {
  if (hasRealKv) {
    const kv = await getRealKv();
    await kv.del(key);
    return;
  }
  const store = readLocalStore();
  delete store[key];
  writeLocalStore(store);
}

/** List all keys with a given prefix (used for e.g. `run:attribution:*`). */
export async function kvKeysWithPrefix(prefix: string): Promise<string[]> {
  if (hasRealKv) {
    const kv = await getRealKv();
    const keys: string[] = [];
    let cursor = 0;
    do {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [next, batch] = (await (kv as any).scan(cursor, {
        match: `${prefix}*`,
        count: 200,
      })) as [number, string[]];
      keys.push(...batch);
      cursor = next;
    } while (cursor !== 0);
    return keys;
  }
  const store = readLocalStore();
  return Object.keys(store).filter((k) => k.startsWith(prefix));
}

/** Add an id to a simple index set (list of ids) stored under `indexKey`. */
export async function kvIndexAdd(indexKey: string, id: string): Promise<void> {
  const existing = (await kvGet<string[]>(indexKey)) ?? [];
  if (!existing.includes(id)) {
    existing.unshift(id); // newest first
    await kvSet(indexKey, existing);
  }
}

export async function kvIndexList(indexKey: string): Promise<string[]> {
  return (await kvGet<string[]>(indexKey)) ?? [];
}
