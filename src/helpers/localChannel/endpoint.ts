// [20260912_Feat_265_LocalChannel] Endpoint + token derivation for the
// local IPC channel (ticket #265, spec #258). Consistency contract with
// cli/lib/paths.mjs (ticket #264): the socket path and the token file live
// in the SAME userData the app uses — main.ts derives them from
// app.getPath("userData"), which is authoritative (see the dev-mode
// userData caveat recorded in cli/lib/paths.mjs). Windows uses a named
// pipe whose name carries a 128-bit random segment, per the PoC (P5): the
// random name prevents accidental connects but is NOT an access control —
// the first-frame token handshake is.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  FILE_MODE_OWNER_ONLY,
  PIPE_NAME_PREFIX,
  PIPE_NAME_RANDOM_BYTES,
  SOCKET_FILE_NAME,
  TOKEN_BYTES,
  TOKEN_FILE_NAME,
} from "./protocol";

/**
 * Resolve the channel endpoint for this launch.
 * - win32: `\\.\pipe\murmur-<128-bit random hex>` (per-launch random name)
 * - else:  `<userDataPath>/murmur-channel.sock`
 *
 * `platform` is injectable so tests on any OS can cover both shapes.
 */
export function resolveChannelEndpoint(
  userDataPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    return `\\\\.\\pipe\\${PIPE_NAME_PREFIX}${randomBytes(PIPE_NAME_RANDOM_BYTES).toString("hex")}`;
  }
  return path.join(userDataPath, SOCKET_FILE_NAME);
}

/** Generate the channel auth token: 32 random bytes, hex-encoded. */
export function generateChannelToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/**
 * Persist the token for local CLI/MCP clients, regenerated at every app
 * launch (ticket #265). Written with owner-only permissions; chmod after
 * the write so a file left by an earlier launch can never keep looser
 * perms (writeFileSync's mode only applies at creation). Returns the
 * token file path.
 */
export function writeChannelTokenFile(
  userDataPath: string,
  token: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const tokenPath = path.join(userDataPath, TOKEN_FILE_NAME);
  fs.writeFileSync(tokenPath, token, { mode: FILE_MODE_OWNER_ONLY });
  if (platform !== "win32") {
    fs.chmodSync(tokenPath, FILE_MODE_OWNER_ONLY);
  }
  return tokenPath;
}

// [20260912_Fix_265_ReviewHardening] Endpoint discovery contract (PoC):
// Windows pipe names are per-launch random and the namespace must not be
// enumerated (P1), so startLocalChannel persists the live endpoint here —
// same 0600-owner-only treatment as the token file; clients (#267) read it.
export const ENDPOINT_FILE_NAME = "murmur-channel-endpoint";

export function writeChannelEndpointFile(
  userDataPath: string,
  endpointPath: string,
  platform: string = process.platform,
): string {
  const endpointFilePath = path.join(userDataPath, ENDPOINT_FILE_NAME);
  fs.writeFileSync(endpointFilePath, `${endpointPath}\n`, {
    mode: FILE_MODE_OWNER_ONLY,
  });
  if (platform !== "win32") {
    // Umasks vary: chmod after write makes owner-only unconditional.
    fs.chmodSync(endpointFilePath, FILE_MODE_OWNER_ONLY);
  }
  return endpointFilePath;
}

export function removeChannelEndpointFile(
  userDataPath: string,
  platform: string = process.platform,
): void {
  if (platform === "win32") return;
  try {
    fs.rmSync(path.join(userDataPath, ENDPOINT_FILE_NAME), { force: true });
  } catch {
    // Best-effort cleanup; a leftover endpoint file fails the client's
    // connect probe, which is the same path as "app not running".
  }
}
