// [20260912_Feat_265_LocalChannel] Public surface of the local channel
// module (ticket #265, spec #258). main.ts needs only startLocalChannel;
// the CLI/MCP bridge (ticket #267) adds createChannelClient +
// resolveChannelEndpoint + generateChannelToken. Everything here is
// Electron-free (node builtins only) so tests and CLI run headless.

export { createChannelServer, startLocalChannel } from "./server";
export type {
  ChannelServerOptions,
  ChannelServices,
  LocalChannelHandle,
  LocalChannelServer,
  LocalChannelServiceDeps,
  StartLocalChannelInput,
} from "./server";
export { createChannelClient } from "./client";
export type { ChannelClient, ChannelClientOptions } from "./client";
export {
  generateChannelToken,
  resolveChannelEndpoint,
  writeChannelTokenFile,
} from "./endpoint";
export {
  HANDSHAKE_TIMEOUT_MS,
  MAX_CONNECTIONS,
  METHOD_HISTORY_DELETE,
  METHOD_POLISH,
  SESSION_IDLE_TTL_MS,
  SOCKET_FILE_NAME,
  TOKEN_FILE_NAME,
  createFrameSplitter,
  encodeFrame,
} from "./protocol";
