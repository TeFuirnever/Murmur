// [20260912_Feat_265_LocalChannel] Transport-agnostic local channel server
// (ticket #265, spec #258). One module serves both transports: a Unix
// domain socket (macOS/Linux, 0600) and a Windows named pipe with a
// 128-bit random per-launch name — the compensating-control combination
// proven by the named-pipe PoC (docs/research/2026-09-12-windows-named-
// pipe-poc.md): first-frame token handshake, random pipe name, short
// session TTL, destroy on any handshake failure, connection cap.
// RED LINE (PoC P2/P4): the server emits ZERO business frames before the
// token is validated — the only pre-handshake output allowed is a
// rejection frame. The module is constructible WITHOUT Electron: every
// collaborator (services, token, endpoint path, logger, tunables) is
// injected; main.ts wires it through the thin startLocalChannel() below.

import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { StringDecoder } from "node:string_decoder";
import { validateAudioPath } from "../audioPathValidator";
import {
  checkEngineStatusService,
  transcribeFileService,
  type Logger,
} from "../services/transcriptionService";
import {
  FILE_MODE_OWNER_ONLY,
  HANDSHAKE_TIMEOUT_MS,
  MAX_CONNECTIONS,
  METHOD_STATUS,
  METHOD_TRANSCRIBE_FILE,
  SESSION_IDLE_TTL_MS,
  STALE_SOCKET_PROBE_TIMEOUT_MS,
  createFrameSplitter,
  encodeFrame,
  FrameOverflowError,
} from "./protocol";
import type {
  AcceptedFrame,
  ProgressFrame,
  RequestErrorFrame,
  RequestFrame,
  ResultFrame,
  ServerFrame,
} from "./protocol";
import {
  generateChannelToken,
  resolveChannelEndpoint,
  writeChannelTokenFile,
  writeChannelEndpointFile,
  removeChannelEndpointFile,
} from "./endpoint";

/** Endpoint implementations the channel exposes (injected for tests). */
export interface ChannelServices {
  transcribeFile(
    audioPath: string,
    options: Record<string, unknown>,
    onProgress?: (progress: unknown) => void,
  ): Promise<unknown>;
  checkEngineStatus(): Promise<unknown>;
}

export interface ChannelServerOptions {
  /** Unix socket path or Windows pipe name (see resolveChannelEndpoint). */
  endpointPath: string;
  /** Per-launch hex token; compared timing-safe against the client's first frame. */
  token: string;
  services: ChannelServices;
  logger: Logger;
  /** Injectable for tests; defaults to the real platform. */
  platform?: NodeJS.Platform;
  handshakeTimeoutMs?: number;
  sessionIdleTtlMs?: number;
  maxConnections?: number;
}

export interface LocalChannelServer {
  readonly endpointPath: string;
  /** Bind + listen. Rejects when a live instance already owns the endpoint. */
  listen(): Promise<void>;
  /** Destroy all sessions, close the listener, remove the unix socket file. */
  stop(): Promise<void>;
}

/** One connected client and its per-connection protocol state. */
interface ChannelSession {
  socket: net.Socket;
  authenticated: boolean;
  split: (chunk: string) => string[];
  decoder: StringDecoder;
  handshakeTimer: NodeJS.Timeout | null;
  idleTimer: NodeJS.Timeout | null;
  inFlight: number;
}

/**
 * Probe-connect the endpoint as a plain client: a successful connect means
 * a live instance owns it; a failure/timeout means the file is stale.
 */
function probeEndpointLive(endpointPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.connect(endpointPath);
    let settled = false;
    const settle = (live: boolean): void => {
      if (settled) return;
      settled = true;
      probe.destroy();
      resolve(live);
    };
    const timer = setTimeout(
      () => settle(false),
      STALE_SOCKET_PROBE_TIMEOUT_MS,
    );
    timer.unref();
    probe.once("connect", () => {
      clearTimeout(timer);
      settle(true);
    });
    probe.once("error", () => {
      clearTimeout(timer);
      settle(false);
    });
  });
}

