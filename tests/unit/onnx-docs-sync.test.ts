// [20261006_Docs_423_T10] Ticket #423 (spec #412 T10): docs / SECURITY.md /
// ADR sync for the fp32 torch → ONNX int8 engine switch. Pins every
// user-facing size number and download hint to the shipped model pin
// (scripts/onnx-export/model-pin.json) — the same record the migration
// dialog's displayed MB is computed from — so engine-switch drift turns CI
// red instead of shipping stale torch-era claims (~1GB / 1.1GB / 840MB).
// Also pins: no torch pip commands in end-user docs, the dual-source
// download description (ModelScope + GitHub Release mirror), the
// SECURITY.md model supply-chain section, and the three ADRs (engine
// switch / self-export trust chain / sherpa-onnx exit) with their
// cross-references to #412 and the docs/research evidence files.
//
// Test-pattern provenance: follows the docs-contract style of
// tests/unit/readme-contract.test.ts (pin rendered content, strip HTML
// comments, resolve referenced repo paths on disk).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function stripHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "");
}

function readRenderedRepoFile(relativePath: string): string {
  return stripHtmlComments(readRepoFile(relativePath));
}

// --- Shared fixture: the shipped model pin (single source of truth). ---

interface PinFile {
  path: string;
  size_bytes: number;
}

interface PinModel {
  name: string;
  files: PinFile[];
}

interface ModelPin {
  models: Record<string, PinModel>;
}

const PIN: ModelPin = JSON.parse(
  readRepoFile("scripts/onnx-export/model-pin.json"),
) as ModelPin;

const BYTES_PER_MB = 1024 * 1024;

function modelBytes(role: string): number {
  const model = PIN.models[role];
  expect(model, `pin must declare the "${role}" model role`).toBeDefined();
  return model?.files.reduce((sum, file) => sum + file.size_bytes, 0) ?? 0;
}

/** Full first-launch download = every file in the pin (asr + vad + punc +
 * speaker) — same denominator the migration dialog displays
 * (onnxMigration.ts sums all pin files; MigrationDialog.tsx rounds to MB). */
const TOTAL_MB = Math.max(
  1,
  Math.round(
    Object.keys(PIN.models).reduce((sum, role) => sum + modelBytes(role), 0) /
      BYTES_PER_MB,
  ),
);

const TOTAL_MB_STR = `${TOTAL_MB} MB`;

// Stale torch-era numbers/claims that must not survive the engine switch.
const STALE_SIZE_RE = /约\s*1GB|~1GB|约1GB|1\.1GB|840\s*MB|1\.24\s*GB/;

