// [20260725_TDD_UpdateManager_Behavioral] Behavioral TDD tests for the pure
// helper functions exported from updateManager.ts: semverGt, parseChecksums,
// getPlatformAsset. These helpers are platform/version logic with no Electron
// runtime dependency at call time; only module load pulls in `electron`, so
// we mock it out at the top.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock electron — updateManager imports `electron` at the top level even
// though the pure helpers we test never touch it. Provide a minimal stub.
vi.mock("electron", () => ({
  app: { getVersion: vi.fn(() => "0.0.0"), getPath: vi.fn(() => "/tmp") },
  shell: { openPath: vi.fn() },
  net: { fetch: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  Notification: { isSupported: vi.fn(() => false) },
}));

import {
  semverGt,
  parseChecksums,
  getPlatformAsset,
} from "../../src/helpers/updateManager";

describe("updateManager — pure helper behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("semverGt", () => {
    it("returns true when a > b by patch (1.2.3 > 1.2.2)", () => {
      expect(semverGt("1.2.3", "1.2.2")).toBe(true);
    });

    it("returns false when a < b by patch (1.2.2 vs 1.2.3)", () => {
      expect(semverGt("1.2.2", "1.2.3")).toBe(false);
    });

    it("returns false when versions are equal (1.2.3 vs 1.2.3)", () => {
      expect(semverGt("1.2.3", "1.2.3")).toBe(false);
    });

    it("returns true when crossing a major boundary (2.0.0 > 1.9.9)", () => {
      expect(semverGt("2.0.0", "1.9.9")).toBe(true);
    });
  });

  describe("parseChecksums", () => {
    it("extracts SHA256 + filename pairs from valid checksum text", () => {
      // Format observed in updateManager.ts: "<hash>  <filename>" where the
      // separator is 2+ whitespace characters. Two entries on separate lines.
      const sha1 = "a".repeat(64);
      const sha2 = "b".repeat(64);
      const content = `${sha1}  Murmur-1.0.0.dmg\n${sha2}  Murmur-1.0.0.exe`;

      const entries = parseChecksums(content);

      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        hash: sha1,
        filename: "Murmur-1.0.0.dmg",
      });
      expect(entries[1]).toEqual({
        hash: sha2,
        filename: "Murmur-1.0.0.exe",
      });
    });

    it("returns empty array for invalid/blank input", () => {
      // parseChecksums splits on newlines and filters blank lines; an empty
      // or whitespace-only string yields no entries (never null).
      expect(parseChecksums("")).toEqual([]);
      expect(parseChecksums("   \n\n\t\n")).toEqual([]);
    });
  });

  describe("getPlatformAsset", () => {
    it("returns the .dmg asset for darwin from a releases array", () => {
      // getPlatformAsset keys off platform === "darwin" → looks for a .dmg.
      const release = {
        tag_name: "v1.0.0",
        html_url: "https://github.com/TeFuirnever/Murmur/releases/v1.0.0",
        assets: [
          {
            name: "Murmur-1.0.0.exe",
            browser_download_url: "https://example.com/murmur.exe",
            size: 1000,
          },
          {
            name: "Murmur-1.0.0.dmg",
            browser_download_url: "https://example.com/murmur.dmg",
            size: 2000,
          },
          {
            name: "checksums-sha256.txt",
            browser_download_url: "https://example.com/checksums.txt",
            size: 100,
          },
        ],
      };

      const asset = getPlatformAsset(release, "darwin");

      expect(asset).toBeDefined();
      expect(asset?.name).toBe("Murmur-1.0.0.dmg");
      expect(asset?.browser_download_url).toBe(
        "https://example.com/murmur.dmg",
      );
      expect(asset?.size).toBe(2000);
    });

    it("returns undefined for an unsupported platform (no matching asset)", () => {
      // The function only knows darwin (.dmg) vs everything-else (.exe).
      // A platform like "freebsd" matches the non-darwin branch and looks
      // for a .exe; with none present, it returns undefined (not null).
      const release = {
        tag_name: "v1.0.0",
        html_url: "https://github.com/TeFuirnever/Murmur/releases/v1.0.0",
        assets: [
          {
            name: "Murmur-1.0.0.dmg",
            browser_download_url: "https://example.com/murmur.dmg",
            size: 2000,
          },
          {
            name: "checksums-sha256.txt",
            browser_download_url: "https://example.com/checksums.txt",
            size: 100,
          },
        ],
      };

      const asset = getPlatformAsset(release, "freebsd");
      // freebsd → non-darwin → seeks .exe → none present → undefined.
      expect(asset).toBeUndefined();
    });
  });
});
