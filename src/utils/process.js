// [20260724_TS_Migration_Process] Source of truth is now .ts.
// This .js file is kept for require() compatibility during the gradual
// backend TS migration (ADR-010). The .ts version provides full type safety.
const { spawn } = require("child_process");

const TIMEOUTS = {
  QUICK_CHECK: 5_000,
  PIP_UPGRADE: 60_000,
  INSTALL: 300_000,
  DOWNLOAD: 600_000,
};

function runCommand(command, args = [], options = {}) {
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

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeoutId);

      const output = stdout + stderr;

      if (code === 0) {
        resolve({ output, code });
      } else {
        reject(
          new Error(`Command failed with code ${code}: ${stderr || stdout}`),
        );
      }
    });

    child.on("error", (error) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeoutId);
      reject(new Error(`Process error: ${error.message}`));
    });
  });
}

module.exports = { runCommand, TIMEOUTS };