describe("ONNX docs sync (#423 / spec #412 T10)", () => {
  describe("model download size numbers match the shipped pin", () => {
    it("pin fixture sanity: total covers all four model roles", () => {
      expect(Object.keys(PIN.models).sort()).toEqual([
        "asr",
        "punc",
        "speaker",
        "vad",
      ]);
      expect(TOTAL_MB).toBeGreaterThan(100); // multi-hundred-MB download
    });

    it("i18n onboarding step1 states the pin total in zh and en", () => {
      for (const [locale, pattern] of [
        ["src/i18n/locales/zh-CN.json", /约\s*(\d+)\s*MB/],
        ["src/i18n/locales/en.json", /~\s*(\d+)\s*MB/],
      ] as const) {
        const raw = JSON.parse(readRepoFile(locale)) as {
          app?: { steps?: { step1?: string } };
        };
        const step1 = raw.app?.steps?.step1 ?? "";
        expect(
          step1,
          `${locale} app.steps.step1 must mention an MB size`,
        ).toMatch(pattern);
        const stated = Number(pattern.exec(step1)?.[1]);
        expect(
          stated,
          `${locale} app.steps.step1 size must equal the pin total (${TOTAL_MB})`,
        ).toBe(TOTAL_MB);
        expect(step1).not.toMatch(STALE_SIZE_RE);
      }
    });

    it("App.tsx step1 fallback literal matches the locale string's number", () => {
      const app = readRepoFile("src/App.tsx");
      expect(app).not.toMatch(STALE_SIZE_RE);
      expect(app).toContain(`约${TOTAL_MB}MB`);
    });

    it("model-status-indicator download hints state the pin total", () => {
      const source = readRepoFile(
        "src/components/ui/model-status-indicator.tsx",
      );
      expect(source).not.toMatch(STALE_SIZE_RE);
      const occurrences = source.split(`约${TOTAL_MB}MB`).length - 1;
      expect(
        occurrences,
        "both the tooltip and the download banner must state the pin total",
      ).toBeGreaterThanOrEqual(2);
    });

    it("model-status-indicator per-model list matches pin sizes for all four roles", () => {
      const source = readRepoFile(
        "src/components/ui/model-status-indicator.tsx",
      );
      // Same display rule as the component: integer MB at ≥10, one decimal
      // below (keeps the 0.5MB VAD entry meaningful).
      const displayMb = (bytes: number): string => {
        const mb = bytes / BYTES_PER_MB;
        return mb >= 10
          ? String(Math.round(mb))
          : String(Math.round(mb * 10) / 10);
      };
      for (const role of Object.keys(PIN.models)) {
        const bytes = modelBytes(role);
        expect(
          source,
          `downloading list must show the pin size for role "${role}" (${displayMb(bytes)}MB)`,
        ).toContain(`size: "${displayMb(bytes)}MB"`);
      }
    });

    it("faq.md states the first-launch download total in both languages", () => {
      const faq = readRenderedRepoFile("docs/faq.md");
      expect(faq).not.toMatch(STALE_SIZE_RE);
      // zh half uses "约 671 MB", en half uses "~671 MB".
      expect(faq).toContain(`约 ${TOTAL_MB_STR}`);
      expect(faq).toContain(`~${TOTAL_MB_STR}`);
    });

    it("README (en + zh) quick-start states the pin total", () => {
      for (const file of ["README.md", "README.zh-CN.md"]) {
        const readme = readRenderedRepoFile(file);
        expect(readme, `${file} must not carry stale sizes`).not.toMatch(
          STALE_SIZE_RE,
        );
        expect(readme, `${file} must state the pin total`).toContain(
          TOTAL_MB_STR,
        );
      }
    });
  });

  describe("stale torch-era commands removed from user docs", () => {
    it("troubleshooting.md has no torch references at all", () => {
      const rendered = readRenderedRepoFile("docs/troubleshooting.md");
      expect(
        rendered,
        "torch must be gone from end-user troubleshooting",
      ).not.toMatch(/\btorch\b/);
    });

    it("no old unpinned 'pip install funasr modelscope torch …' set anywhere", () => {
      // The old set predates pyproject.toml's exact pins and the packaged
      // funasr-onnx stack; if a pip line is ever needed again it must match
      // pyproject.toml, not resurrect this stale literal.
      for (const file of [
        "docs/faq.md",
        "docs/troubleshooting.md",
        "README.md",
        "README.zh-CN.md",
      ]) {
        const rendered = readRenderedRepoFile(file);
        expect(
          rendered.match(/pip install[^\n]*\bmodelscope\b[^\n]*\btorch\b/),
          `${file} still carries the stale torch pip command`,
        ).toBeNull();
      }
    });

    it("faq.md audio-decode copy no longer credits librosa (removed in #419)", () => {
      const rendered = readRenderedRepoFile("docs/faq.md");
      expect(rendered).not.toMatch(/\blibrosa\b/);
    });
  });

  describe("dual-source download description", () => {
    it("faq.md and troubleshooting.md describe ModelScope + GitHub mirror", () => {
      for (const file of ["docs/faq.md", "docs/troubleshooting.md"]) {
        const rendered = readRenderedRepoFile(file);
        expect(rendered, `${file} must mention ModelScope`).toContain(
          "ModelScope",
        );
        expect(
          rendered,
          `${file} must mention the GitHub Release mirror`,
        ).toMatch(/GitHub\s+Release/i);
      }
    });
  });

  describe("SECURITY.md model supply-chain section", () => {
    const security = readRenderedRepoFile("SECURITY.md");

    it("has a dedicated model supply-chain section", () => {
      expect(security).toMatch(/^#+\s*(?:.*模型供应链|.*Model Supply Chain)/m);
    });

    it("states source, pin policy, hash guarantees and limits honestly", () => {
      for (const [label, pattern] of [
        ["source (official iic checkpoints)", /iic\//],
        ["pin policy (commit SHA)", /checkpoint.*commit|commit.*SHA/i],
        ["full-file sha256 manifest", /sha256/i],
        ["ModelScope source", /ModelScope/],
        ["GitHub Release mirror", /GitHub\s+Release/i],
        ["Apache-2.0 license", /Apache-2\.0/],
        ["attribution obligation", /署名|[Aa]ttribution|LICENSE/],
        [
          "signature posture stated honestly",
          /不签名|不做签名|[Nn]o (?:GPG|code[- ])?signing|未签名|不承诺/,
        ],
      ] as const) {
        expect(security, `supply-chain section must state: ${label}`).toMatch(
          pattern,
        );
      }
    });

    it("cross-references #412, the pin record, research evidence and ADRs", () => {
      expect(security).toContain("#412");
      // Every referenced repo path must exist on disk (link-integrity style).
      const referenced = [
        ...security.matchAll(/`((?:docs|scripts|src)\/[A-Za-z0-9._/-]+)`/g),
      ].map((match) => match[1] ?? "");
      expect(referenced.length).toBeGreaterThan(0);
      const missing = referenced.filter(
        (target) => !fs.existsSync(path.join(ROOT, target)),
      );
      expect(missing, `broken path references: ${missing.join(", ")}`).toEqual(
        [],
      );
    });
  });

  describe("ADRs for the engine switch (docs/adr/)", () => {
    // Lazy resolution: a missing ADR must fail ITS test, not the whole
    // module (all three prefixes are resolved inside each test body).
    function adrFile(prefix: string): string {
      const entry = fs
        .readdirSync(path.join(ROOT, "docs/adr"))
        .find((name) => name.startsWith(prefix) && name.endsWith(".md"));
      expect(entry, `docs/adr/${prefix}*.md must exist`).toBeDefined();
      return `docs/adr/${entry}`;
    }

    const engineSwitchAdr = () => adrFile("016");
    const trustChainAdr = () => adrFile("017");
    const sherpaExitAdr = () => adrFile("018");

    it("016: engine-switch ADR cites #412 and the fp32/A-B evidence", () => {
      const adr = readRenderedRepoFile(engineSwitchAdr());
      expect(adr).toContain("#412");
      expect(adr).toMatch(/fp32-hotword-diagnosis/); // #444 diagnosis evidence
      expect(adr).toMatch(/onnx-ab-verdict|asr-ab-torch-baseline/); // T4 verdict
      // Known English-hotword limitation must be stated, not hidden.
      expect(adr).toMatch(/热词|hotword/i);
    });

    it("017: trust-chain ADR cites the pin, verification and export tooling", () => {
      const adr = readRenderedRepoFile(trustChainAdr());
      expect(adr).toContain("#412");
      expect(adr).toMatch(/model-pin\.json/);
      expect(adr).toMatch(/verify_artifacts|sha256/i);
      expect(adr).toMatch(/checkpoint_commit|[Cc]ommit[- ]?SHA/);
    });

    it("018: sherpa-onnx exit ADR cites the spike research file", () => {
      const adr = readRenderedRepoFile(sherpaExitAdr());
      expect(adr).toContain("#412");
      expect(adr).toMatch(/sherpa-onnx-hotword-spike/);
      expect(adr).toMatch(/NOT-VIABLE|热词不|不支持热词/);
    });

    it("every repo path referenced by the ADRs resolves on disk", () => {
      const referenced: string[] = [];
      for (const file of [
        engineSwitchAdr(),
        trustChainAdr(),
        sherpaExitAdr(),
      ]) {
        for (const match of readRenderedRepoFile(file).matchAll(
          /`((?:docs|scripts|src)\/[A-Za-z0-9._/-]+)`/g,
        )) {
          referenced.push(match[1] ?? "");
        }
      }
      expect(referenced.length).toBeGreaterThan(0);
      const missing = referenced.filter(
        (target) => !fs.existsSync(path.join(ROOT, target)),
      );
      expect(missing, `broken path references: ${missing.join(", ")}`).toEqual(
        [],
      );
    });
  });
});
