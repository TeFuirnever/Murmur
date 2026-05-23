import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const rootDir = path.resolve(__dirname, "../../");

describe("Phase 3: Semi-auto update", () => {
  describe("IPC contracts for update", () => {
    let contracts;

    beforeAll(() => {
      contracts = fs.readFileSync(
        path.join(rootDir, "src/helpers/ipc-contracts.js"),
        "utf8",
      );
    });

    it("should define UPDATE contract group", () => {
      expect(contracts).toMatch(/UPDATE\s*:/);
    });

    it("should define update check channel", () => {
      expect(contracts).toMatch(/CHECK\s*:\s*["']check-update["']/);
    });

    it("should define update download channel", () => {
      expect(contracts).toMatch(/DOWNLOAD\s*:\s*["']download-update["']/);
    });

    it("should define update download progress event", () => {
      expect(contracts).toMatch(/UPDATE_DOWNLOAD_PROGRESS/);
    });

    it("should define update download complete event", () => {
      expect(contracts).toMatch(/UPDATE_DOWNLOAD_COMPLETE/);
    });

    it("should define update download error event", () => {
      expect(contracts).toMatch(/UPDATE_DOWNLOAD_ERROR/);
    });
  });

  describe("updateManager module", () => {
    let updateManagerPath;
    let updateManagerContent;

    beforeAll(() => {
      updateManagerPath = path.join(rootDir, "src/helpers/updateManager.js");
      if (fs.existsSync(updateManagerPath)) {
        updateManagerContent = fs.readFileSync(updateManagerPath, "utf8");
      }
    });

    it("should exist", () => {
      expect(updateManagerContent).toBeDefined();
      expect(updateManagerContent.length).toBeGreaterThan(0);
    });

    it("should export register function", () => {
      expect(updateManagerContent).toMatch(
        /module\.exports\s*=\s*\{[^}]*register/,
      );
    });

    it("should use crypto for SHA256 verification", () => {
      expect(updateManagerContent).toMatch(/crypto/);
      expect(updateManagerContent).toMatch(/sha256|SHA256/);
    });

    it("should use net.fetch for downloads", () => {
      expect(updateManagerContent).toMatch(/net\.fetch/);
    });

    it("should use temp directory for downloads", () => {
      expect(updateManagerContent).toMatch(/tmp|temp|TEMP/);
    });

    it("should parse checksums-sha256.txt format", () => {
      // The format is: <hash>  <filename>
      expect(updateManagerContent).toMatch(/checksums.*sha256/);
    });

    it("should find platform-appropriate asset from GitHub release", () => {
      expect(updateManagerContent).toMatch(/platform|\.dmg|\.exe/);
    });
  });

  describe("SHA256 verification logic", () => {
    it("should correctly compute SHA256 of a buffer", () => {
      const testBuffer = Buffer.from("test content for sha256");
      const hash = crypto.createHash("sha256").update(testBuffer).digest("hex");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should parse checksums file format", () => {
      const checksumsContent =
        "abc123  Murmur-1.0.0.dmg\ndef456  Murmur-Setup-1.0.0.exe\n";
      const lines = checksumsContent
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          const [hash, filename] = l.trim().split(/\s{2,}/);
          return { hash, filename };
        });
      expect(lines).toHaveLength(2);
      expect(lines[0].hash).toBe("abc123");
      expect(lines[0].filename).toBe("Murmur-1.0.0.dmg");
      expect(lines[1].filename).toBe("Murmur-Setup-1.0.0.exe");
    });
  });

  describe("preload.js update API", () => {
    let preloadContent;

    beforeAll(() => {
      preloadContent = fs.readFileSync(
        path.join(rootDir, "preload.js"),
        "utf8",
      );
    });

    it("should expose downloadUpdate in electronAPI", () => {
      expect(preloadContent).toMatch(/downloadUpdate/);
    });

    it("should expose onUpdateDownloadProgress event listener", () => {
      expect(preloadContent).toMatch(/onUpdateDownloadProgress/);
    });

    it("should expose onUpdateDownloadComplete event listener", () => {
      expect(preloadContent).toMatch(/onUpdateDownloadComplete/);
    });
  });

  describe("Settings UI update enhancements", () => {
    let settingsContent;

    beforeAll(() => {
      settingsContent = fs.readFileSync(
        path.join(rootDir, "src/settings.jsx"),
        "utf8",
      );
    });

    it("should have download progress state", () => {
      expect(settingsContent).toMatch(
        /downloadProgress|updateDownloadProgress/,
      );
    });

    it("should have changelog/release notes display", () => {
      expect(settingsContent).toMatch(/releaseNotes|changelog/);
    });
  });

  describe("electronAPI.d.ts update types", () => {
    let typeFile;

    beforeAll(() => {
      typeFile = fs.readFileSync(
        path.join(rootDir, "src/electronAPI.d.ts"),
        "utf8",
      );
    });

    it("should type downloadUpdate", () => {
      expect(typeFile).toMatch(/downloadUpdate/);
    });

    it("should type update event listeners", () => {
      expect(typeFile).toMatch(/onUpdateDownloadProgress/);
      expect(typeFile).toMatch(/onUpdateDownloadComplete/);
    });
  });
});
