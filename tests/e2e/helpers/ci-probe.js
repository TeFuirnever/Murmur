// [20260725_E2E_CiStartupProbe] Loaded via Electron's --require flag
// BEFORE the main entry (dist-main/main.js). Confirms the Electron
// process is alive and executing JS at all. If this prints but main.ts
// canaries don't, the issue is in main.ts module-load.
//
// This file is plain CJS (no TypeScript, no esbuild) so it loads
// directly without any transform step.
console.error("[probe] ci-probe.js executed");
console.error("[probe] process.pid=" + process.pid);
console.error("[probe] process.versions.electron=" + process.versions.electron);
console.error("[probe] process.versions.node=" + process.versions.node);
console.error("[probe] process.cwd=" + process.cwd());
console.error("[probe] __dirname=" + __dirname);
try {
  console.error(
    "[probe] require.resolve electron: " + require.resolve("electron"),
  );
} catch (e) {
  console.error("[probe] require.resolve electron FAILED: " + (e && e.message));
}
// [20260725_E2E_CiStartupProbe] END