/** Narrow an unknown value to a plain object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class LocalChannelServerImpl implements LocalChannelServer {
  readonly endpointPath: string;

  private readonly token: string;
  private readonly services: ChannelServices;
  private readonly logger: Logger;
  private readonly platform: NodeJS.Platform;
  private readonly handshakeTimeoutMs: number;
  private readonly sessionIdleTtlMs: number;
  private readonly maxConnections: number;
  private readonly sessions = new Set<ChannelSession>();
  private server: net.Server | null = null;

  constructor(options: ChannelServerOptions) {
    this.endpointPath = options.endpointPath;
    this.token = options.token;
    this.services = options.services;
    this.logger = options.logger;
    this.platform = options.platform ?? process.platform;
    this.handshakeTimeoutMs =
      options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    this.sessionIdleTtlMs = options.sessionIdleTtlMs ?? SESSION_IDLE_TTL_MS;
    this.maxConnections = options.maxConnections ?? MAX_CONNECTIONS;
  }

  async listen(): Promise<void> {
    // [20260912_Feat_265_LocalChannel] Unix-only stale-socket self-heal
    // (ticket #265 point 4): a leftover socket file from a crashed previous
    // instance is probe-connected as a client; only a DEAD endpoint is
    // unlinked. A live instance answering the probe means another Murmur
    // owns the channel — log and refuse to bind (a second app instance
    // would already have exited via #260, so this is crash leftovers).
    if (this.platform !== "win32" && fs.existsSync(this.endpointPath)) {
      const live = await probeEndpointLive(this.endpointPath);
      if (live) {
        this.logger.warn?.(
          "本地通道端点已被其他运行中的实例占用，本实例不绑定通道",
          { endpointPath: this.endpointPath },
        );
        throw new Error("local-channel-endpoint-in-use");
      }
      this.logger.info?.("清理残留的本地通道套接字文件后重新绑定", {
        endpointPath: this.endpointPath,
      });
      fs.rmSync(this.endpointPath, { force: true });
    }

    await this.listenServer();

    // Owner-only socket file perms (unix). On Windows the endpoint is a
    // named pipe; its security is the token handshake per the PoC, not DACL.
    if (this.platform !== "win32") {
      fs.chmodSync(this.endpointPath, FILE_MODE_OWNER_ONLY);
    }
    this.logger.info?.("本地通道已监听", { endpointPath: this.endpointPath });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const session of this.sessions) {
      session.socket.destroy();
    }
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Explicit unlink covers corner cases where close() did not remove the
    // socket file (Node removes it on unix, but never relies on it here).
    if (this.platform !== "win32") {
      fs.rmSync(this.endpointPath, { force: true });
    }
    this.logger.info?.("本地通道已停止");
  }

  /** Unref'd timer helper: channel timers must never hold the app open. */
  private startTimer(fn: () => void, ms: number): NodeJS.Timeout {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return timer;
  }

  private listenServer(): Promise<void> {
    const server = net.createServer((socket) => this.onConnection(socket));
    this.server = server;
    // Persistent error listener: runtime errors (accept storms, ECONNRESET
    // on the listener) must not surface as uncaught exceptions.
    server.on("error", (err: Error) => {
      this.logger.error?.("本地通道服务器错误:", err);
    });
    return new Promise<void>((resolve, reject) => {
      const onceBindError = (err: Error): void => reject(err);
      server.once("error", onceBindError);
      server.listen(this.endpointPath, () => {
        server.removeListener("error", onceBindError);
        resolve();
      });
    });
  }

  private onConnection(socket: net.Socket): void {
    if (this.sessions.size >= this.maxConnections) {
      // PoC compensating control: deny-and-drop keeps local processes from
      // holding channel capacity. The rejection frame (like token-rejected)
      // leaks only "a Murmur channel exists" — no business data.
      this.writeFrame(socket, { error: "connection-limit-rejected" });
      socket.destroy();
      return;
    }
    const session: ChannelSession = {
      socket,
      authenticated: false,
      split: createFrameSplitter(),
      decoder: new StringDecoder("utf8"),
      handshakeTimer: null,
      idleTimer: null,
      // [20260912_Fix_265_ReviewHardening] Idle TTL must not fire mid-task:
      // a transcription longer than SESSION_IDLE_TTL_MS generates no inbound
      // frames, so in-flight requests suppress the timer until they settle.
      inFlight: 0,
    };
    this.sessions.add(session);
    session.handshakeTimer = this.startTimer(() => {
      this.logger.warn?.("本地通道握手超时，断开连接");
      socket.destroy();
    }, this.handshakeTimeoutMs);
    socket.on("data", (chunk: Buffer) => this.onData(session, chunk));
    socket.on("error", (err: Error) => {
      // Client disconnects mid-task surface here (ECONNRESET/EPIPE) —
      // handled, not swallowed; debug level because resets are routine.
      this.logger.debug?.("本地通道连接错误", err.message);
    });
    socket.on("close", () => this.removeSession(session));
  }

  private onData(session: ChannelSession, chunk: Buffer): void {
    // StringDecoder reassembles UTF-8 sequences split across TCP segments
    // (transcription results carry Chinese text).
    // [20260912_Fix_265_ReviewHardening] A peer exceeding MAX_FRAME_BYTES
    // (pre-auth reachable on win32 per PoC P2) is destroyed, not buffered.
    let frames: string[];
    try {
      frames = session.split(session.decoder.write(chunk));
    } catch (error) {
      if (error instanceof FrameOverflowError) {
        this.logger.warn?.("本地通道帧超限，断开连接");
        session.socket.destroy();
        return;
      }
      throw error;
    }
    for (const raw of frames) {
      if (!raw.trim()) continue;
      this.handleFrame(session, raw);
      if (session.socket.destroyed) return;
    }
  }

  private handleFrame(session: ChannelSession, raw: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      this.handleUnparsableFrame(session);
      return;
    }
    if (!session.authenticated) {
      this.handleHandshake(session, frame);
      return;
    }
    // [20260912_Fix_265_ReviewHardening] No arming here: handleRequest's
    // finally re-arms when in-flight work settles, so the idle timer can
    // never be armed with a request already counted as in flight.
    void this.handleRequest(session, frame);
  }

  /** Any unparsable or non-conforming first frame is an auth failure. */
  private handleUnparsableFrame(session: ChannelSession): void {
    if (!session.authenticated) {
      this.logger.warn?.("本地通道握手失败：首帧不是合法的 token 帧");
      this.writeFrame(session.socket, { error: "token-rejected" });
      session.socket.destroy();
      return;
    }
    this.logger.warn?.("本地通道收到无法解析的帧，断开连接");
    session.socket.destroy();
  }

  private handleHandshake(session: ChannelSession, frame: unknown): void {
    const token = isRecord(frame) ? frame.token : undefined;
    if (typeof token !== "string" || !this.tokenMatches(token)) {
      // PoC P4: wrong OR missing token → rejection frame + immediate destroy.
      this.logger.warn?.("本地通道握手失败：token 缺失或不匹配，断开连接");
      this.writeFrame(session.socket, { error: "token-rejected" });
      session.socket.destroy();
      return;
    }
    session.authenticated = true;
    if (session.handshakeTimer) {
      clearTimeout(session.handshakeTimer);
      session.handshakeTimer = null;
    }
    this.armIdleTimer(session);
    this.writeFrame(session.socket, { accepted: true } satisfies AcceptedFrame);
    this.logger.info?.("本地通道客户端握手成功");
  }

  /** Timing-safe comparison over fixed-length SHA-256 digests (no length leak). */
  private tokenMatches(candidate: string): boolean {
    const digest = (value: string): Buffer =>
      createHash("sha256").update(value).digest();
    return timingSafeEqual(digest(candidate), digest(this.token));
  }

  private armIdleTimer(session: ChannelSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    // [20260912_Fix_265_ReviewHardening] A request in flight suppresses the
    // idle timer entirely: progress frames go OUTBOUND and long transcriptions
    // go quiet on the wire, so "no inbound frames" no longer implies "idle".
    if (session.inFlight > 0) {
      session.idleTimer = null;
      return;
    }
    session.idleTimer = this.startTimer(() => {
      this.logger.info?.("本地通道会话空闲超时，断开连接");
      session.socket.destroy();
    }, this.sessionIdleTtlMs);
  }

  private removeSession(session: ChannelSession): void {
    if (session.handshakeTimer) clearTimeout(session.handshakeTimer);
    if (session.idleTimer) clearTimeout(session.idleTimer);
    this.sessions.delete(session);
  }

  private async handleRequest(
    session: ChannelSession,
    frame: unknown,
  ): Promise<void> {
    // [20260912_Fix_265_ReviewHardening] In-flight accounting brackets the
    // whole request so the idle TTL cannot fire mid-task; the timer re-arms
    // when the last request settles.
    session.inFlight += 1;
    // Clear the timer armed at handshake (or by the previous request's
    // settle) — in-flight work suppresses the idle TTL entirely.
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
    try {
      await this.dispatchRequest(session, frame);
    } finally {
      session.inFlight -= 1;
      if (session.inFlight === 0 && !session.socket.destroyed) {
        this.armIdleTimer(session);
      }
    }
  }

  private async dispatchRequest(
    session: ChannelSession,
    frame: unknown,
  ): Promise<void> {
    const request = isRecord(frame) ? (frame as Partial<RequestFrame>) : null;
    const socket = session.socket;
    if (!request || typeof request.id !== "string") {
      // No correlation id — the frame can never be answered; drop the client.
      socket.destroy();
      return;
    }
    const id = request.id;
    if (typeof request.method !== "string") {
      this.writeFrame(socket, { id, error: "invalid-frame" });
      return;
    }
    switch (request.method) {
      case METHOD_STATUS:
        await this.runRequest(socket, id, () =>
          this.services.checkEngineStatus(),
        );
        return;
      case METHOD_TRANSCRIBE_FILE: {
        const params = isRecord(request.params) ? request.params : {};
        const audioPath = params.audioPath;
        if (typeof audioPath !== "string") {
          this.writeFrame(socket, { id, error: "audioPath-required" });
          return;
        }
        // [20260912_Feat_265_LocalChannel] Channel-entry validation
        // (ticket #265 point 5): validateAudioPath FIRST — an invalid path
        // is answered with an error frame and the engine is never touched.
        const validation = validateAudioPath(audioPath);
        if (!validation.valid) {
          this.writeFrame(socket, { id, error: validation.error });
          return;
        }
        const options = isRecord(params.options) ? params.options : {};
        await this.runRequest(socket, id, () =>
          this.services.transcribeFile(audioPath, options, (progress) => {
            // Long tasks stream progress frames before the result frame.
            this.writeFrame(socket, { id, progress } satisfies ProgressFrame);
          }),
        );
        return;
      }
      default:
        this.writeFrame(socket, { id, error: "unknown-method" });
    }
  }

  private async runRequest(
    socket: net.Socket,
    id: string,
    run: () => Promise<unknown>,
  ): Promise<void> {
    try {
      const result = await run();
      this.writeFrame(socket, { id, result } satisfies ResultFrame);
    } catch (error) {
      this.logger.error?.("本地通道请求处理失败:", error);
      const message = error instanceof Error ? error.message : String(error);
      this.writeFrame(socket, {
        id,
        error: message,
      } satisfies RequestErrorFrame);
    }
  }

  /** Write a frame unless the peer already went away (mid-task disconnect). */
  private writeFrame(socket: net.Socket, frame: ServerFrame): void {
    if (socket.destroyed) return;
    socket.write(encodeFrame(frame));
  }
}

