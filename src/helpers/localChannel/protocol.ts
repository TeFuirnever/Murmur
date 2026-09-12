// [20260912_Feat_265_LocalChannel] Protocol types, wire constants and
// newline-delimited JSON framing for the local IPC channel (ticket #265,
// spec #258). Transport-agnostic: the same framing runs over a Unix domain
// socket (macOS/Linux) and a Windows named pipe, per the named-pipe PoC
// (docs/research/2026-09-12-windows-named-pipe-poc.md). RED LINE carried
// over from the PoC: the server emits ZERO business frames before the
// client's first token frame is validated — the only pre-handshake output
// allowed is a rejection frame ({error: ...}).

/** Time a client has to deliver a valid token frame before its connection is destroyed. */
export const HANDSHAKE_TIMEOUT_MS = 5000;

/** Idle time (no frames received) before an authenticated session is destroyed. */
export const SESSION_IDLE_TTL_MS = 10 * 60 * 1000;

// [20260912_Fix_265_ReviewHardening] Frame length bound. The PoC proved any
// local process can connect pre-auth on win32 (P2), so an unbounded
// no-newline stream would be a pre-auth memory bomb; PoC phase 1 accepted
// connection-count DoS as the bound — this closes the buffer-growth half.
// 1 MiB is far above any legitimate frame (transcription results are plain
// text; chunked long-text polish never ships a single >1 MiB frame).
export const MAX_FRAME_BYTES = 1024 * 1024;

/** Raised by the frame splitter when a peer exceeds MAX_FRAME_BYTES. */
export class FrameOverflowError extends Error {
  constructor() {
    super("frame exceeds the protocol size limit");
    this.name = "FrameOverflowError";
  }
}

/** Maximum concurrent channel connections; excess connections are rejected. */
export const MAX_CONNECTIONS = 8;

/** Channel token entropy: 32 random bytes, hex-encoded (PoC P4 shape). */
export const TOKEN_BYTES = 32;

/** Token file name under userData; contents are the hex token itself. */
export const TOKEN_FILE_NAME = "murmur-channel-token";

/** Unix domain socket file name under userData. */
export const SOCKET_FILE_NAME = "murmur-channel.sock";

/** Named-pipe name prefix; the full name is \\.\pipe\murmur-<128-bit hex>. */
export const PIPE_NAME_PREFIX = "murmur-";

/** Random bytes in the Windows pipe name (128-bit, PoC P5 anti-collision). */
export const PIPE_NAME_RANDOM_BYTES = 16;

/** Owner-only file permission bits for the token file and the unix socket. */
export const FILE_MODE_OWNER_ONLY = 0o600;

/** Timeout for the stale-socket probe-connect during the unix self-heal. */
export const STALE_SOCKET_PROBE_TIMEOUT_MS = 1000;

/** Default client-side connect+handshake timeout. */
export const CHANNEL_CONNECT_TIMEOUT_MS = 5000;

/** Client-side rejection for requests issued on a non-connected client. */
export const ERR_NOT_CONNECTED = "local-channel-not-connected";

/** The two endpoints the channel exposes. */
export const METHOD_TRANSCRIBE_FILE = "transcribe_file";
export const METHOD_STATUS = "status";

/** Mandatory first frame from the client. */
export interface TokenFrame {
  token: string;
}

/** Server handshake success reply. */
export interface AcceptedFrame {
  accepted: true;
}

/** Server rejection frame (handshake failure or connection-cap rejection). */
export interface ErrorFrame {
  error: string;
}

/** Post-handshake request from the client. */
export interface RequestFrame {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/** Post-handshake server frames, correlated by the request id. */
export interface ResultFrame {
  id: string;
  result: unknown;
}
export interface ProgressFrame {
  id: string;
  progress: unknown;
}
export interface RequestErrorFrame {
  id: string;
  error: string;
}

/** Every frame the server may write. */
export type ServerFrame =
  | AcceptedFrame
  | ErrorFrame
  | ResultFrame
  | ProgressFrame
  | RequestErrorFrame;

/** Serialize a frame onto the wire (newline-delimited JSON). */
export function encodeFrame(
  frame: ServerFrame | TokenFrame | RequestFrame,
): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * Incremental newline-frame splitter shared by server and client. Feeding
 * each received chunk returns the complete frames accumulated so far;
 * partial frames stay buffered until their newline arrives.
 */
export function createFrameSplitter(
  maxBytes: number = MAX_FRAME_BYTES,
): (chunk: string) => string[] {
  let buffer = "";
  return (chunk: string): string[] => {
    buffer += chunk;
    if (buffer.length > maxBytes) {
      // Checked on the ACCUMULATED buffer: a dribbled no-newline stream is
      // bounded just like a single oversized segment.
      throw new FrameOverflowError();
    }
    const frames: string[] = [];
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      frames.push(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
    return frames;
  };
}
