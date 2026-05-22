import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertElectronAPI } from "../../src/bootstrap/assertElectronAPI.js";

describe("assertElectronAPI", () => {
  let originalAPI;

  beforeEach(() => {
    originalAPI = globalThis.window?.electronAPI;
    if (!globalThis.window) globalThis.window = {};
    if (!globalThis.document) {
      globalThis.document = { body: { innerHTML: "" } };
    } else {
      globalThis.document.body.innerHTML = "";
    }
  });

  afterEach(() => {
    if (originalAPI === undefined) {
      delete globalThis.window.electronAPI;
    } else {
      globalThis.window.electronAPI = originalAPI;
    }
  });

  it("returns true when electronAPI exists", () => {
    globalThis.window.electronAPI = { foo: () => {} };
    expect(assertElectronAPI()).toBe(true);
    expect(globalThis.document.body.innerHTML).toBe("");
  });

  it("returns false and renders fallback DOM when electronAPI is missing", () => {
    delete globalThis.window.electronAPI;
    expect(assertElectronAPI()).toBe(false);
    expect(globalThis.document.body.innerHTML).toContain(
      "Electron API 不可用",
    );
    expect(globalThis.document.body.innerHTML).toContain("location.reload()");
  });
});