/** Build a channel server. Electron-free: everything is injected. */
export function createChannelServer(
  options: ChannelServerOptions,
): LocalChannelServer {
  return new LocalChannelServerImpl(options);
}

// [20260912_Feat_265_LocalChannel] --- main.ts wiring (thin) ---
// startLocalChannel is the ONLY function main.ts needs: generate the
// per-launch token, persist it 0600 for CLI/MCP clients, resolve the
// endpoint, bind (with unix stale-socket self-heal) and bind the real
// transcription services. Channel failure must never block app boot —
// the caller guards with try/catch.

/** Service collaborator bag: the manager slices the channel endpoints touch. */
export interface LocalChannelServiceDeps {
  funasrManager: {
    // Real FunASRManager.transcribeFile returns Promise<unknown> — the
    // transcription service reads the result through a structural view.
    transcribeFile(
      audioPath: string,
      options: Record<string, unknown>,
    ): Promise<unknown>;
    checkModelFiles(): Promise<unknown>;
  };
  databaseManager: {
    saveTranscription(data: Record<string, unknown>): {
      lastInsertRowid?: number | bigint | null;
      changes?: number | bigint;
    };
    // Synchronous settings read (hotword injection).
    getSetting(key: string, defaultValue?: unknown): unknown;
  };
  logger: Logger;
}

