// [20260912_Feat_265_LocalChannel] Channel client helper (ticket #265,
// spec #258). Speaks the same newline-delimited JSON protocol as the
// channel server; designed for reuse by the CLI/MCP bridge (ticket #267):
// connect() performs the mandatory first-frame token handshake, request()
// correlates responses by id and forwards progress frames to an optional
// callback. Pure node:net — runs headless in tests and under
// ELECTRON_RUN_AS_NODE (zero Electron imports).

import net from "node:net";
import { StringDecoder } from "node:string_decoder";
import {
  CHANNEL_CONNECT_TIMEOUT_MS,
  ERR_NOT_CONNECTED,
  createFrameSplitter,
  encodeFrame,
  FrameOverflowError,
} from "./protocol";
import type {
  AcceptedFrame,
  ErrorFrame,
  ProgressFrame,
  RequestErrorFrame,
  RequestFrame,
  ResultFrame,
} from "./protocol";
import type { TokenFrame } from "./protocol";

export interface ChannelClientOptions {
  /** Unix socket path or Windows pipe name (see resolveChannelEndpoint). */
  endpointPath: string;
  /** Hex token read from <userData>/murmur-channel-token. */
  token: string;
  connectTimeoutMs?: number;
}

export interface ChannelClient {
  /** Connect + token handshake. Rejects on refusal, timeout or rejection. */
  connect(): Promise<void>;
  /**
   * Send a request and await its result frame. Progress frames en route
   * are forwarded to `onProgress`. Rejects on an error frame or disconnect.
   */
  request(
    method: string,
    params?: Record<string, unknown>,
    onProgress?: (progress: unknown) => void,
  ): Promise<unknown>;
  /** Destroy the socket; pending requests reject with a closed error. */
  close(): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: unknown) => void;
}

/** Server frames the client can receive after the handshake settled. */
type InboundServerFrame = Partial<
  AcceptedFrame & ErrorFrame & ResultFrame & ProgressFrame & RequestErrorFrame
>;

export function createChannelClient(
  options: ChannelClientOptions,
): ChannelClient {
  const connectTimeoutMs =
    options.connectTimeoutMs ?? CHANNEL_CONNECT_TIMEOUT_MS;
  let socket: net.Socket | null = null;
  let split: ((chunk: string) => string[]) | null = null;
  let decoder: StringDecoder | null = null;
  let nextRequestId = 0;
  const pending = new Map<string, PendingRequest>();
  let handshakeWaiter: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;

  /** Reject everything outstanding (used on protocol errors/disconnects). */
  function failAll(message: string): void {
    const waiter = handshakeWaiter;
    handshakeWaiter = null;
    waiter?.reject(new Error(message));
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry.reject(new Error(message));
    }
  }

  function deliver(frame: unknown): void {
    const f = isRecord(frame) ? (frame as InboundServerFrame) : null;
    if (!f) {
      failAll("local-channel-malformed-frame");
      return;
    }
    // Id-less error frames are handshake-level rejections (token-rejected,
    // connection-limit-rejected) — fail the connect/handshake waiters.
    if (f.error !== undefined && f.id === undefined) {
      failAll(String(f.error));
      return;
    }
    if (handshakeWaiter) {
      if (f.accepted === true) {
        const waiter = handshakeWaiter;
        handshakeWaiter = null;
        waiter.resolve();
        return;
      }
      failAll("local-channel-unexpected-handshake-frame");
      return;
    }
    if (typeof f.id !== "string") return; // uncorrelated frame — ignore
    const entry = pending.get(f.id);
    if (!entry) return;
    if (f.progress !== undefined) {
      entry.onProgress?.(f.progress);
      return;
    }
    pending.delete(f.id);
    if (f.error !== undefined) {
      entry.reject(new Error(String(f.error)));
      return;
    }
    if ("result" in f) {
      entry.resolve(f.result);
      return;
    }
    entry.reject(new Error("local-channel-malformed-frame"));
  }

  function onChunk(chunk: Buffer): void {
    if (!split || !decoder) return;
    // StringDecoder reassembles UTF-8 sequences split across TCP segments
    // (results carry Chinese text).
    // [20260912_Fix_265_ReviewHardening] Frame-length bound (mirrors the
    // server): an overflowing peer destroys the connection and fails all
    // pending requests instead of growing the buffer.
    let frames: string[];
    try {
      frames = split(decoder.write(chunk));
    } catch (error) {
      if (error instanceof FrameOverflowError) {
        socket?.destroy();
        failAll("local-channel-frame-overflow");
        return;
      }
      throw error;
    }
    for (const raw of frames) {
      if (!raw.trim()) continue;
      let frame: unknown;
      try {
        frame = JSON.parse(raw);
      } catch {
        failAll("local-channel-malformed-frame");
        return;
      }
      deliver(frame);
    }
  }

  function onClose(): void {
    socket = null;
    split = null;
    decoder = null;
    failAll("local-channel-connection-closed");
  }

  function connect(): Promise<void> {
    if (socket) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const sock = net.connect(options.endpointPath);
      let connectTimer: NodeJS.Timeout | null = null;
      const settleConnect = (error?: Error): void => {
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }
        if (error) {
          sock.destroy();
          reject(error);
        } else {
          resolve();
        }
      };
      connectTimer = setTimeout(
        () => settleConnect(new Error("local-channel-connect-timeout")),
        connectTimeoutMs,
      );
      connectTimer.unref();

      sock.on("connect", () => {
        // Mandatory first frame: the token handshake (ticket #265).
        const tokenFrame: TokenFrame = { token: options.token };
        sock.write(encodeFrame(tokenFrame));
      });
      sock.on("data", onChunk);
      sock.on("error", (err: Error) => settleConnect(err));
      sock.on("close", () => {
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }
        onClose();
      });

      socket = sock;
      split = createFrameSplitter();
      decoder = new StringDecoder("utf8");
      handshakeWaiter = {
        resolve: () => settleConnect(),
        reject: (error: Error) => settleConnect(error),
      };
    });
  }

  function request(
    method: string,
    params: Record<string, unknown> = {},
    onProgress?: (progress: unknown) => void,
  ): Promise<unknown> {
    const sock = socket;
    if (!sock) {
      return Promise.reject(new Error(ERR_NOT_CONNECTED));
    }
    nextRequestId += 1;
    const id = `req-${nextRequestId}`;
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      const requestFrame: RequestFrame = { id, method, params };
      sock.write(encodeFrame(requestFrame));
    });
  }

  function close(): void {
    socket?.destroy();
    onClose();
  }

  return { connect, request, close };
}

/** Narrow an unknown parsed value to a plain object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
