// [20260726_Tier3_AssertElectronApiMigrate] Migrated from .js to .ts as part
// of Tier 3 batch 3. Pattern: this test stubs `globalThis.window` and
// `globalThis.document` (node test env has neither). Strict tsc's Window type
// is incompatible with the empty-object stub, so cast through `unknown` to
// `Window & typeof globalThis` (the declared type of globalThis.window) —
// same pattern as usePermissions.test.ts. The electronAPI stub uses an
// arbitrary `{ foo }` shape that doesn't match the strict ElectronAPI
// contract, so it is cast through `unknown` as well. The `document.body`
// stub is cast to a minimal shape via a local TestDocument type so
// `.innerHTML =` writes type-check without a full DOM lib. No `any`.
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ElectronAPI } from "../../src/electronAPI";
import { assertElectronAPI } from "../../src/bootstrap/assertElectronAPI";

// [20260726_Tier3_AssertElectronApiMigrate] Test-window shape: production
// type makes `electronAPI` required, but this test deliberately deletes it,
// so Omit the required prop and re-add it as optional.
type TestWindow = Omit<Window, "electronAPI"> & { electronAPI?: ElectronAPI };

// [20260726_Tier3_AssertElectronApiMigrate] Minimal document stub: the test
// only reads/writes body.innerHTML. Casting globalThis.document through
// `unknown` to this shape avoids needing the full lib.dom Document type
// (node test env has no real document).
interface TestDocument {
  body: { innerHTML: string };
}

describe("assertElectronAPI", () => {
  // [20260726_Tier3_AssertElectronApiMigrate] Snapshot for restore:
  // electronAPI may be undefined when the test starts.
  let originalAPI: ElectronAPI | undefined;

  beforeEach(() => {
    originalAPI = (globalThis.window as TestWindow | undefined)?.electronAPI;
    if (!globalThis.window) {
      // [20260726_Tier3_AssertElectronApiMigrate] Stub empty window: cast
      // through `unknown` to the lib's `Window & typeof globalThis` type.
      globalThis.window = {} as unknown as Window & typeof globalThis;
    }
    if (!globalThis.document) {
      globalThis.document = {
        body: { innerHTML: "" },
      } as unknown as typeof globalThis.document;
    } else {
      (globalThis.document as unknown as TestDocument).body.innerHTML = "";
    }
  });

  afterEach(() => {
    const win = globalThis.window as TestWindow;
    if (originalAPI === undefined) {
      delete win.electronAPI;
    } else {
      win.electronAPI = originalAPI;
    }
  });

  it("returns true when electronAPI exists", () => {
    // [20260726_Tier3_AssertElectronApiMigrate] Arbitrary stub shape — cast
    // through `unknown` to ElectronAPI rather than introducing `any`.
    (globalThis.window as TestWindow).electronAPI = {
      foo: () => {},
    } as unknown as ElectronAPI;
    expect(assertElectronAPI()).toBe(true);
    expect(
      (globalThis.document as unknown as TestDocument).body.innerHTML,
    ).toBe("");
  });

  it("returns false and renders fallback DOM when electronAPI is missing", () => {
    delete (globalThis.window as TestWindow).electronAPI;
    expect(assertElectronAPI()).toBe(false);
    const html = (globalThis.document as unknown as TestDocument).body
      .innerHTML;
    expect(html).toContain("Electron API 不可用");
    expect(html).toContain("location.reload()");
  });
});
