// [20261006_T12_LegacyCacheCleanup] Ticket #425 (spec #412 decision 11 /
// user story 19): N+1 releases reclaim the old fp32 torch model caches one
// version cycle after the ONNX cutover shipped them as the rollback path.
//
// Safety contract (the reason this module exists):
//   * The deletion manifest comes from a HISTORICAL LAYOUT PARSER that
//     covers every on-disk generation the app ever downloaded into — the
//     #216-era damo layers ("damo", "hub/damo"), the modelscope >=1.19
//     `models` layer, the modelscope 1.39 hub shape
//     `damo--<repo>/snapshots/<rev>` (#336), the explicit <userData>/models
//     damo root the server is started with, and their $MODELSCOPE_CACHE
//     variants. The root set mirrors funasr_server.py's authoritative
//     resolvers (_default_damo_root / _hub_models_roots) and is kept a
//     SUPERSET of them by tests/unit/legacyModelCleanup.test.ts.
//   * Only EXACT Murmur repo directory names ever enter the manifest. The
//     modelscope cache is shared with other tools — sibling model dirs of
//     any other name must survive untouched, and a repo entry that happens
//     to be a symlink (the documented #336 workaround) is unlinked WITHOUT
//     following it.
//   * Deletion is best-effort: per-entry failures are logged and reported,
//     never thrown — the cleanup must not affect app availability. Pure
//     Node (no electron imports) so the S2 seam can unit-test it with temp
//     dirs.
import fs from "fs";
import os from "os";
import path from "path";

