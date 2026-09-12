// [20260912_Feat_271_McpInstall] Project-scope MCP client registration for
// `murmur mcp install` (ticket #271). Writes/merges the MCP client config
// files that register the Murmur MCP server (ticket #269's `murmur mcp`
// stdio server) for the three supported local clients:
//   - Claude Code: .mcp.json            under top-level key "mcpServers"
//   - Cursor:      .cursor/mcp.json     under top-level key "mcpServers"
//   - VS Code:     .vscode/mcp.json     under top-level key "servers"
//     (VS Code's documented difference — its project file uses "servers".)
// Contract: idempotent merge, never clobber. The existing file is parsed and
// only the "murmur" entry inside the client's server map is deep-merged;
// every other key/entry is preserved by value (plain JSON round-trip,
// 2-space indent like cli/lib/configStore.mjs). A config file that is not
// valid JSON (or whose server map is not a JSON object) raises
// McpInstallError and the file is left byte-for-byte untouched.
// All paths derive from the injected cwd — no real home-dir writes.
import fs from "node:fs";
import path from "node:path";

// Mirrors cli/lib/configStore.mjs (the repo's config writer).
const JSON_INDENT_SPACES = 2;

/** Server key this CLI owns inside every client's server map. */
export const MCP_SERVER_KEY = "murmur";

/** Args for the canonical server entry: `<command> mcp` (ticket #269). */
export const MCP_SERVER_ARGS = ["mcp"];

/** Default executable written into client configs (resolved on PATH post-#272). */
export const DEFAULT_MCP_COMMAND = "murmur";

/**
 * @typedef {object} McpClientTarget
 * @property {string} id `--client` value.
 * @property {string} label Human-readable client name (stdout lines).
 * @property {string} relativePath Config file path relative to the project
 *   root (forward slashes; joined with path.join so Windows gets "\").
 * @property {string} topLevelKey Server map key in this client's config.
 */

/** @type {McpClientTarget[]} */
export const MCP_CLIENT_TARGETS = [
  {
    id: "claude",
    label: "Claude Code",
    relativePath: ".mcp.json",
    topLevelKey: "mcpServers",
  },
  {
    id: "cursor",
    label: "Cursor",
    relativePath: ".cursor/mcp.json",
    topLevelKey: "mcpServers",
  },
  {
    id: "vscode",
    label: "VS Code",
    relativePath: ".vscode/mcp.json",
    topLevelKey: "servers",
  },
];

/**
 * @typedef {object} McpInstallClientResult
 * @property {string} client Target id.
 * @property {string} label Target label.
 * @property {string} path Absolute config file path.
 * @property {"created"|"updated"|"unchanged"|"failed"} status
 * @property {boolean} success
 * @property {string | null} error
 */

/**
 * Raised for config files this command must never overwrite: invalid JSON,
 * a non-object top level, or a non-object server map. The CLI maps this to
 * a per-client failure (runtime error) while leaving the file untouched.
 */
export class McpInstallError extends Error {}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural equality over JSON values (key order irrelevant). */
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) => key in b && deepEqual(a[key], b[key]))
    );
  }
  return false;
}

/**
 * Deep-merge `incoming` over `existing` (both JSON values). Objects merge
 * recursively (existing keys survive, incoming keys win); every other type
 * (arrays included) is replaced wholesale by the incoming value. Used ONLY
 * inside the "murmur" entry — foreign entries are never passed through here.
 */
function deepMergeEntry(existing, incoming) {
  if (!isPlainObject(existing) || !isPlainObject(incoming)) return incoming;
  const merged = { ...existing };
  for (const key of Object.keys(incoming)) {
    merged[key] = deepMergeEntry(existing[key], incoming[key]);
  }
  return merged;
}

/**
 * Install (create or merge) the Murmur server entry into one client's
 * project-scope config file. Never overwrites unparseable files — those
 * throw McpInstallError. When the resulting "murmur" entry already equals
 * the merged entry the file is not written at all, so an idempotent second
 * run preserves the original bytes exactly.
 *
 * @param {McpClientTarget} target Client to install into.
 * @param {object} options
 * @param {string} options.cwd Project root (the process's working directory
 *   in production; injected by tests so no real directories are touched).
 * @param {string} [options.command] Executable for the server entry
 *   (default DEFAULT_MCP_COMMAND; accepted verbatim).
 * @returns {McpInstallClientResult}
 */
export function installMcpEntry(target, options) {
  const command = options.command ?? DEFAULT_MCP_COMMAND;
  const configPath = path.join(options.cwd, target.relativePath);
  const canonicalEntry = { command, args: [...MCP_SERVER_ARGS] };
  const failurePath = configPath;

  const readExistingDocument = () => {
    if (!fs.existsSync(configPath)) return null;
    let raw;
    try {
      raw = fs.readFileSync(configPath, "utf-8");
    } catch (error) {
      throw new McpInstallError(
        `无法读取 ${failurePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new McpInstallError(
        `${failurePath} 不是有效的 JSON，已保留原文件未做修改`,
      );
    }
    if (!isPlainObject(parsed)) {
      throw new McpInstallError(
        `${failurePath} 的顶层必须是 JSON 对象，已保留原文件未做修改`,
      );
    }
    return parsed;
  };

  const existingDocument = readExistingDocument();
  const created = existingDocument === null;
  // Mutations happen only after every validation below has passed, so a
  // validation failure never reaches the write path.
  const document = existingDocument ?? {};
  const existingMap = document[target.topLevelKey];
  if (existingMap !== undefined && !isPlainObject(existingMap)) {
    throw new McpInstallError(
      `${failurePath} 中的 "${target.topLevelKey}" 不是 JSON 对象，已保留原文件未做修改`,
    );
  }
  const serverMap = existingMap ?? {};
  const existingEntry = serverMap[MCP_SERVER_KEY];
  const mergedEntry = deepMergeEntry(existingEntry, canonicalEntry);

  if (!created && deepEqual(existingEntry, mergedEntry)) {
    // Idempotent no-change: skip the write entirely so the file's original
    // bytes (formatting included) are preserved.
    return {
      client: target.id,
      label: target.label,
      path: configPath,
      status: "unchanged",
      success: true,
      error: null,
    };
  }

  serverMap[MCP_SERVER_KEY] = mergedEntry;
  document[target.topLevelKey] = serverMap;

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(document, null, JSON_INDENT_SPACES),
      "utf-8",
    );
  } catch (error) {
    throw new McpInstallError(
      `无法写入 ${failurePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    client: target.id,
    label: target.label,
    path: configPath,
    status: created ? "created" : "updated",
    success: true,
    error: null,
  };
}
