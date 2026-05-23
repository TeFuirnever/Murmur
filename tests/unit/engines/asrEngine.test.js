import { describe, it, expect, vi, beforeEach } from "vitest";

describe("ASREngine interface", () => {
  let validateASREngine;
  let createASREngineRegistry;

  beforeEach(() => {
    vi.resetModules();
    const asrEngine = require("../../../src/helpers/engines/asrEngine");
    validateASREngine = asrEngine.validateASREngine;
    createASREngineRegistry = asrEngine.createASREngineRegistry;
  });

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
  });

  describe("FunASRManager satisfies ASREngine", () => {
    it("FunASRManager implements all required methods", () => {
      const FunASRManager = require("../../../src/helpers/funasrManager");
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      const manager = new FunASRManager(logger);
      expect(validateASREngine({
        transcribeAudio: manager.transcribeAudio.bind(manager),
        transcribeFile: manager.transcribeFile.bind(manager),
        cancelTranscription: manager.cancelTranscription.bind(manager),
        checkStatus: manager.checkStatus.bind(manager),
        shutdown: manager.gracefulShutdown.bind(manager),
      })).toBe(true);
    });
  });
});