/** Logger interface (accepts console or LogManager). */
interface Logger {
  info?(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

// Every torch-era repo directory Murmur ever materialized on disk. The ASR
// pair (SeACo primary + old paraformer rollback), VAD and punc mirror
// modelManager.modelConfigs; the CAM++ speaker repo mirrors funasr_server.py
// _load_cam_model's torch-era resolver. In the ONNX generation none of these
// can be loaded anymore (the embedded runtime ships funasr-onnx, no
// torch/funasr — prepare-embedded-python.js CRITICAL_DEPS), so they are pure
// disk weight once the new generation is confirmed ready. The list is locked
// against both sources by tests/unit/legacyModelCleanup.test.ts — a future
// rename must update all three places together.
export const LEGACY_TORCH_REPO_NAMES: readonly string[] = [
  "speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
  "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
  "speech_fsmn_vad_zh-cn-16k-common-pytorch",
  "punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
  "speech_campplus_sv_zh-cn_16k-common",
];

// The modelscope 1.39 hub shape prefixes the repo dir: damo--<repo>.
const HUB_REPO_PREFIX = "damo--";

/** How a repo dir sits inside its parent root. */
export type LegacyCacheRootStyle = "damo" | "hub";
/** "explicit" = the userData models root the server gets as --damo-root;
 * "cache" = a modelscope-managed cache layer. */
export type LegacyCacheRootOrigin = "explicit" | "cache";

export interface LegacyCacheRoot {
  path: string;
  style: LegacyCacheRootStyle;
  origin: LegacyCacheRootOrigin;
}

/** Which historical generation a manifest entry came from (for logs). */
export type LegacyLayoutKind =
  | "legacy-direct"
  | "legacy-damo-layer"
  | "hub-snapshots";

export interface LegacyCacheEntry {
  path: string;
  layout: LegacyLayoutKind;
}

export interface LegacyCleanupDeps {
  /** <userData>/models — the explicit --damo-root (modelManager's
   * getUserDataModelsRoot). */
  userDataModelsRoot?: string | null;
  /** $MODELSCOPE_CACHE, when the user configured a model download dir. */
  modelscopeCacheRoot?: string | null;
  /** Home directory (injectable for tests; defaults to os.homedir()). */
  homeDir?: string;
  logger?: Logger;
}

export interface LegacyCleanupSummary {
  deleted: { path: string; bytes: number }[];
  failed: { path: string; error: string }[];
}

// Damo-style layers relative to a modelscope cache base — mirrors
// funasr_server.py _default_damo_root's new_layers + legacy_layers. Applied
// to $MODELSCOPE_CACHE, the home legacy base (~/.cache/modelscope/hub) and,
// as a superset for the 1.39 no-hub default cache, the home cache itself.
const DAMO_CACHE_LAYERS: readonly string[] = [
  "models/damo",
  "hub/models/damo",
  "damo",
  "hub/damo",
];
// Hub-style roots relative to a modelscope cache base — mirrors
// funasr_server.py _hub_models_roots (1.39 drops the `hub` layer).
const HUB_CACHE_LAYERS: readonly string[] = ["models", "hub/models"];

/** Enumerate every candidate root that may hold one of Murmur's torch repo
 * dirs, across all historical layout generations. Pure (no fs access) —
 * existence is judged later, and the parity test pins the set against the
 * Python resolver source. */
export function enumerateLegacyTorchCacheRoots(deps: LegacyCleanupDeps = {}): {
  damoStyleRoots: LegacyCacheRoot[];
  hubStyleRoots: LegacyCacheRoot[];
} {
  const homeDir = deps.homeDir ?? os.homedir();
  const homeCache = path.join(homeDir, ".cache", "modelscope");
  const damoStyleRoots: LegacyCacheRoot[] = [];
  const hubStyleRoots: LegacyCacheRoot[] = [];
  // Per-list dedup (NOT shared): the explicit userData root legitimately
  // serves BOTH shapes — repos sit directly inside it (damo style) and
  // damo--<repo> dirs sit inside it (hub style).
  const seenDamo = new Set<string>();
  const seenHub = new Set<string>();
  const addRoot = (
    list: LegacyCacheRoot[],
    seen: Set<string>,
    rootPath: string,
    style: LegacyCacheRootStyle,
    origin: LegacyCacheRootOrigin,
  ) => {
    if (seen.has(rootPath)) return;
    seen.add(rootPath);
    list.push({ path: rootPath, style, origin });
  };

  // The explicit <userData>/models damo root: repos sit directly inside
  // (legacy direct shape), inside a `damo/` layer (findDamoRoot shape), or
  // as damo--<repo> hub dirs (--damo-root pointed at a modelscope root,
  // _resolve_repo_dir step 2).
  if (deps.userDataModelsRoot) {
    addRoot(
      damoStyleRoots,
      seenDamo,
      deps.userDataModelsRoot,
      "damo",
      "explicit",
    );
    addRoot(
      damoStyleRoots,
      seenDamo,
      path.join(deps.userDataModelsRoot, "damo"),
      "damo",
      "cache",
    );
    addRoot(hubStyleRoots, seenHub, deps.userDataModelsRoot, "hub", "explicit");
  }

  // $MODELSCOPE_CACHE variants — modelscope downloads INTO the env root.
  if (deps.modelscopeCacheRoot) {
    for (const layer of DAMO_CACHE_LAYERS) {
      addRoot(
        damoStyleRoots,
        seenDamo,
        path.join(deps.modelscopeCacheRoot, ...layer.split("/")),
        "damo",
        "cache",
      );
    }
    for (const layer of HUB_CACHE_LAYERS) {
      addRoot(
        hubStyleRoots,
        seenHub,
        path.join(deps.modelscopeCacheRoot, ...layer.split("/")),
        "hub",
        "cache",
      );
    }
  }

  // Home defaults: Python probes the legacy `hub`-layer base; the no-hub
  // base is included so the 1.39 default cache is fully covered (superset
  // of the Python probe set — safe because matching is exact-repo-name).
  const damoBases = [path.join(homeCache, "hub"), homeCache];
  for (const base of damoBases) {
    for (const layer of DAMO_CACHE_LAYERS) {
      addRoot(
        damoStyleRoots,
        seenDamo,
        path.join(base, ...layer.split("/")),
        "damo",
        "cache",
      );
    }
  }
  for (const layer of HUB_CACHE_LAYERS) {
    addRoot(
      hubStyleRoots,
      seenHub,
      path.join(homeCache, ...layer.split("/")),
      "hub",
      "cache",
    );
  }

  return { damoStyleRoots, hubStyleRoots };
}

/** Build the deletion manifest: every EXISTING directory (or symlink — the
 * #336 workaround linked the app root at a modelscope snapshot) whose name
 * is exactly one of Murmur's torch repo names, under any historical layout
 * root. Read-only; never throws. A plain FILE with a repo name is left
 * alone — it is not a shape the app ever created, so it is not ours to
 * judge. */
export function collectLegacyTorchCacheDirs(
  deps: LegacyCleanupDeps = {},
): LegacyCacheEntry[] {
  const { damoStyleRoots, hubStyleRoots } =
    enumerateLegacyTorchCacheRoots(deps);
  const entries: LegacyCacheEntry[] = [];
  const seen = new Set<string>();
  const consider = (candidate: string, layout: LegacyLayoutKind) => {
    if (seen.has(candidate)) return;
    seen.add(candidate);
    let stats: fs.Stats;
    try {
      // lstat (not stat): a symlink is a manifest entry by itself; its
      // target — possibly another tool's data — must never be followed.
      stats = fs.lstatSync(candidate);
    } catch {
      // Not present: nothing to reclaim at this candidate.
      return;
    }
    if (stats.isDirectory() || stats.isSymbolicLink()) {
      entries.push({ path: candidate, layout });
    }
  };
  for (const root of damoStyleRoots) {
    for (const repo of LEGACY_TORCH_REPO_NAMES) {
      consider(
        path.join(root.path, repo),
        root.origin === "explicit" ? "legacy-direct" : "legacy-damo-layer",
      );
    }
  }
  for (const root of hubStyleRoots) {
    for (const repo of LEGACY_TORCH_REPO_NAMES) {
      consider(
        path.join(root.path, `${HUB_REPO_PREFIX}${repo}`),
        "hub-snapshots",
      );
    }
  }
  return entries;
}

/** Recursive byte accounting for a DIRECTORY entry (top-level symlinks are
 * resolved by entryReclaimableBytes above — a plain readdirSync here would
 * walk through one). Child-level links are safe: each child is lstat'ed, so
 * a symlink child contributes its own size, never its target's (the target
 * may be shared with other tools). Never throws: unreadable entries are
 * skipped so one bad file cannot hide the size of the rest. */
function directorySizeBytes(dirPath: string): number {
  let total = 0;
  const walk = (current: string): void => {
    let dirEntries: fs.Dirent[];
    try {
      dirEntries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      // Unreadable dir: its contents stay uncounted; the deletion attempt
      // below still runs and reports the real outcome.
      return;
    }
    for (const dirEntry of dirEntries) {
      const child = path.join(current, dirEntry.name);
      try {
        const stats = fs.lstatSync(child);
        if (stats.isDirectory()) {
          walk(child);
        } else {
          total += stats.size;
        }
      } catch {
        // Unreadable entry: skip it, keep counting the rest.
      }
    }
  };
  walk(dirPath);
  return total;
}

/** Reclaimed-bytes probe for ONE manifest entry. A symlink entry
 * contributes only its own lstat size: directorySizeBytes() walks with
 * readdirSync, which follows a TOP-LEVEL symlink and would report the
 * TARGET's bytes (shared-cache data that is NOT reclaimed — possibly
 * another tool's model) in the deletion log. Review fix, T12. */
function entryReclaimableBytes(entryPath: string): number {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(entryPath);
  } catch {
    // Vanished between collect and size probe: nothing to account.
    return 0;
  }
  if (stats.isSymbolicLink()) return stats.size;
  return directorySizeBytes(entryPath);
}

/** Reclaim the old torch model caches: collect the manifest, delete each
 * entry, log what was deleted and how big it was. Per-entry failures are
 * logged and reported in the summary — never thrown, so the cleanup cannot
 * affect app availability. */
export async function cleanupLegacyTorchCaches(
  deps: LegacyCleanupDeps = {},
): Promise<LegacyCleanupSummary> {
  const logger = deps.logger;
  const entries = collectLegacyTorchCacheDirs(deps);
  const summary: LegacyCleanupSummary = { deleted: [], failed: [] };
  for (const entry of entries) {
    const bytes = entryReclaimableBytes(entry.path);
    try {
      // Async rm keeps the Electron main-process loop responsive while
      // multi-GB repo dirs are unlinked.
      await fs.promises.rm(entry.path, { recursive: true, force: true });
      summary.deleted.push({ path: entry.path, bytes });
      logger?.info?.(
        `旧torch模型缓存清理: 已删除 ${entry.path}（释放 ${bytes} 字节，布局 ${entry.layout}）`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.failed.push({ path: entry.path, error: message });
      logger?.warn?.(
        `旧torch模型缓存清理: 删除失败（不影响应用使用）: ${entry.path}`,
        message,
      );
    }
  }
  const totalBytes = summary.deleted.reduce((sum, d) => sum + d.bytes, 0);
  logger?.info?.(
    `旧torch模型缓存清理完成: 删除 ${summary.deleted.length} 个目录（共释放 ${totalBytes} 字节），失败 ${summary.failed.length} 个`,
  );
  return summary;
}
// [20261006_T12_LegacyCacheCleanup] END
