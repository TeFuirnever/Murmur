// [20260912_Feat_272DistCli] Structural locks for ticket #272 (`murmur`
// command works out of the box on a machine without system Node). These are
// content/config assertions only — no packaging run, no process spawn:
//   - launcher shims exist, reference ELECTRON_RUN_AS_NODE and resolve the
//     Electron binary + CLI entry RELATIVE to their own location, and the
//     POSIX shim stays LF-only (a CRLF byte breaks exec on macOS)
//   - package.json build config wires the shims into the bundles
//     (extraFiles), restores the executable bit (afterPack) and hooks the
//     NSIS user-PATH include
//   - installer.nsh adds/removes resources\cli on the USER path via
//     [Environment]::SetEnvironmentVariable (broadcasts WM_SETTINGCHANGE),
//     never via raw registry writes
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");

const readRepoFile = (...segments: string[]): string =>
  fs.readFileSync(path.join(root, ...segments), "utf8");

describe("cli launcher shims (ticket #272)", () => {
  const shimPath = (...segments: string[]) => path.join(root, ...segments);

  it("ships both platform shims", () => {
    expect(fs.existsSync(shimPath("cli", "shims", "murmur.sh"))).toBe(true);
    expect(fs.existsSync(shimPath("cli", "shims", "murmur.cmd"))).toBe(true);
  });

  it("murmur.sh runs the CLI via ELECTRON_RUN_AS_NODE with relative resolution", () => {
    const shim = readRepoFile("cli", "shims", "murmur.sh");
    expect(shim.startsWith("#!")).toBe(true);
    expect(shim).toContain("ELECTRON_RUN_AS_NODE=1");
    // Entry is resolved relative to the shim, never from cwd or an
    // absolute install path.
    expect(shim).toContain("../murmur.mjs");
    // Binary is resolved inside the app bundle relative to the shim.
    expect(shim).toContain("../../../MacOS/");
    // Survives invocation through a symlink (Homebrew `binary` stanza).
    expect(shim).toContain("readlink");
    // Missing runtime is a loud error, not a silent fallback.
    expect(shim).toContain("exit 1");
  });

  it("murmur.sh has no CRLF bytes (would break exec on macOS)", () => {
    // Checked on every host (including Windows CI): a CRLF byte inside the
    // shebang line makes the kernel fail to find the interpreter.
    const raw = fs.readFileSync(shimPath("cli", "shims", "murmur.sh"));
    expect(raw.includes(13)).toBe(false); // 13 === "\r"
  });

  it(
    "murmur.sh carries the executable bit (POSIX hosts only)",
    { skip: process.platform === "win32" },
    () => {
      const mode = fs.statSync(shimPath("cli", "shims", "murmur.sh")).mode;
      expect(mode & 0o111).not.toBe(0);
    },
  );

  it("murmur.cmd runs the CLI via ELECTRON_RUN_AS_NODE with relative resolution", () => {
    const shim = readRepoFile("cli", "shims", "murmur.cmd");
    expect(shim).toContain("ELECTRON_RUN_AS_NODE=1");
    // Windows layout: shims -> cli -> resources -> install root.
    expect(shim).toContain("%~dp0..\\..\\..\\Murmur.exe");
    expect(shim).toContain("%~dp0..\\murmur.mjs");
    // Forwarding of the caller's arguments.
    expect(shim).toContain("%*");
    // Missing runtime is a loud error, not a silent fallback.
    expect(shim).toContain("exit /b 1");
  });
});

describe("packaging wiring for the CLI distribution (ticket #272)", () => {
  const pkg = JSON.parse(readRepoFile("package.json")) as {
    build: {
      afterPack?: string;
      extraFiles?: Array<{ from: string; to: string }>;
      nsis?: { include?: string };
    };
  };

  it("extraFiles copies the whole cli tree (shims included) into the resource dir", () => {
    const mapping = pkg.build.extraFiles?.find(
      (entry) => entry.from === "cli" && entry.to === "cli",
    );
    expect(mapping).toBeDefined();
  });

  it("extraFiles places a package.json beside the copied cli so --version resolves", () => {
    // cli/lib/version.mjs walks up from the CLI script dir to the nearest
    // package.json; the extraFiles copy lives outside the asar, so the
    // overlay is what makes `murmur --version` print the real version.
    const overlay = pkg.build.extraFiles?.find(
      (entry) =>
        entry.from === "package.json" && entry.to === "cli/package.json",
    );
    expect(overlay).toBeDefined();
  });

  it("afterPack hook restores the shim executable bit", () => {
    expect(pkg.build.afterPack).toBe("build/afterPack.js");
    const hook = readRepoFile("build", "afterPack.js");
    expect(hook).toContain("chmod");
    expect(hook).toContain("cli");
    expect(hook).toContain("shims");
  });

  it("nsis.include points at the custom installer script", () => {
    expect(pkg.build.nsis?.include).toBe("build/installer.nsh");
  });
});

describe("NSIS user-PATH integration (ticket #272)", () => {
  const nsh = readRepoFile("build", "installer.nsh");
  // Executable script lines only: `;` comment lines may legitimately name
  // the avoided mechanism in prose.
  const nshCode = nsh
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(";"))
    .join("\n");

  it("defines both install-time and uninstall-time macros", () => {
    expect(nsh).toContain("!macro customInstall");
    expect(nsh).toContain("!macro customUnInstall");
  });

  it("targets resources\\cli on the USER scope", () => {
    expect(nsh).toContain("resources\\cli");
    expect(nsh).toContain("'User'");
  });

  it("uses [Environment]::SetEnvironmentVariable (broadcasts WM_SETTINGCHANGE)", () => {
    expect(nshCode).toContain("[Environment]::SetEnvironmentVariable");
    // Mechanism lock: raw registry writes do NOT broadcast
    // WM_SETTINGCHANGE, so new shells would miss the change.
    expect(nshCode).not.toContain("WriteRegStr");
  });

  it("guards against duplicate PATH entries", () => {
    expect(nshCode).toContain("-notcontains");
  });
});

describe("distribution docs mention the CLI (ticket #272)", () => {
  it("homebrew cask links the packaged shim as the `murmur` binary", () => {
    const cask = readRepoFile("docs", "homebrew", "murmur.rb");
    expect(cask).toContain(
      'binary "#{appdir}/Murmur.app/Contents/Resources/cli/shims/murmur.sh"',
    );
    expect(cask).toContain('target: "murmur"');
  });

  it("winget manifest notes the bundled CLI on PATH", () => {
    const manifest = readRepoFile("docs", "winget", "Murmur.yaml");
    expect(manifest).toContain("murmur");
    expect(manifest.toLowerCase()).toContain("path");
  });
});
