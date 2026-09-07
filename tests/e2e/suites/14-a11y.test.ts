// [20260906_Test_AxeA11y] Spec #266 T14 (#291): behavioral accessibility
// gate. Runs axe-core against the REAL rendered main and settings windows
// and fails on critical/serious violations that are not on the explicit
// baseline. This replaces the phase5 source-regex approach (text assertions
// cannot see the real a11y tree) — phase5 retires in T19.
//
// Baseline policy: every accepted violation is pinned by rule id + target
// selector with a reason. New violations fail the suite; removing a fixed
// violation requires pruning the baseline consciously.
import { test, expect } from "@playwright/test";
import fs from "fs";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch";

const AXE_SOURCE = fs.readFileSync(
  require.resolve("axe-core/axe.min.js"),
  "utf8",
);

// Empty as of 2026-09-06: the first honest scan found 4 critical violations
// (2 unnamed icon buttons in the main title bar, unnamed selects + a nameless
// API-key visibility toggle in settings, role="tab" without a tablist) — all
// were FIXED rather than accepted. Keep this list empty; adding an entry
// requires a written reason and a tracking ticket.
const A11Y_BASELINE: string[] = [];

type AxeResult = {
  id: string;
  impact: string | null;
  nodes: { target: string[] }[];
};

// Injected from the MAIN process via webContents.executeJavaScript: that
// path carries devtools privileges and is not subject to the page CSP
// (script-src 'self' blocks any addScriptTag inline injection).
async function runAxe(
  app: import("@playwright/test").ElectronApplication,
  urlPart: string,
): Promise<AxeResult[]> {
  return app.evaluate(
    ({ BrowserWindow }, args) => {
      const target = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes(args.urlPart),
      );
      if (!target) throw new Error(`window not found: ${args.urlPart}`);
      return target.webContents.executeJavaScript(
        `${args.source}\n;axe.run(document, { resultTypes: ["violations"] }).then((r) => r.violations);`,
      ) as Promise<AxeResult[]>;
    },
    { source: AXE_SOURCE, urlPart },
  );
}

function unexpectedViolations(violations: AxeResult[]): string[] {
  const out: string[] = [];
  for (const violation of violations) {
    if (violation.impact !== "critical" && violation.impact !== "serious") {
      continue;
    }
    const firstTarget = violation.nodes[0]?.target?.[0] ?? "?";
    const key = `${violation.id} ${firstTarget}`;
    const accepted = A11Y_BASELINE.some(
      (entry) => key.startsWith(entry) || entry.startsWith(violation.id),
    );
    if (!accepted) {
      out.push(`${violation.impact}: ${key}`);
    }
  }
  return out;
}

test.describe("Suite 14: Accessibility (axe)", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("14.1 — main window has no unexpected critical/serious violations", async () => {
    const violations = await runAxe(electronApp, "index.html");
    expect(unexpectedViolations(violations)).toEqual([]);
  });

  test("14.2 — settings window has no unexpected critical/serious violations", async () => {
    await window.evaluate(() => window.electronAPI?.openSettingsWindow());
    let settingsWindow;
    for (let i = 0; i < 20 && !settingsWindow; i += 1) {
      settingsWindow = electronApp
        .windows()
        .find((w) => w.url().includes("settings.html"));
      if (!settingsWindow) await new Promise((r) => setTimeout(r, 250));
    }
    expect(settingsWindow).toBeDefined();

    const violations = await runAxe(electronApp, "settings.html");
    expect(unexpectedViolations(violations)).toEqual([]);
  });
});