export interface StartLocalChannelInput {
  /**
   * Root for the socket + token files. The app passes
   * app.getPath("userData") — authoritative per cli/lib/paths.mjs.
   */
  userDataPath: string;
  serviceDeps: LocalChannelServiceDeps;
  logger: Logger;
  platform?: NodeJS.Platform;
}

export interface LocalChannelHandle {
  readonly endpointPath: string;
  readonly tokenPath: string;
  /** File persisting the endpoint name (Windows discovery contract, PoC). */
  readonly endpointFilePath: string;
  /** Release the endpoint and all connections (will-quit cleanup). */
  stop(): Promise<void>;
}

export async function startLocalChannel(
  input: StartLocalChannelInput,
): Promise<LocalChannelHandle> {
  const { userDataPath, serviceDeps, logger } = input;
  const platform = input.platform ?? process.platform;
  // Fresh token every launch (ticket #265): regenerate and overwrite the
  // 0600 token file local clients read.
  const token = generateChannelToken();
  const endpointPath = resolveChannelEndpoint(userDataPath, platform);
  // [20260912_Feat_265_LocalChannel] Boundary cast (established
  // ipc/index.ts TypeRelax pattern, no `any`): the transcription services
  // document richer result shapes than the real managers return, but only
  // read them through structural views. The bag above already mirrors the
  // real manager surface; this single cast adapts it to the services'
  // documented deps without touching the services themselves.
  const transcribeDeps = serviceDeps as unknown as Parameters<
    typeof transcribeFileService
  >[0];
  const statusDeps = serviceDeps as unknown as Parameters<
    typeof checkEngineStatusService
  >[0];
  const server = createChannelServer({
    endpointPath,
    token,
    logger,
    platform,
    services: {
      transcribeFile: (audioPath, options, onProgress) =>
        transcribeFileService(transcribeDeps, audioPath, options, onProgress),
      checkEngineStatus: () => checkEngineStatusService(statusDeps),
    },
  });
  // [20260912_Fix_265_ReviewHardening] Bind FIRST, then publish secrets:
  // if listen() fails (endpoint in use), no token file is written, so a
  // failed boot can never leave credentials that authenticate against a
  // channel that does not exist (fail-closed).
  await server.listen();
  const tokenPath = writeChannelTokenFile(userDataPath, token, platform);
  // Windows pipes are per-launch random names (PoC): persist the endpoint
  // so #267's CLI/MCP clients can discover it without enumeration (P1).
  const endpointFilePath = writeChannelEndpointFile(
    userDataPath,
    endpointPath,
    platform,
  );
  logger.info?.("本地 IPC 通道已启动", { endpointPath, tokenPath });
  return {
    endpointPath,
    tokenPath,
    endpointFilePath,
    stop: async () => {
      await server.stop();
      removeChannelEndpointFile(userDataPath, platform);
    },
  };
}
// [20260912_Feat_265_LocalChannel] END
