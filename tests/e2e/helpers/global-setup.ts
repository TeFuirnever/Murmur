// [20260724_TS_BigBang_TestFix] E2E tests run against the bundled app
// (dist-main/main.js), not source .ts/.js. This globalSetup builds the
// main + preload bundles once before all e2e suites run.
// [20260726_Tier43_E2EHelpers] Verified ESM — already used `import` and
// `export default` before the .js→.ts rename; no CJS to convert.
import { execSync } from "child_process";

export default async function globalSetup() {
  console.log(
    "[e2e global-setup] Building main + preload + renderer bundles...",
  );
  execSync("npm run build:main", { stdio: "inherit" });
  execSync("npm run build:preload", { stdio: "inherit" });
  execSync("npm run build:renderer", { stdio: "inherit" });
  console.log("[e2e global-setup] Bundles ready.");
}
// [20260724_TS_BigBang_TestFix] END
