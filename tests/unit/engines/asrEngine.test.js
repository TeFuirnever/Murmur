// [20260726_Tier32_AsrEngineJs] Tier 3.2: converted the two require() calls
// (and the now-redundant vi.resetModules()) to top-level ESM imports. Both
// source modules (asrEngine, funasrManager) have no module-level mutable
// state — validateASREngine is pure, createASREngineRegistry returns a fresh
// instance, FunASRManager is a class — so removing resetModules and hoisting
// the imports is behavior-preserving. This was the last vitest consumer of
// tests/_tsresolve.setup.js, so the shim can now be deleted.
// [20260726_Tier32_AsrEngineJs] END
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateASREngine,
  createASREngineRegistry,
} from "../../../src/helpers/engines/asrEngine";
import FunASRManager from "../../../src/helpers/funasrManager";

describe("ASREngine interface", () => {
  // [20260726_Tier32_AsrEngineJs] No outer beforeEach needed: the previous
  // outer beforeEach only did vi.resetModules() + require() to populate
  // validateASREngine / createASREngineRegistry, which are now top-level
  // ESM imports. The inner createASREngineRegistry describe keeps its own
  // beforeEach for the registry + mockEngine fixtures.

  describe("validateASREngine", () => {
    it("accepts an object with all required methods", () => {
      const engine = {
        transcribeAudio: vi.fn(),
        transcribeFile: vi.fn(),
        cancelTranscription: vi.fn(),
        checkStatus: vi.fn(),
        shutdown: vi.fn(),
      };
      expect(validateASREngine(engine)).toBe(true);
    });

    it("rejects an empty object", () => {
      expect(validateASREngine({})).toBe(false);
    });

    it("rejects object missing transcribeAudio", () => {
      const engine = {
        transcribeFile: vi.fn(),
        cancelTranscription: vi.fn(),
        checkStatus: vi.fn(),
        shutdown: vi.fn(),
      };
      expect(validateASREngine(engine)).toBe(false);
    });

    it("rejects object with non-function property", () => {
      const engine = {
        transcribeAudio: "not a function",
        transcribeFile: vi.fn(),
        cancelTranscription: vi.fn(),
        checkStatus: vi.fn(),
        shutdown: vi.fn(),
      };
      expect(validateASREngine(engine)).toBe(false);
    });

    it("rejects null and undefined", () => {
      expect(validateASREngine(null)).toBe(false);
      expect(validateASREngine(undefined)).toBe(false);
    });
  });

  describe("createASREngineRegistry", () => {
    let registry;
    let mockEngine;

    beforeEach(() => {
      registry = createASREngineRegistry();
      mockEngine = {
        transcribeAudio: vi.fn(async () => ({ success: true, text: "hello" })),
        transcribeFile: vi.fn(async () => ({ success: true, text: "file" })),
        cancelTranscription: vi.fn(async () => ({ success: true })),
        checkStatus: vi.fn(async () => ({ success: true, installed: true })),
        shutdown: vi.fn(async () => {}),
      };
    });

    it("registers and retrieves a valid engine", () => {
      const result = registry.register("funasr", mockEngine);
      expect(result).toBe(true);
      expect(registry.get("funasr")).toBe(mockEngine);
    });

    it("refuses to register invalid engine", () => {
      expect(registry.register("bad", {})).toBe(false);
      expect(registry.get("bad")).toBeUndefined();
    });

    it("returns default engine name", () => {
      registry.register("funasr", mockEngine);
      registry.setDefault("funasr");
      expect(registry.getDefault()).toBe("funasr");
    });

    it("getDefault returns undefined when no default set", () => {
      expect(registry.getDefault()).toBeUndefined();
    });

    it("list returns all registered engine names", () => {
      const engine2 = { ...mockEngine };
      registry.register("funasr", mockEngine);
      registry.register("whisper", engine2);
      expect(registry.list()).toEqual(["funasr", "whisper"]);
    });

    it("getActive returns default engine instance", () => {
      registry.register("funasr", mockEngine);
      registry.setDefault("funasr");
      expect(registry.getActive()).toBe(mockEngine);
    });

    it("switches active engine", () => {
      const engine2 = { ...mockEngine };
      registry.register("funasr", mockEngine);
      registry.register("whisper", engine2);
      registry.setDefault("funasr");
      registry.setActive("whisper");
      expect(registry.getActive()).toBe(engine2);
    });

    it("setDefault returns false for non-existent engine", () => {
      expect(registry.setDefault("nonexistent")).toBe(false);
    });

    it("setActive returns false for non-existent engine", () => {
      expect(registry.setActive("nonexistent")).toBe(false);
    });

    it("getActive returns undefined when no engines registered", () => {
      expect(registry.getActive()).toBeUndefined();
    });

    it("first registered engine becomes default and active", () => {
      registry.register("first", mockEngine);
      expect(registry.getDefault()).toBe("first");
      expect(registry.getActive()).toBe(mockEngine);
    });

    it("second registered engine does not override default", () => {
      const engine2 = { ...mockEngine };
      registry.register("first", mockEngine);
      registry.register("second", engine2);
      expect(registry.getDefault()).toBe("first");
    });
  });

  describe("FunASRManager satisfies ASREngine", () => {
    it("FunASRManager implements all required methods", () => {
      // [20260726_Tier32_AsrEngineJs] FunASRManager is now a top-level
      // default import (class) — same shape as the previous require().
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      const manager = new FunASRManager(logger);
      expect(
        validateASREngine({
          transcribeAudio: manager.transcribeAudio.bind(manager),
          transcribeFile: manager.transcribeFile.bind(manager),
          cancelTranscription: manager.cancelTranscription.bind(manager),
          checkStatus: manager.checkStatus.bind(manager),
          shutdown: manager.gracefulShutdown.bind(manager),
        }),
      ).toBe(true);
    });
  });
});
