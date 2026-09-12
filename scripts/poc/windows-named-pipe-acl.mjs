// [20260912_Poc_263_NamedPipeAcl] Ticket #263 (Spec #258 Phase 0 hard gate):
// first-hand probe of the Windows named pipe attack surface for Murmur's
// local IPC channel decision. Pure spike — no product code is imported or
// changed.
//
// What it measures, on a real Windows host (run from an unrelated client
// CHILD process, simulating another local program):
//   P1  Pipe enumeration: can an unrelated process list \\.\pipe\ and spot
//       our server pipe by prefix? (If YES, an "unguessable name" alone is
//       NOT a confidentiality control.)
//   P2  Unauthenticated read: can that process connect to the pipe and read
//       a frame WITHOUT any token handshake? (The default-DACL exposure.)
//   P3  ACL control surface: does Node's net.Server expose ANY API to
//       tighten the pipe DACL? (Expected: none — documented constraint.)
//   P4  App-layer compensating control: does a token handshake reject a
//       client that connects with a wrong/absent token, and admit the
//       tokened one? (The candidate mitigation, proven end-to-end.)
//   P5  Wrong-name reachability: connect attempts to a random 128-bit pipe
//       name unknown to the client fail by NOT_FOUND (baseline sanity).
//
// Cross-USER execution is NOT possible on a CI runner (single user) — that
// residual is explicitly recorded UNVERIFIED in the research doc; P1/P2 via
// a separate process still validates the mechanism, not just same-process
// loopbacks.
//
// Output: a single JSON verdict object on stdout (machine-readable) plus
// human-readable progress on stderr. Exit 0 always on Windows (verdicts
// carry the booleans); exit 2 on non-Windows hosts.
// [20260912_Poc_263_NamedPipeAcl] END
import net from "node:net";
import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const PIPE_NAMESPACE = "murmur-poc-";
const TOKEN_BYTES = 32;
const SERVER_START_TIMEOUT_MS = 5000;
const CLIENT_CONNECT_TIMEOUT_MS = 3000;
const CLIENT_PROCESS_TIMEOUT_MS = 20000;

function log(message) {
  process.stderr.write(`[poc] ${message}\n`);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]);
}

/** One frame = one newline-terminated JSON blob (Murmur's planned protocol). */
function sendFrame(socket, object) {
  socket.write(`${JSON.stringify(object)}\n`);
}

function readFrame(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex !== -1) {
        socket.off("data", onData);
        resolve(JSON.parse(buffer.slice(0, newlineIndex)));
      }
    };
    socket.on("data", onData);
    socket.on("error", reject);
  });
}

function connectPipe(pipeName) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipeName);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("connect timed out"));
    }, CLIENT_CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Runs in the CHILD (client) process. Receives the server pipe name ONLY
 * when probing P2/P4 (the server hands it over deliberately); for P1 the
 * child must FIND the pipe by enumerating the namespace with just the
 * prefix — that is the whole point of the probe.
 */
async function runClientChild(serializedTask) {
  const task = JSON.parse(serializedTask);
  const verdict = { role: "client", probes: {} };

  if (task.probe === "enumerate-and-read") {
    // P1: enumerate the pipe namespace with only the prefix.
    const allPipes = readdirSync("\\\\.\\pipe\\");
    const matches = allPipes.filter((name) => name.startsWith(PIPE_NAMESPACE));
    verdict.probes.enumeration = {
      totalPipeCount: allPipes.length,
      prefixMatches: matches.length,
      foundTarget: matches.includes(task.pipeName),
    };
    if (!verdict.probes.enumeration.foundTarget) {
      process.stdout.write(`${JSON.stringify(verdict)}\n`);
      return;
    }

    // P2: connect + read the greeting frame WITHOUT presenting any token.
    try {
      const socket = await connectPipe(task.pipeName);
      const greeting = await readFrame(socket);
      verdict.probes.unauthenticatedRead = {
        connected: true,
        greetingReceived: greeting.greeting ?? null,
        serverSideAuthenticated: false,
      };
      socket.destroy();
    } catch (err) {
      verdict.probes.unauthenticatedRead = {
        connected: false,
        error: String(err.message ?? err),
      };
    }
  }

  if (task.probe === "token-handshake") {
    // P4: connect and send a WRONG token first; expect rejection. The
    // server then allows a retry slot which we use WITHOUT a token (absent
    // token must also be rejected). The parent verifies the tokened path
    // separately from the server side.
    const attempt = async (token) => {
      try {
        const socket = await connectPipe(task.pipeName);
        sendFrame(socket, { token });
        const reply = await readFrame(socket);
        socket.destroy();
        return {
          rejected: reply.error ?? null,
          accepted: reply.accepted === true,
        };
      } catch (err) {
        return { connectOrReadError: String(err.message ?? err) };
      }
    };
    verdict.probes.wrongToken = await attempt("definitely-not-the-token");
    verdict.probes.absentToken = await attempt(null);
  }

  if (task.probe === "random-name-unreachable") {
    // P5 baseline: an unknown 128-bit name must simply not connect.
    try {
      const socket = await connectPipe(task.pipeName);
      socket.destroy();
      verdict.probes.randomName = { connected: true };
    } catch (err) {
      verdict.probes.randomName = {
        connected: false,
        code: err.code ?? String(err.message ?? err),
      };
    }
  }

  process.stdout.write(`${JSON.stringify(verdict)}\n`);
}

