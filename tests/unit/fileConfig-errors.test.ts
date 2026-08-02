// [20260725_TDD_FileConfigErrors] TDD tests for loadFileConfig / saveFileConfig
// error and filter branches that fileConfig.test.js does not cover.
// Targets branch coverage in src/helpers/fileConfig.ts (lines 27-49).
import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  loadFileConfig,
  saveFileConfig,
  FILE_CONFIGURABLE_KEYS,
} from "../../src/helpers/fileConfig";

describe("fileConfig error paths", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-cfg-err-"));
  });

  // tmp dir cleanup helper used via afterEach-style try/finally in each test.
  function tmpPath(name = "murmur.json"): string {
    return path.join(tmpDir, name);
  }

  describe("loadFileConfig", () => {
    it("returns {} when the config file does not exist", () => {
      // Path under tmpDir but never created → ENOENT branch (line 27).
      const result = loadFileConfig(tmpPath("missing.json"));
      expect(result).toEqual({});
    });

    it("returns {} for invalid JSON (catch branch)", () => {
      const configPath = tmpPath();
      // Malformed JSON triggers JSON.parse throw → catch → return {}.
      fs.writeFileSync(configPath, "{ not valid json,,, }");

      const result = loadFileConfig(configPath);
      expect(result).toEqual({});
    });

    it("returns {} when the parsed value is an array", () => {
      const configPath = tmpPath();
      // Top-level array → Array.isArray branch (line 30) → return {}.
      fs.writeFileSync(configPath, JSON.stringify(["a", "b", "c"]));

      const result = loadFileConfig(configPath);
      expect(result).toEqual({});
    });

    it("returns {} when the parsed value is null", () => {
      const configPath = tmpPath();
      // JSON null → parsed === null branch (line 30) → return {}.
      fs.writeFileSync(configPath, "null");

      const result = loadFileConfig(configPath);
      expect(result).toEqual({});
    });

    it("filters out non-configurable keys, keeping only allowed keys", () => {
      const configPath = tmpPath();
      // Mix of allowed and disallowed keys; filtering loop (lines 33-38).
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          ai_model: "qwen2.5",
          ai_api_key: "should-be-stripped",
          unknown_key: "also-stripped",
        }),
      );

      const result = loadFileConfig(configPath);
      expect(result).toHaveProperty("ai_model", "qwen2.5");
      expect(result).not.toHaveProperty("ai_api_key");
      expect(result).not.toHaveProperty("unknown_key");
      // Only allowed keys survive.
      for (const key of Object.keys(result)) {
        expect(FILE_CONFIGURABLE_KEYS).toContain(key);
      }
    });

    it("preserves the values of all allowed keys", () => {
      const configPath = tmpPath();
      const allowed = {
        ai_base_url: "http://localhost:11434/v1",
        ai_model: "qwen2.5",
        ai_temperature: 0.7,
        ai_max_tokens: 4096,
        hotkey: "CommandOrControl+Shift+M",
        language: "zh",
        theme: "dark",
        auto_paste: true,
        auto_start: false,
        minimize_to_tray: true,
        show_notifications: false,
      };
      fs.writeFileSync(configPath, JSON.stringify(allowed));

      const result = loadFileConfig(configPath);
      // Every allowed key present in input must survive unmodified.
      expect(result).toEqual(allowed);
    });
  });

  describe("saveFileConfig", () => {
    it("filters out non-configurable keys when saving", () => {
      const configPath = tmpPath();
      // saveFileConfig filter loop (lines 46-50) strips disallowed keys.
      saveFileConfig(configPath, {
        ai_model: "qwen2.5",
        ai_base_url: "http://localhost:11434/v1",
        ai_api_key: "must-not-be-written",
        malicious_field: "nope",
      });

      const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(written).toHaveProperty("ai_model", "qwen2.5");
      expect(written).toHaveProperty(
        "ai_base_url",
        "http://localhost:11434/v1",
      );
      expect(written).not.toHaveProperty("ai_api_key");
      expect(written).not.toHaveProperty("malicious_field");
    });

    it("writes valid, pretty-printed JSON readable by loadFileConfig", () => {
      const configPath = tmpPath();
      const settings = { ai_model: "glm-4-flash", hotkey: "F1" };
      // writeFileSync call (line 53) with 2-space indent.
      saveFileConfig(configPath, settings);

      const raw = fs.readFileSync(configPath, "utf-8");
      // Pretty-printed JSON contains newlines (indent = 2).
      expect(raw).toContain("\n");
      // Round-trip: loadFileConfig should read back exactly what we saved.
      expect(loadFileConfig(configPath)).toEqual(settings);
    });
  });
});
