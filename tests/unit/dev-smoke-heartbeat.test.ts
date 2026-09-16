// [20260906_Test_DevSmokeHeartbeat] Spec #266 T(#251): the local dev smoke
// must require a MAIN-process startup milestone, not just vite port
// reachability (a main crash after boot used to stay green). Text-level pin
// over scripts/ci-check.js + main.ts so the two sides cannot drift apart
// silently: the milestone string must exist in BOTH files.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");
const ciCheck = fs.readFileSync(
  path.join(root, "scripts", "ci-check.js"),
  "utf8",
);
const mainSrc = fs.readFileSync(path.join(root, "main.ts"), "utf8");

const MILESTONE = "phase=window-created";

describe("[20260906_Test_DevSmokeHeartbeat] dev smoke main heartbeat", () => {
  it("main.ts emits the window-created startup milestone", () => {
    expect(mainSrc).toContain(`[main:startup] ${MILESTONE}`);
  });

  it("dev smoke requires the main milestone before declaring ok", () => {
    expect(ciCheck).toContain(MILESTONE);
    // success is gated on both signals, not the port alone: the ok result
    // is nested behind `if (mainReady)` inside the port-ready branch
    expect(ciCheck).toContain("portReady = true");
    expect(ciCheck).toContain("mainReady = true");
    expect(ciCheck).toContain("if (mainReady)");
    // and the ok output itself records that the heartbeat was seen
    expect(ciCheck).toContain("window-created milestone");
  });

  it("reports the port-without-main failure shape distinctly", () => {
    expect(ciCheck).toContain("main process never reported");
  });
});
