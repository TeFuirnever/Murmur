// [20260724_TS_Migration_Process] Migrated from .js to .ts as part
// of backend TypeScript migration (ADR-010). Utility module wrapping
// child_process.spawn with timeout support.
import { spawn } from "child_process";

/** Timeout configuration in milliseconds. */
const TIMEOUTS = {
  QUICK_CHECK: 5_000, // 5s — quick check
  PIP_UPGRADE: 60_000, // 1 min — pip upgrade
  INSTALL: 300_000, // 5 min — install packages
  DOWNLOAD: 600_000, // 10 min — download
} as const;

/** Options for runCommand. */
interface RunCommandOptions {
  timeout?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/** Result of a successful command execution. */
interface RunCommandResult {
  output: string;
  code: number;
}

/**
 * Run a command and return its output. Rejects on failure or timeout.
 */
function runCommand(
  command: string,
  args: string[] = [],
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  const { timeout = TIMEOUTS.QUICK_CHECK, cwd, env } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let isResolved = false;

    const timeoutId = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        child.kill("SIGTERM");
        reject(
          new Error(
            `Command timed out after ${timeout}ms: ${command} ${args.join(" ")}`,
          ),
        );
      }
    }, timeout);

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code: number | null) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeoutId);

      const output = stdout + stderr;

      if (code === 0) {
        resolve({ output, code: code ?? 0 });
      } else {
        reject(
          new Error(`Command failed with code ${code}: ${stderr || stdout}`),
        );
      }
    });

    child.on("error", (error: Error) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeoutId);
      reject(new Error(`Process error: ${error.message}`));
    });
  });
}

export { runCommand, TIMEOUTS };
export type { RunCommandOptions, RunCommandResult };
