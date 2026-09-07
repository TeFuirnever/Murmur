# README.md End-to-End Audit (2026-09-07)

<!-- [20260907_Audit_ReadmeEndToEnd] Full factual / best-practice / zh-en parity
     audit of README.md against primary sources (package.json, pyproject.toml,
     vitest.config.ts, src/, funasr_server.py, .github/workflows, docs/).
     Read-only audit: README.md was NOT modified. Every claim cites file:line
     of a primary source as of branch test/spec-259-instrumentation,
     HEAD 0151fd8 (2026-09-07). -->

- **Date**: 2026-09-07
- **Scope**: README.md @ HEAD (last touched 412c7dc, 2026-09-07 — only the test count line changed)
- **Method**: every factual claim in README was checked against the repo's primary sources; static test counts via grep over `tests/`; zh/en halves compared section by section.
- **Already known / confirmed**: "Electron 36" is stale since 67e4027 (2026-08-16, "Electron 39 toolchain"); this audit finds it is NOT the only drift.

---

## 1. Verdict Summary

- **The README is structurally healthy but factually drifted in ~5 places**, two of which mislead (Electron 36 vs 39.8.10; "CUDA > MPS > CPU" vs actual "CUDA > CPU, MPS intentionally skipped").
- **Two "done" roadmap items describe removed behavior**: FTS5 full-text search was deleted on 2026-08-15 (search is now client-side filtering), and MPS GPU detection never ships. Both zh and en carry the stale claims.
- **The coverage figure "~97%" is stale**: global thresholds were re-baselined to 88/83/88/89 on 2026-09-07 (Spec #259 instrumentation); three docs now disagree (README ~97%, CONTRIBUTING 96/92/94/96, vitest.config 88/83/88/89).
- **The Python "3.8+" requirement is stale and harmful**: `pyproject.toml` requires `>=3.11`; a contributor on 3.8–3.10 fails at `uv sync`. Note: the en half doesn't even show the Python requirement (zh-only section — a mirror gap).
- **zh/en halves have drifted apart in 8+ places**: the en half is missing the mascot feature blurb (v1.5.0's headline feature), the screenshots archive link, environment requirements, the dev-commands block, first-install tips, and the roadmap reference links.
- **Roadmap accuracy is good**: none of the "planned" items (streaming, CLI, whisper.cpp/SenseVoice, long-audio chunking, AI streaming) has shipped; the 11-provider table, artifact names, Homebrew/Winget "not yet upstream" honesty notes, and Node 22.5+ all check out.

## 2. Stale Facts

Severity: **high** = misleads users or contributors · **medium** = outdated numbers · **low** = cosmetic.

| #   | Claim (README)                                                                             | README line       | Reality                                                                                                                                                                                                                                                    | Source evidence                                                                                                                     | Severity                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tech stack "Electron 36" (zh + en)                                                         | 178, 320          | Electron **39.8.10**                                                                                                                                                                                                                                       | `package.json:89` (`"electron": "39.8.10"`); drift introduced by 67e4027 (2026-08-16)                                               | **high**                                                                                                                           |
| 2   | Roadmap done: "GPU 自动检测（CUDA > MPS > CPU）" / "GPU auto-detection (CUDA > MPS > CPU)" | 197, 339          | Auto-detect is **CUDA > CPU**; **MPS is intentionally skipped** (FunASR uses float64 in cif_predictor/complex_utils, unsupported on MPS)                                                                                                                   | `funasr_server.py:257-272` (`_detect_device` docstring + skipped-MPS branch)                                                        | **high** (tells Mac users to expect GPU acceleration that doesn't exist)                                                           |
| 3   | Roadmap done: "转录历史搜索（FTS5 全文搜索）" / "History search (FTS5 full-text)"          | 192, 334          | FTS5 virtual table + sync triggers **removed 2026-08-15**; search is renderer-side in-memory filtering                                                                                                                                                     | `src/helpers/database.ts:231-233` (`[20260815_Refactor_DeadIpc]`); `src/history.tsx:101-104` (`filteredTranscriptions` memo filter) | **high** (claims a specific technology that no longer exists)                                                                      |
| 4   | Build-from-source: "Python 3.8+（用于 FunASR）"                                            | 141               | `requires-python = ">=3.11"`; CI pins Python 3.11                                                                                                                                                                                                          | `pyproject.toml:6`; `.github/workflows/build.yml:67,253`; embedded env is python3.11 (`build.yml:107`)                              | **high** (followers on 3.8–3.10 fail at `uv sync`; note `funasr>=1.2.7` itself needs ≥3.8, but the repo's lock is 3.11-scoped)     |
| 5   | Dev commands: "pnpm test # 运行测试（1800+ tests，覆盖率 ~97%）"                           | 166               | Thresholds re-baselined 2026-09-07 to **88/83/88/89**; measured aggregate ≈88.4/84.0/88.6/89.0 with the six newly instrumented module groups included ("the previous 96/92/94/96 numbers … are unattainable with them instrumented")                       | `vitest.config.ts:79-92` (comment + thresholds)                                                                                     | **medium-high** (headline quality number is ~9 points high)                                                                        |
| 6   | Same line: "1800+ tests" attributed to `pnpm test`                                         | 166               | Static count: `tests/unit` ≈ **1738** `it(`/`test(` declarations; `tests/e2e` ≈ **62**. `pnpm test` runs unit only (`vitest.config.ts:8` excludes `tests/e2e/**`), so unit ≈1740; unit+E2E ≈1800. Claim is borderline — defensible only if E2E is included | grep count over `tests/` (2026-09-07); `vitest.config.ts:7-8`; package.json:34                                                      | **low-medium** (barely true, will rot again; CONTRIBUTING.md:129's "1800+" and notepad's "1823 unit" disagree with each other too) |
| 7   | Speech stack: "FunASR (Paraformer-large + FSMN-VAD + CT-Transformer)"                      | 180, 322          | Primary ASR model is **SeACo-Paraformer-large** (`damo/speech_seaco_paraformer_large_…`), with plain Paraformer-large kept as rollback; VAD + CT-Transformer punc correct                                                                                  | `funasr_server.py:335-336`, `:449`, `:479`; `download_models.py:175-184`                                                            | **low** (same model family; README slightly under-describes)                                                                       |
| 8   | Features/roadmap: file formats "wav/mp3/m4a/flac"                                          | 77, 191, 270, 333 | **7 formats** accepted: wav/mp3/m4a/flac/**ogg/wma/aac**                                                                                                                                                                                                   | `src/helpers/ipc-contracts.ts:120-128` (`AUDIO_EXTENSIONS`); `funasr_server.py:274` (`ALLOWED_EXTENSIONS`)                          | **low** (conservative under-promise; fine to leave, better to update)                                                              |
| 9   | Comparison table: "开源免费 / Open Source: macOS 原生听写 ✅"                              | 69, 262           | macOS Dictation is **proprietary** Apple software (free, bundled — but not open source)                                                                                                                                                                    | general knowledge; no repo source can support "✅"                                                                                  | **low** (comparison-table fairness/accuracy)                                                                                       |
| 10  | Provider table Base URLs                                                                   | 118-128           | All 11 providers exist and URLs are correct but abbreviated (e.g. Qwen omits `/compatible-mode/v1`, GLM omits `/api/paas/v4`, Ollama/LM Studio omit `http://` and `/v1`)                                                                                   | `src/helpers/providerPresets.ts:25-132`                                                                                             | **low** (app auto-fills the real URL, table says so)                                                                               |

Verified accurate (no action):

- **Node 22.5+** — `package.json:193` (`engines.node >=22.5`); CHANGELOG v1.5.0: "Node 22.5+ 成为运行与构建的硬要求". (But see §5: CONTRIBUTING.md:9 still says "Node.js 18+" — CONTRIBUTING is the wrong one.)
- **11 AI providers, count "11+"** — exactly 11 presets in `providerPresets.ts:25-132`; "11+" is fair given custom base URL support. All README rows match code names/labels.
- **Provider Quick Start guide exists** — `quickStart` key in `src/i18n/locales/en.json`; `快速开始` in `zh-CN.json`; rendered by settings UI.
- **Semi-auto update with SHA256** — `src/helpers/updateManager.ts:71,85-90`.
- **Hotkey `Cmd+Shift+Space` / `Ctrl+Shift+Space`** — `CommandOrControl+Shift+Space` default in `src/helpers/ipc/hotkeyHandlers.ts:118-124`.
- **i18n zh/en** — `src/i18n/locales/{zh-CN,en}.json`.
- **File config `~/.murmur.json`** — `src/helpers/fileConfig.ts:6`.
- **TypeScript strict + full-src coverage gate** — `tsconfig.json:8` (`strict: true`); `vitest.config.ts:27` (`include: ["src/**/*.{js,ts,tsx}"]`).
- **SQLite node:sqlite + safeStorage** — CHANGELOG v1.5.0 (spec #226); `build.yml:72-81` gate comment.
- **Mascot with Bot shape/color/expression settings** — `src/bot/` (engine/shape/expressions/…), settings keys `bot_shape/bot_color/bot_expression` at `src/settings/useSettings.ts:47-49`, settings UI `src/settings/sections/BotSection.tsx`.
- **~1GB first-run model download** — in-repo consistent (`build.yml:479` release body says "~1GB"); `download_models.py` downloads the three models at `download_models.py:175-184`.
- **Custom AI prompt templates** — `src/helpers/aiPrompts.ts:69` (`loadCustomTemplates`).
- **AI streaming NOT shipped** (roadmap correctly lists it as planned) — `src/helpers/ipc/aiHandlers.ts:321` (`stream: false`).
- **whisper.cpp / SenseVoice / real-time streaming / CLI mode NOT shipped** — no hits in `src/`, `main.ts`, `preload.ts`; only research docs mention them. Roadmap "planned" list is accurate.
- **Artifacts** — mac `Murmur-<version>-arm64.dmg` matches `dist/Murmur-1.0.3-arm64.dmg` etc.; arm64-only is correct (no x64/universal target in `package.json:159-166`, CI builds on arm64 `macos-latest`). Windows `Murmur.Setup.<version>.exe` matches the repo's own asset-name note (`docs/winget/Murmur.yaml:5`). Side note: `.github/workflows/build.yml:473` release template says `Murmur-Setup-*.exe` — the workflow's template is the internally inconsistent one, not README.
- **Homebrew/Winget "not yet upstream"** — still true: `docs/homebrew/murmur.rb:2-4` and `docs/winget/Murmur.yaml:2-4` both marked "DRAFT — NOT YET PUBLISHED"; last commit touching them 267aaa8 (2026-08-03).
- **Pip package list** (`funasr modelscope torch torchaudio librosa numpy`) — matches `package.json:18` exactly; and `modelscope`/`soundfile` arrive transitively via funasr in `uv.lock:378,385`, so the Option A `uv sync` flow works without listing them. No drift.
- **Link integrity** — every local link/asset resolves: `assets/icon.png`, `CONTRIBUTING.md`, `docs/promotion/screenshots/` (contains the 3 mentioned jpgs: `screenshot-macos.jpg`, `screenshot-xhs-mode.jpg`, `screenshot-windows-bug.jpg`), `docs/follow-ups.md`, `CHANGELOG.md`, `docs/strategic-plan-gap-analysis.md`, `LICENSE`, `.github/workflows/ci.yml` (badge target exists). Externals noted, not fetched: `TeFuirnever/Murmur`, `jeremy-prt/bloub`, `yan5xu/ququ`, `modelscope/FunASR`, `ui.shadcn.com`, star-history API.

## 3. zh/en Drift

The en half is a subset of zh. En-only content: none found. Drift items, ordered by impact:

1. **Mascot blurb missing in en** — zh Features has the bloub mascot blockquote (README:83, links the bloub repo, mentions 设置 → Bot). En Features (268-274) has no mascot mention at all. This is v1.5.0's headline user-facing feature.
2. **Screenshots archive link missing in en** — zh hero links 📦 产品截图存档 (README:43); en hero (238-244) has no equivalent.
3. **Environment requirements missing in en** — zh has "### 环境要求" (Node 22.5+, Python 3.8+) (README:138-141); en "Build from Source" (300-314) jumps straight to the code block. Consequence: en readers never see ANY Node/Python requirement.
4. **Dev-commands block missing in en** — zh README:162-170 has no en counterpart.
5. **First-install tips missing in en** — zh Gatekeeper/SmartScreen tips (README:101-104); en Install section omits them (they do exist in the release notes template, `build.yml:481`).
6. **Roadmap reference links missing in en** — zh links docs/follow-ups.md + CHANGELOG.md + strategic-plan snapshot note (README:210); en Roadmap (344-350) ends with no links.
7. **Hotkey detail** — zh roadmap item spells out `` `Cmd+Shift+Space` `` (193); en just says "Global hotkey" (335). Same for zh Quick Start showing both platform combos (109) vs en only macOS (295).
8. **Long-audio detail** — zh "（解决 10 分钟超时）" (207) dropped in en (349).
9. **Minor wording** — zh AI-polish tip names free-credit providers "DeepSeek / 硅基流动" (112); en names "(DeepSeek, Qwen, Ollama, etc.)" (298). zh hero "无需联网，无需上传" (9) vs en "all on your device" (242) — "zero upload" nuance softened.

## 4. Best-Practice Gaps (and what is already good)

### Gaps

1. **No embedded visual at all** — the hero demo GIF is still a commented-out TODO placeholder (README:31-36, tag dated 20260731 — now 5+ weeks old). Real screenshots exist (`docs/promotion/screenshots/screenshot-{macos,xhs-mode,windows-bug}.jpg`) but are only _linked_ in zh and hidden behind an archive caveat. The archive README itself warns the icons are stale post-Fox-rebrand (2026-07-29). Recommendation: either record the GIF (highest ROI, per the TODO's own note) or embed `screenshot-xhs-mode.jpg` (the one the archive marks "still valid") in both halves; otherwise delete the stale TODO comment debt.
2. **SECURITY.md exists but is unlinked** — `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/SECURITY.md` (vulnerability reporting policy: "do not report through public GitHub issues"). README convention is to surface it, typically one line under Contributing. Related flag (outside README): SECURITY.md's Supported Versions table lists only `1.0.x` — stale vs current v1.5.0.
3. **docs/faq.md and docs/troubleshooting.md are orphans from README's perspective** — both exist, both bilingual, neither is linked anywhere in README. Add a Support/FAQ line (in BOTH halves — which also repairs zh/en parity).
4. **Numbers-in-prose rot** — the test count comment has already churned 672 → 1400+ → 1800+ (412c7dc changed it again today), and "~97%" is now wrong. Recommend removing the coverage % from README (the dynamic CI badge was introduced precisely to avoid this rot — README:14-24) or phrasing as "coverage-gated in CI". Same disease in CONTRIBUTING.md:129 (still 96/92/94/96) — three docs, three numbers.
5. **CONTRIBUTING.md contradicts README on Node** — CONTRIBUTING.md:9 "Node.js 18+（推荐 22 LTS）" vs README:140 "Node.js 22.5+" vs `package.json:193` hard `>=22.5` (and CHANGELOG v1.5.0 calls it a hard requirement). README is right; CONTRIBUTING needs the fix. Same file also still says Python 3.8+ (CONTRIBUTING.md:11).
6. **Platform badge anchor is broken** — README:12 badge links `#安装`, but the GitHub slug for "## 🚀 安装" is `#-安装` (emoji becomes a leading hyphen). The zh roadmap link `#-路线图` (README:57) has it right. Cosmetic.
7. **Optional badge gap** — no "latest release" badge; nice-to-have for an install-first README. Current badge set (license, platform, CI, PRs welcome, stars) is otherwise appropriate, not bloated.

### Already good practice — do NOT "fix"

- **Honest positioning blockquote** ("不与系统听写竞争实时性…", README:57/250) and the fairness caveat under the comparison table (71/264) — rare and commendable.
- **Install honesty**: not advertising broken `brew`/`winget` commands, with an explanatory tag comment (87-99/278-290), matching the DRAFT status in the cask/manifest files.
- **Dynamic CI badge instead of hardcoded test/coverage badges**, with the rationale documented in-source (14-24).
- **Roadmap split into done/planned with dated evidence**, and strategic-plan file explicitly labeled a historical snapshot (210).
- **Bilingual single-file layout with anchors and language switcher** (29) is a legitimate pattern; the fix for §3 is completing the mirror, not restructuring.
- **Tag-comment discipline** (`[20260803_InstallHonesty]` etc.) follows the repo's own Change Annotation rules.

## 5. Prioritized Fix List

### P0 — factual, user/contributor-facing (one small commit)

1. README:178 + 320 — "Electron 36" → "Electron 39".
2. README:197 + 339 — "CUDA > MPS > CPU" → "CUDA > CPU (MPS intentionally skipped — FunASR float64 limitation)".
3. README:192 + 334 — drop "(FTS5 全文搜索)" / "(FTS5 full-text)"; "History search (in-app filtering) and export (TXT/SRT/VTT/Markdown/DOCX)" is the accurate phrasing (VTT also exists — `exportFormatters.ts:175` — and is currently unadvertised).
4. README:141 — "Python 3.8+" → "Python 3.11+" (`pyproject.toml:6`). Mirror fix in CONTRIBUTING.md:11; while there, fix CONTRIBUTING.md:9 "Node.js 18+" → "Node.js 22.5+".
5. README:166 — refresh or de-number: e.g. `pnpm test  # 单元测试（另有 60+ E2E，见 CI 门禁）`, and drop "~97%" (CI badge covers quality signal).

### P1 — zh/en parity + docs linkage (one commit)

6. Port to en: mascot blurb (from README:83), first-install tips (101-104), environment requirements (138-141), dev commands (162-170), roadmap reference links (210), screenshots link (43).
7. Add to both halves: one-line links to `docs/faq.md`, `docs/troubleshooting.md`, and `SECURITY.md` (under Install / Contributing).
8. Align test/coverage numbers across README ↔ CONTRIBUTING.md:129 ↔ `vitest.config.ts` thresholds (single source of truth: vitest.config).

### P2 — cosmetic / optional

9. Comparison table: macOS Dictation "开源免费 ✅" → "免费 ✅ / Open Source ❌" (69, 262).
10. Feature rows: mention 7 supported audio formats (or leave as conservative under-promise); optionally note SeACo-Paraformer in the speech stack row.
11. Fix badge anchor `#安装` → `#-安装` (12); optionally add a release badge.
12. Record or remove the 5-week-old hero GIF TODO (31-36); embed at least one screenshot in both halves.
13. Out-of-README flags for the owner: `build.yml:473` release template says `Murmur-Setup-*.exe` (actual: `Murmur.Setup.<version>.exe`); `SECURITY.md` Supported Versions lists only 1.0.x; `pyproject.toml` name/description still "ququ"/"Add your description here".
14. Roadmap content judgment call: current in-flight work (Spec #259 test instrumentation, Spec #193 T13-T15 AI polish internals, Spec #266 five-level tests) is internal/test-facing and correctly absent from the user-facing roadmap — no change recommended. v1.5.0's bloub mascot is already advertised in zh Features (once the en mirror lands, parity is restored). Nothing shipped recently is missing from the roadmap.

---

## Industry Benchmark (2026-09-07 addendum)

<!-- [20260907_Audit_ReadmeIndustryBenchmark] Supplement to the audit above.
     Compares Murmur's README against primary-source README guides and the
     actual READMEs of five successful same-genre projects (fetched 2026-09-07
     from raw.githubusercontent.com; star counts via GitHub API same day).
     Read-only addendum: does not modify the audit sections above. -->

### B1. Sources (all fetched 2026-09-07)

Guides:

- **standard-readme spec** — https://github.com/RichardLitt/standard-readme/blob/main/spec.md (6,359★)
- **GitHub official docs, "About READMEs"** — https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes
- **opensource.guide, "Starting a project"** (GitHub's own guide) — https://opensource.guide/starting-a-project/
- **Make a README** (makeareadme.com) — https://www.makeareadme.com/

Project READMEs (raw file fetched; stars via GitHub API 2026-09-07):

| Project               | Stars   | License    | Why chosen                                                       |
| --------------------- | ------- | ---------- | ---------------------------------------------------------------- |
| ggerganov/whisper.cpp | 53,489  | MIT        | local ASR, closest engine genre                                  |
| localsend/localsend   | 90,247  | Apache-2.0 | cross-platform desktop app                                       |
| chidiwilliams/buzz    | 21,358  | MIT        | desktop Whisper GUI for Mac/Win — most genre-identical to Murmur |
| ollama/ollama         | 180,331 | MIT        | local AI runtime                                                 |
| modelscope/FunASR     | 20,205  | MIT        | Murmur's upstream ASR; zh-origin bilingual benchmark             |

Unreachable/substituted: none — all planned sources fetched. Matteo Collina / Google OSS docs were optional and skipped since the four guides above already cover every needed norm.

### B2. Practice matrix

"1st-screen visual" = any image (banner/logo/GIF/screenshot) rendered before the reader scrolls.

| Dimension                            | whisper.cpp                          | localsend                                                 | buzz                                                                        | ollama                             | FunASR                                                 | **Murmur**                                                           | Norm (source)                                                                                                                                                |
| ------------------------------------ | ------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1st-screen visual                    | banner                               | no (logo absent; screenshots section later)               | banner + badge row                                                          | logo                               | banner                                                 | **none — commented-out GIF TODO**                                    | "Visuals… screenshots or a video" suggested section (makeareadme); 5/5 projects ship ≥1 image                                                                |
| Embedded screenshots anywhere        | n/a                                  | yes (2 webp)                                              | yes (gallery)                                                               | no                                 | no                                                     | **linked only, zh-half only**                                        | norm for GUI apps: embed (localsend, buzz)                                                                                                                   |
| Badges                               | 5 (license, release, CI, conan, npm) | 3 (CI, Weblate, Repology)                                 | 5 (license, CI, codecov, release, downloads)                                | **0**                              | 6-7 (PyPI, stars, downloads, docs, …)                  | **5 (license, platform, CI, PRs, stars)**                            | 3-6 typical; license+CI+release are the common trio                                                                                                          |
| Per-OS install / package managers    | build-from-source + conan/docker     | full per-OS table (winget/scoop/choco/brew/flathub/…)     | per-OS: dmg, exe + unsigned warning, flatpak/snap/AppImage, pip + GPU flags | curl/psp one-liners + brew/docker  | pip (+ from-source collapsible)                        | GitHub-Releases-only + honest "brew/winget not yet upstream" note    | per-OS present in 5/5; honesty notes have a direct parallel (buzz's unsigned-Windows warning)                                                                |
| Quick Start / Usage                  | yes (4 code blocks)                  | build-focused + CLI                                       | **no usage section**                                                        | "Get started"                      | yes (runnable examples)                                | yes (30 秒上手 / Quick Start, both halves)                           | present in 4/5 + both guides require Usage (standard-readme)                                                                                                 |
| Features section                     | bullet list, no heading              | About                                                     | yes                                                                         | no                                 | "Why FunASR?"                                          | yes (both halves)                                                    | common but optional                                                                                                                                          |
| FAQ / Troubleshooting                | no (Discussions FAQ link)            | Troubleshooting table                                     | FAQ link (docs site)                                                        | no                                 | no                                                     | **files exist (`docs/faq.md`, `docs/troubleshooting.md`), unlinked** | "where to get help" is one of GitHub's five README topics; makeareadme lists a Support section                                                               |
| Contributing section/link            | no                                   | yes                                                       | no                                                                          | no (points to docs/development.md) | yes                                                    | yes (both halves, links CONTRIBUTING.md)                             | **required** by standard-readme                                                                                                                              |
| License section last                 | badge only                           | no section                                                | no section                                                                  | no section                         | yes, near-last                                         | **yes, last in both halves**                                         | "Must be last section" (standard-readme) — Murmur complies                                                                                                   |
| Bilingual handling                   | single, en-only                      | **separate** `support/readme/README_ZH.md` + top switcher | **separate** `readme/README.zh_CN.md` + top switcher                        | single, en-only                    | **separate** `README_zh.md` + ja/ko, top switcher line | **one file, zh+en stacked, anchor switcher**                         | spec: "Where there are multiple languages, `README.md` is reserved for English" + BCP-47 filename; 4/4 multilingual-capable projects in this set split files |
| Competitor table w/ self-rated stars | no                                   | no                                                        | no                                                                          | no                                 | no (only factual benchmark tables + one textual claim) | **yes — ⭐⭐⭐⭐⭐ self-grade vs competitors**                       | 0/5 projects; no guide endorses graded self-comparison                                                                                                       |
| TOC                                  | no                                   | **yes**                                                   | no                                                                          | no                                 | partial nav line                                       | **no**                                                               | spec: required "optional for READMEs shorter than 100 lines"                                                                                                 |
| Length                               | ~1,000 lines                         | ~300                                                      | ~100                                                                        | ~350-400                           | ~330                                                   | **364 total (~182 per language)**                                    | 100-1,000 observed; "too long is better than too short" (makeareadme)                                                                                        |

### B3. Confirmed gaps (benchmark says below norm)

1. **Zero embedded media — the single largest deviation. Severity: high.** Every one of the five benchmark projects renders at least one image in the first screenful, and the two GUI-app projects (localsend, buzz) embed actual product screenshots (localsend §"Screenshots", buzz banner + gallery). makeareadme names "Visuals" a suggested section and notes "you'll frequently see GIFs rather than actual videos". Murmur's hero is a commented-out TODO and its real screenshots are _linked_ (zh half only). For a GUI desktop app this is below the observed floor, not merely below best practice. (Upgrades audit §4.1 / §5.12.)
2. **Self-rated ⭐ comparison table. Severity: medium.** None of the five projects self-rates against competitors; FunASR — the closest thing to a vendor-adjacent comparison in the set — restricts itself to a factual textual claim ("~3× lower CER than whisper.cpp on Chinese"), not graded stars. makeareadme's guidance for competition is prose: "list[ing] differentiating factors" in the Description. GitHub's docs scope the README to "information necessary for developers to get started using and contributing". A ⭐⭐⭐⭐⭐ self-grade table is outside observed practice, and one of its cells is factually wrong (macOS Dictation marked open-source, audit §2 #9).
3. **Help/FAQ/troubleshooting not linked. Severity: medium.** GitHub's official README topics explicitly include "where can I get more help"; opensource.guide's four questions include the same; makeareadme lists "Support". Murmur has both files and links neither, in either half. (Adds citation backing to audit §4.3.)
4. **SECURITY.md unlinked. Severity: low-medium.** GitHub's About-READMEs page groups the README with "contribution guidelines, and a code of conduct" as the files that set expectations (it does not itself mention SECURITY); opensource.guide says for community files: "link to it from your README", and its pre-launch checklist requires README + CONTRIBUTING + CODE_OF_CONDUCT. Murmur links CONTRIBUTING but not SECURITY. (Adds citation backing to audit §4.2.)
5. **No TOC at 364 lines. Severity: low.** standard-readme: TOC "Required; optional for READMEs shorter than 100 lines". Murmur is 364 lines (182 per language) with no TOC; only localsend of the five has one, and GitHub's auto-generated heading outline partially mitigates — hence low, and moot if the file is split (B5).

### B4. Already at/above norm — do NOT "fix"

- **Badge set (5).** Within the observed 0-6 range; the common trio is license + CI + release (whisper.cpp, buzz). Murmur covers license + CI; only the release badge is a conventional addition. Note ollama ships _zero_ badges at 180k stars — badges are convention, not table stakes.
- **CI badge, and the dynamic-badge rationale.** whisper.cpp, localsend and buzz all ship CI badges; Murmur's refusal to hardcode test/coverage numbers (tag comment 14-24) is _ahead_ of the norm — benchmark confirms numbers-in-prose rot (audit §4.4) is avoided industry-wide by exactly this approach.
- **License as the last section.** Murmur complies with standard-readme's "Must be last section"; 3 of 5 big projects don't even have a License section.
- **Contributing section.** Required by standard-readme, present in both halves, linked to CONTRIBUTING.md. (But fix CONTRIBUTING's own Node/Python drift per P0 #4.)
- **Install honesty notes.** The "brew/winget not yet upstream" block has a direct parallel: buzz tells Windows users the binary is unsigned and gives a "Run anyway" workaround. Honest caveat-instead-of-broken-instruction is accepted practice, not a wart.
- **Project status section (项目状态).** Matches makeareadme's suggested "Project status" section; none of the five projects has one.
- **Roadmap done/planned split with dated evidence.** Exceeds the norm — only makeareadme even lists "Roadmap" as suggested; none of the five ships one.
- **Length.** ~182 lines per language sits mid-range of the observed 100-1,000; makeareadme: "too long is better than too short". Do not cut content for brevity.
- **Relative links throughout.** GitHub docs: "we recommend using relative links to refer to other files within your repository" — Murmur's local links are all relative and resolve (audit §2 link-integrity check).

### B5. Bilingual verdict: split into `README.md` + `README.zh-CN.md`

The benchmark is unambiguous on this point:

- **standard-readme spec** (normative): "Where there are multiple languages, `README.md` is reserved for English", files named per BCP 47 (`README.zh-CN.md`), section titles translated. The spec repo itself ships `README.md` + `README.zh-CN.md`.
- **FunASR** (Murmur's upstream, zh-origin): separate `README.md` / `README_zh.md` / `README_ja.md` / `README_ko.md`, each opening with a one-line switcher — e.g. `([English](./README.md)|简体中文|[日本語](./README_ja.md)|[한국어](./README_ko.md))` — with the current language unlinked.
- **buzz**: `readme/README.zh_CN.md`, switcher `[简体中文]` at top.
- **localsend**: `support/readme/README_ZH.md`, switcher row at top.

That is 4/4 multilingual-capable projects in this set using separate files with a top switcher; zero use one stacked bilingual file. The single-file layout is also the _root cause_ of audit §3: with zh and en interleaved in one file, every edit must be made twice in different places, and the en half has already fallen behind in 8+ spots. Recommendation:

- **Short term (this week):** keep P1 #6 — complete the en mirror — since parity must be restored before any split or the en file would be born stale.
- **Medium term (one follow-up commit):** split into `README.md` (English, full) + `README.zh-CN.md` (Chinese, full), each starting with FunASR-style switcher links, per the spec's `README.md`-is-English rule. This makes each language page clean (no anchor jumps), gives each half its own heading outline, and makes drift mechanically visible in diffs.
- If the owner prefers to keep one file, the minimum is to keep the anchor switcher and treat audit §3's parity items as a standing gate — but that is below the convention every examined project follows.

### B6. Self-rating comparison table verdict: not supported by industry practice

No benchmarked project — including FunASR, which competes with whisper.cpp directly — publishes a competitor table with graded self-ratings. The guides' collective advice stops at prose differentiation (makeareadme: differentiating factors in the Description) and factual comparison (FunASR's single quantified CER claim). GitHub's docs additionally scope README content to "information necessary for developers to get started using and contributing". Combined with the factual error the audit already found (macOS Dictation marked open-source, §2 #9), the graded table is a credibility liability disproportionate to its marketing value. Recommendation: keep the table (it is genuinely useful for a crowded tool category) but **replace the ⭐ grades with verifiable cells** — price, local/offline, open-source yes/no, supported models, platform — and let readers draw the ranking. Keep the existing fairness caveat either way. This refines P2 #9: the fix is no longer just the one Dictation cell but de-grading the whole table.

### B7. Updated prioritized fix list (benchmark-driven changes only)

P0 items 1-5 of the main audit are unaffected by benchmark evidence — stale facts must be fixed regardless. Changes and additions:

- **P1 (upgraded from P2 #12): embed hero visual.** Record the demo GIF or embed `screenshot-xhs-mode.jpg` in the first screenful of _both_ language pages. Evidence: B3.1 — 5/5 projects ship a first-screen image; GUI-app peers embed product screenshots; makeareadme lists Visuals. This is the highest-ROI item in the whole audit for a desktop GUI app.
- **P1 #7 (strengthened): link `docs/faq.md`, `docs/troubleshooting.md`, `SECURITY.md`.** Now guide-backed by GitHub's "where to get help" topic, opensource.guide's checklist, and makeareadme's Support section (B3.3, B3.4) — not merely a nicety.
- **P1 → new medium-term item: bilingual split** per B5 (after P1 #6 parity restoration). `README.md` = English, `README.zh-CN.md` = Chinese, top switcher, per standard-readme naming.
- **P2 #9 (expanded): de-grade the comparison table** — replace ⭐⭐⭐⭐⭐ cells with factual attributes (B6), not just fix the macOS Dictation cell.
- **P2 (new, optional): add a TOC** if the single-file layout is retained (364 lines > 100-line exception; standard-readme). Falls away if files are split.
- **P2 #11 (validated, unchanged): add a release badge** — release/version badges are part of the common trio (whisper.cpp, buzz).
- **Confirmed no-action:** badge pruning (set is already lean), content cuts for length, removing the honest install caveats, restructuring sections away from the standard order (Murmur already ends with License and carries Contributing, both required by standard-readme).
