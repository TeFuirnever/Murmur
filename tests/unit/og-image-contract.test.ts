// [20260913_Feat_150_OgImage] Contract lock for the OG image (ticket #150):
// the file must exist, be a valid 1200×630 PNG (the standard OG canvas),
// be referenced by the Layout default, and have a reproducible generator
// script in-repo (so a redesign re-runs it instead of hand-editing pixels).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ogPath = path.resolve(__dirname, "../../website/public/og-image.png");
const generatorPath = path.resolve(
  __dirname,
  "../../website/scripts/og-image.mjs",
);
const layoutPath = path.resolve(
  __dirname,
  "../../website/src/layouts/Layout.astro",
);

function pngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG magic (8 bytes) + IHDR chunk: length(4) + type(4) + width(4) + height(4).
  expect(buf.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

describe("og-image contract (ticket #150)", () => {
  it("exists as a valid 1200×630 PNG", () => {
    const buf = fs.readFileSync(ogPath);
    const { width, height } = pngDimensions(buf);
    expect(width).toBe(1200);
    expect(height).toBe(630);
  });

  it("is non-trivial content (gradient art, not a placeholder)", () => {
    const buf = fs.readFileSync(ogPath);
    expect(buf.length).toBeGreaterThan(50 * 1024);
  });

  it("has an in-repo generator script referencing the brand tokens", () => {
    const script = fs.readFileSync(generatorPath, "utf8");
    expect(script).toContain("#a78bfa"); // fox-lavender
    expect(script).toContain("#0f0a1f"); // dark background
    expect(script).toContain("1200");
    expect(script).toContain("630");
  });

  it("remains the Layout default og image", () => {
    const layout = fs.readFileSync(layoutPath, "utf8");
    expect(layout).toContain("og-image.png");
  });
});