/**
 * Server side. Runs one probe session at a time so each child gets a
 * freshly named pipe and a clean token store.
 */
async function runServerProbe(probe) {
  const secretToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const randomSuffix = crypto.randomBytes(16).toString("hex");
  const pipeName = `\\\\.\\pipe\\${PIPE_NAMESPACE}${randomSuffix}`;
  const verdict = { probe, pipeNamePrefix: PIPE_NAMESPACE, probes: {} };

  if (probe === "random-name-unreachable") {
    // P5: serve NOTHING on the secret name; the child just tries to reach it.
    const child = spawnChild({ probe, pipeName });
    const result = await withTimeout(
      collectChild(child),
      CLIENT_PROCESS_TIMEOUT_MS,
      "client",
    );
    verdict.probes = result.probes;
    return verdict;
  }

  const connections = [];
  const server = net.createServer((socket) => {
    connections.push(socket);
    if (probe === "enumerate-and-read") {
      // P2: the server GREETES unauthenticated clients (worst case: a
      // chatty server that answers before any auth). If the child reads
      // this, unauthenticated read is proven.
      sendFrame(socket, { greeting: "unauthenticated-greeting" });
      return;
    }
    if (probe === "token-handshake") {
      // P4: app-layer auth — first frame must carry the exact token.
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) return;
        let frame;
        try {
          frame = JSON.parse(buffer.slice(0, newlineIndex));
        } catch {
          socket.destroy();
          return;
        }
        if (frame.token === secretToken) {
          sendFrame(socket, { accepted: true });
        } else {
          sendFrame(socket, { error: "token-rejected" });
          socket.end();
        }
      });
    }
  });

  await withTimeout(
    new Promise((resolve) => server.listen(pipeName, resolve)),
    SERVER_START_TIMEOUT_MS,
    "server listen",
  );
  log(`server listening on ${pipeName} (probe=${probe})`);

  try {
    if (probe === "enumerate-and-read") {
      const child = spawnChild({ probe, pipeName });
      const result = await withTimeout(
        collectChild(child),
        CLIENT_PROCESS_TIMEOUT_MS,
        "client",
      );
      verdict.probes = result.probes;
    }

    if (probe === "token-handshake") {
      const child = spawnChild({ probe, pipeName });
      const result = await withTimeout(
        collectChild(child),
        CLIENT_PROCESS_TIMEOUT_MS,
        "client",
      );
      verdict.probes = result.probes;
      // Server-side half of P4: the CORRECT token is admitted.
      const socket = await connectPipe(pipeName);
      sendFrame(socket, { token: secretToken });
      const reply = await readFrame(socket);
      socket.destroy();
      verdict.probes.correctTokenFromAnotherHandle = reply;
    }

    if (probe === "acl-surface") {
      // P3: enumerate the public API of a listening pipe server — the
      // documented constraint is that Node's net module has no ACL/DACL
      // control; verify no security-ish members exist on the server or its
      // handle-ish properties.
      const members = new Set();
      let current = server;
      while (current && current !== Object.prototype) {
        Object.getOwnPropertyNames(current).forEach((name) =>
          members.add(name),
        );
        current = Object.getPrototypeOf(current);
      }
      verdict.probes.aclSurface = {
        serverMembers: [...members].sort(),
        hasSecurityApi: [...members].some((name) =>
          /secur|dacl|acl|sid|priv/i.test(name),
        ),
        nodeVersion: process.versions.node,
      };
    }
  } finally {
    for (const socket of connections) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }

  return verdict;
}

function spawnChild(task) {
  const child = spawn(
    process.execPath,
    [process.argv[1], "--client", JSON.stringify(task)],
    {
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  log(`spawned client pid=${child.pid} probe=${task.probe}`);
  return child;
}

function collectChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.on("exit", () => {
      try {
        const jsonLine = stdout.trim().split("\n").at(-1);
        resolve(JSON.parse(jsonLine));
      } catch {
        reject(new Error(`client output unparsable: ${stdout.slice(0, 200)}`));
      }
    });
    child.on("error", reject);
  });
}

// ─── Entry ────────────────────────────────────────────────────────────────
const clientArgIndex = process.argv.indexOf("--client");
if (clientArgIndex !== -1) {
  await runClientChild(process.argv[clientArgIndex + 1]);
  process.exit(0);
}

if (process.platform !== "win32") {
  process.stderr.write(
    "[poc] Windows-only probe. On other hosts this script is a no-op (exit 2).\n",
  );
  process.exit(2);
}

const PROBES = [
  "acl-surface",
  "enumerate-and-read",
  "token-handshake",
  "random-name-unreachable",
];
const report = {
  script: "windows-named-pipe-acl.mjs",
  platform: process.platform,
  osRelease:
    process.platform === "win32"
      ? (process.env.OS ?? "Windows")
      : process.platform,
  nodeVersion: process.versions.node,
  probes: {},
};
for (const probe of PROBES) {
  log(`=== probe: ${probe} ===`);
  report.probes[probe] = await runServerProbe(probe);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
