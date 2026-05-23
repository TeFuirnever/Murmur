import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

describe("fileConfig", () => {
  let loadFileConfig;
  let saveFileConfig;
  let FILE_CONFIGURABLE_KEYS;

  beforeEach(() => {
    vi.resetModules();
    const fileConfig = require("../../src/helpers/fileConfig");
    loadFileConfig = fileConfig.loadFileConfig;
    saveFileConfig = fileConfig.saveFileConfig;
    FILE_CONFIGURABLE_KEYS = fileConfig.FILE_CONFIGURABLE_KEYS;
  });

  describe("loadFileConfig", () => {
    it("returns empty object when config file does not exist", () => {
      const result = loadFileConfig("/non/existent/murmur.json");
      expect(result).toEqual({});
    });

    it("loads valid JSON config file", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-test-"));
      const configPath = path.join(dir, "murmur.json");
      const config = { ai_base_url: "http://localhost:11434/v1", ai_model: "qwen2.5" };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      try {
        const result = loadFileConfig(configPath);
        expect(result).toEqual(config);
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("returns empty object for invalid JSON", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-test-"));
      const configPath = path.join(dir, "murmur.json");
      fs.writeFileSync(configPath, "{ invalid json");

      try {
        const result = loadFileConfig(configPath);
        expect(result).toEqual({});
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("filters out non-configurable keys", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-test-"));
      const configPath = path.join(dir, "murmur.json");
      fs.writeFileSync(configPath, JSON.stringify({
        ai_base_url: "http://localhost:11434/v1",
        ai_api_key: "super-secret-key",
        ai_model: "qwen2.5",
        some_random_key: "value",
      }));

      try {
        const result = loadFileConfig(configPath);
        expect(result).toHaveProperty("ai_base_url");
        expect(result).toHaveProperty("ai_model");
        expect(result).not.toHaveProperty("ai_api_key");
        expect(result).not.toHaveProperty("some_random_key");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });
  });

  describe("saveFileConfig", () => {
    it("writes config to file", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-test-"));
      const configPath = path.join(dir, "murmur.json");
      const config = { ai_base_url: "http://localhost:11434/v1", ai_model: "qwen2.5" };

      try {
        saveFileConfig(configPath, config);
        const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        expect(written).toEqual(config);
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("filters out non-configurable keys on save", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-test-"));
      const configPath = path.join(dir, "murmur.json");

      try {
        saveFileConfig(configPath, {
          ai_base_url: "http://localhost:11434/v1",
          ai_api_key: "secret",
          unknown_key: "value",
        });
        const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        expect(written).not.toHaveProperty("ai_api_key");
        expect(written).not.toHaveProperty("unknown_key");
        expect(written).toHaveProperty("ai_base_url");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("creates parent directories if needed", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-test-"));
      const configPath = path.join(dir, "sub", "dir", "murmur.json");

      try {
        saveFileConfig(configPath, { ai_model: "test" });
        expect(fs.existsSync(configPath)).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });
  });

  describe("FILE_CONFIGURABLE_KEYS", () => {
    it("includes ai_base_url and ai_model", () => {
      expect(FILE_CONFIGURABLE_KEYS).toContain("ai_base_url");
      expect(FILE_CONFIGURABLE_KEYS).toContain("ai_model");
    });

    it("does not include ai_api_key", () => {
      expect(FILE_CONFIGURABLE_KEYS).not.toContain("ai_api_key");
    });
  });

  describe("getSetting with file config fallback", () => {
    let DatabaseManager;
    let db;
    let configDir;

    beforeEach(() => {
      DatabaseManager = require("../../src/helpers/database");
      db = new DatabaseManager({ info: vi.fn(), error: vi.fn(), warn: vi.fn() });
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-db-test-"));
      db.initialize(configDir);
    });

    afterEach(() => {
      if (db.db) db.close();
      fs.rmSync(configDir, { recursive: true });
    });

    it("falls back to file config when DB has no value", () => {
      const configPath = path.join(configDir, "murmur.json");
      fs.writeFileSync(configPath, JSON.stringify({ ai_model: "file-model" }));
      db.setFileConfigPath(configPath);

      // DB has no ai_model → should get from file
      expect(db.getSetting("ai_model")).toBe("file-model");
    });

    it("DB value takes priority over file config", () => {
      const configPath = path.join(configDir, "murmur.json");
      fs.writeFileSync(configPath, JSON.stringify({ ai_model: "file-model" }));
      db.setFileConfigPath(configPath);

      db.setSetting("ai_model", "db-model");
      expect(db.getSetting("ai_model")).toBe("db-model");
    });

    it("returns default when neither DB nor file has the key", () => {
      db.setFileConfigPath(path.join(configDir, "nonexistent.json"));
      expect(db.getSetting("nonexistent_key", "default")).toBe("default");
    });
  });
});
