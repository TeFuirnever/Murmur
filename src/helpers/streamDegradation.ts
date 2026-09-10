// [20260910_Feat_237_StreamDegradation] Spec #193 T10 (ticket #237):
// stream-degradation memory. When a gateway fails a STREAMING polish
// request with a non-SSE content-type or an immediate 4xx, the fallback
// (a single non-streaming retry) succeeding means "this gateway cannot
// stream" — that fact is remembered under a NORMALIZED base_url hash so
// later runs skip the doomed streaming attempt entirely.
//
// Storage decision (ticket constraint #3): the existing settings table
// holds one `stream_degraded.<sha256-16>` key per gateway — no schema
// migration, enumeration via getAllSettings, eviction by the stored `at`
// timestamp. The hash bounds the key length regardless of how long the
// configured base_url grows; the entry count is hard-capped so the table
// cannot bloat.
//
// Local gateways are NEVER remembered: their streaming quirks are ours to
// fix, not to bypass permanently.
import crypto from "crypto";

export const STREAM_DEGRADATION_MAX_ENTRIES = 50;
const KEY_PREFIX = "stream_degraded.";
const KEY_HASH_HEX_CHARS = 16;

export interface StreamDegradationEntry {
  baseUrl: string;
  at: number;
}

/** Minimal settings-store seam — satisfied by DatabaseManager and mocks. */
export interface StreamDegradationStore {
  getSetting(key: string, defaultValue?: unknown): unknown | Promise<unknown>;
  // Optional so partial test doubles keep compiling: a store without write
  // capability simply cannot remember, and without enumeration it cannot
  // list, evict, or reset (those degrade to no-ops/empty).
  setSetting?(key: string, value: unknown): unknown | Promise<unknown>;
  getAllSettings?(): Record<string, unknown> | Promise<Record<string, unknown>>;
  deleteSetting?(key: string): unknown | Promise<unknown>;
}

/** Lowercase origin + path with trailing slashes stripped; null if invalid. */
export function normalizeDegradationBaseUrl(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    return `${url.origin.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function degradationKey(normalizedBaseUrl: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(normalizedBaseUrl)
    .digest("hex")
    .slice(0, KEY_HASH_HEX_CHARS);
  return `${KEY_PREFIX}${hash}`;
}

/**
 * Conservative loopback check for the memory-write gate. Kept local to
 * this module (rather than importing aiHandlers' SSRF predicates) to keep
 * the dependency one-directional: aiHandlers imports THIS module.
 */
export function isLocalDegradationBaseUrl(baseUrl: string): boolean {
  try {
    let host = new URL(baseUrl).hostname.toLowerCase();
    // URL keeps the brackets on IPv6 literals.
    if (host.startsWith("[") && host.endsWith("]")) {
      host = host.slice(1, -1);
    }
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (host === "0.0.0.0" || host === "::" || host === "::1") return true;
    if (/^127\./.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

function parseEntry(value: unknown): StreamDegradationEntry | null {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StreamDegradationEntry).baseUrl === "string" &&
    typeof (value as StreamDegradationEntry).at === "number"
  ) {
    return value as StreamDegradationEntry;
  }
  return null;
}

async function readEntries(
  store: StreamDegradationStore,
): Promise<Array<{ key: string; entry: StreamDegradationEntry }>> {
  if (!store.getAllSettings) return [];
  const all = await store.getAllSettings();
  const entries: Array<{ key: string; entry: StreamDegradationEntry }> = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    const entry = parseEntry(value);
    if (entry) entries.push({ key, entry });
  }
  return entries;
}

async function removeKey(
  store: StreamDegradationStore,
  key: string,
): Promise<void> {
  if (store.deleteSetting) {
    await store.deleteSetting(key);
  } else if (store.setSetting) {
    // Stores without a delete primitive tombstone the key; readEntries
    // filters the null out, and a later remember overwrites it.
    await store.setSetting(key, null);
  }
}

export async function isStreamDegradationRemembered(
  store: StreamDegradationStore,
  baseUrl: string,
): Promise<boolean> {
  const normalized = normalizeDegradationBaseUrl(baseUrl);
  if (!normalized) return false;
  const value = await store.getSetting(degradationKey(normalized), null);
  return parseEntry(value) !== null;
}

/**
 * Remember a gateway as stream-incapable. Returns false (and writes
 * nothing) for local addresses and unparseable base_urls. Re-remembering
 * refreshes the timestamp. Beyond the cap, the OLDEST entries are evicted.
 */
export async function rememberStreamDegradation(
  store: StreamDegradationStore,
  baseUrl: string,
  at: number = Date.now(),
): Promise<boolean> {
  const normalized = normalizeDegradationBaseUrl(baseUrl);
  if (!normalized || isLocalDegradationBaseUrl(baseUrl)) return false;
  if (!store.setSetting) return false;
  await store.setSetting(degradationKey(normalized), {
    baseUrl: normalized,
    at,
  });

  const entries = await readEntries(store);
  if (entries.length > STREAM_DEGRADATION_MAX_ENTRIES) {
    entries.sort((a, b) => a.entry.at - b.entry.at);
    const evictCount = entries.length - STREAM_DEGRADATION_MAX_ENTRIES;
    for (const { key } of entries.slice(0, evictCount)) {
      await removeKey(store, key);
    }
  }
  return true;
}

/** Newest first. */
export async function listStreamDegradations(
  store: StreamDegradationStore,
): Promise<StreamDegradationEntry[]> {
  const entries = await readEntries(store);
  return entries
    .sort((a, b) => b.entry.at - a.entry.at)
    .map(({ entry }) => entry);
}

/** Remove every remembered gateway; returns how many were removed. */
export async function resetStreamDegradations(
  store: StreamDegradationStore,
): Promise<number> {
  const entries = await readEntries(store);
  for (const { key } of entries) {
    await removeKey(store, key);
  }
  return entries.length;
}
// [20260910_Feat_237_StreamDegradation] END
