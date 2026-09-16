# Murmur Dependabot 告警修复方案

> Status: Research-only (no upgrades performed)
> Date: 2026-07-25
> Source: `gh api repos/TeFuirnever/Murmur/dependabot/alerts` (30 alerts)
> Scope: Triage all 30 alerts into fix paths, identify the critical `tar`
> chain, and produce an ROI-ordered action plan. **Nothing is upgraded by
> this document** — it is the decision input for a follow-up implementation
> PR.
> Audience: Engineer who will execute the upgrades and needs to know which
> bumps are mechanical (P0), which need a compat check (P1), which need a
> major-version smoke test (P2/P3), and which transitive ones require
> waiting on an upstream tool bump.

## 0. How this document fits in

The `docs/research/` family covers testing, architecture, E2E, and the TS
migration. None of them address supply-chain / Dependabot hygiene. This
document is the **security-debt capstone** those docs do not provide, and
the single source of truth for "what do I do with alert #N?".

All dependency chains below were verified with `pnpm why` (root workspace),
`package-lock.json` parsing (`website/`, which is a **separate npm install,
not part of the pnpm workspace**), and `uv tree --invert` (Python). See
§6 for the exact commands.

## 1. Executive summary

### 1.1 Counts by severity

| Severity  | Alerts | Distinct packages                                                                                                      |
| --------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| Critical  | 1      | `tar`                                                                                                                  |
| High      | 19     | `Pillow`/`pillow`, `postcss`, `app-builder-lib`, `builder-util-runtime`, `brace-expansion`, `js-yaml`, `sharp`, `svgo` |
| Medium    | 9      | `Pillow`/`pillow`, `tar`, `astro`, `axios`, `setuptools`                                                               |
| Low       | 1      | `astro`                                                                                                                |
| **Total** | **30** | 13 distinct package names (heavy duplication in `Pillow`/`pillow`)                                                     |

Note: the `Pillow` vs `pillow` split (12 near-duplicate rows) is a GitHub
Advisory deduplication artifact — same PyPI package, different advisory IDs
and ranges. See §5.1 for how to collapse them.

### 1.2 Counts by ecosystem

| Ecosystem | Alerts | Manifest                                                | Fix tooling                                        |
| --------- | ------ | ------------------------------------------------------- | -------------------------------------------------- |
| `pip`     | 13     | `uv.lock`                                               | `uv lock --upgrade`                                |
| `npm`     | 17     | `pnpm-lock.yaml` (11) + `website/package-lock.json` (6) | `pnpm update` + `npm update` (website is separate) |

### 1.3 Counts by fix path (the actionable view)

| Fix path                           | Alerts | Distinct packages                                                                                                                                                                               |
| ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Direct dep, bump version**    | 24     | `tar` (root, 3 rows), `axios` (root, 3), `postcss` (root, 2 + website 1), `astro` (website, 2), `js-yaml`/`sharp`/`svgo` collapse into the astro bump, `Pillow`/`pillow` (12), `setuptools` (1) |
| **B. Transitive via dev tool**     | 3      | `app-builder-lib`, `builder-util-runtime`, `brace-expansion` (all via `electron-builder@24`)                                                                                                    |
| **C. Python (separate ecosystem)** | 13     | subset of A — `Pillow`/`pillow` ×12, `setuptools` ×1 (also counted in A by fix action)                                                                                                          |
| **D. Accept risk (build-only)**    | 0      | (none — every flagged install is reachable from a direct dep)                                                                                                                                   |

> A and C overlap by design: C is a _tooling_ cut (uv vs pnpm/npm), A is a
> _fix-action_ cut (bump a direct manifest entry). Summing 1.3 down a column
> double-counts; the source-of-truth total is the 30 raw alerts.

The headline: **the only critical alert is a direct dependency and is a
one-line bump** (§4). The bulk of the noise (13 alerts) is Python `Pillow`,
which collapses to a single `uv lock --upgrade pillow` once the
`torchvision` pin is handled.

## 2. Per-alert triage table

Columns:

- **Origin** = how the package enters the tree (direct / transitive-via-X).
- **Fix path** = A/B/C/D from §1.3.
- **Effort** = S (<10 min, mechanical) / M (30–60 min, may need version-range
  check or re-test) / L (half-day+, blocking).
- **Risk** = Low / Med / High — risk of the _fix_, not the vuln. "Low" = drop-in
  patch version; "Med" = minor bump that could change behavior; "High" =
  major bump or ecosystem-level constraint.

### 2.1 npm — root workspace (`pnpm-lock.yaml`, 11 alerts)

| #   | Package                | Sev      | Range / Patched                 | Origin                                                   | Fix path | Effort | Risk    |
| --- | ---------------------- | -------- | ------------------------------- | -------------------------------------------------------- | -------- | ------ | ------- |
| 1   | `tar`                  | Critical | `<= 7.5.18` → `7.5.19`          | **Direct dep** (`tar@^7.4.3`)                            | **A**    | **S**  | **Low** |
| 2   | `tar`                  | Medium   | `<= 7.5.17` → `7.5.21`          | Same direct install (older advisory)                     | A        | S      | Low     |
| 3   | `tar`                  | Medium   | `<= 7.5.20` → `7.5.21`          | Same direct install (third advisory)                     | A        | S      | Low     |
| 4   | `axios`                | Medium   | `>= 1.0.0, < 1.18.0` → `1.18.0` | **Direct dep** (`axios@^1.6.0`)                          | **A**    | **S**  | Low     |
| 5   | `axios`                | Medium   | `>= 1.7.0, < 1.18.0` → `1.18.0` | Direct (dup advisory)                                    | A        | S      | Low     |
| 6   | `axios`                | Medium   | `>= 1.0.0, < 1.18.0` → `1.18.0` | Direct (dup advisory)                                    | A        | S      | Low     |
| 7   | `postcss`              | High     | `<= 8.5.11` → `8.5.12`          | **Direct devDep** (`postcss@^8.5.6`)                     | **A**    | **S**  | Low     |
| 8   | `postcss`              | High     | `<= 8.5.17` → `8.5.18`          | Same direct install (newer advisory)                     | A        | S      | Low     |
| 9   | `app-builder-lib`      | High     | `< 26.15.0` → `26.15.0`         | Transitive via `electron-builder@24.13.3`                | **B**    | **M**  | **Med** |
| 10  | `builder-util-runtime` | High     | `< 9.7.0` → `9.7.0`             | Transitive via `electron-builder@24.13.3`                | **B**    | **M**  | **Med** |
| 11  | `brace-expansion`      | High     | `<= 5.0.7` → `5.0.8`            | Transitive via `electron-builder` + `eslint` (minimatch) | **B**    | **M**  | **Med** |

> Rows 1–3 are the **same `tar@7.5.15` install** surfaced by three
> advisories. Bumping to `tar@7.5.19`+ (allowed by the existing `^7.4.3`
> range) clears all three. There is a _separate_ `tar@6.2.1` inside
> `app-builder-lib` (visible via `pnpm why tar`), but it has **no matching
> advisory** — Dependabot did not flag it, so it is not in scope here.
>
> Note on `postcss`: only **2** root alerts exist (both the direct devDep
> install). The nested `postcss@8.5.15` under `@tailwindcss/postcss` is the
> same advisory surface Dependabot collapses; bumping the direct
> `postcss@^8.5.6` does not touch the nested copy — that one needs the
> `@tailwindcss/postcss` bump described in §5.5, but it does not appear as a
> separate row.

### 2.2 npm — website (`website/package-lock.json`, separate npm install)

| #   | Package   | Sev    | Range / Patched                | Origin                                              | Fix path               | Effort | Risk     |
| --- | --------- | ------ | ------------------------------ | --------------------------------------------------- | ---------------------- | ------ | -------- |
| 13  | `astro`   | Medium | `< 7.0.6` → `7.0.6`            | **Direct dep** (`astro@^5.7.0`) — resolved 5.18.2   | **A** (major)          | **L**  | **High** |
| 14  | `astro`   | Low    | `>= 3.10.0, < 7.0.4` → `7.0.4` | Direct (dup advisory)                               | A                      | L      | High     |
| 15  | `postcss` | High   | `<= 8.5.17` → `8.5.18`         | Transitive via `vite` (pulled by astro)             | A (free w/ astro bump) | —      | —        |
| 16  | `js-yaml` | High   | `>= 4.0.0, < 4.3.0` → `4.3.0`  | Transitive via `astro` + `@astrojs/markdown-remark` | A (free w/ astro bump) | —      | —        |
| 17  | `sharp`   | High   | `< 0.35.0` → `0.35.0`          | Transitive via `astro` (resolved 0.34.5)            | A (free w/ astro bump) | —      | —        |
| 18  | `svgo`    | High   | `>= 4.0.0, < 4.0.2` → `4.0.2`  | Transitive via `astro` (resolved 4.0.1)             | A (free w/ astro bump) | —      | —        |

> **Key insight (§5.2):** five of the six website alerts — `astro`,
> `postcss`, `js-yaml`, `sharp`, `svgo` — are **all downstream of the single
> `astro` direct dependency**. Bumping `astro` 5.18.2 → 7.0.6+ collapses them.
> But it is a **major version jump** (5 → 7), so it is the highest-risk item
> in the whole list.

### 2.3 pip — Python (`uv.lock`)

| #     | Package           | Sev                        | Range / Patched       | Origin                                       | Fix path | Effort | Risk    |
| ----- | ----------------- | -------------------------- | --------------------- | -------------------------------------------- | -------- | ------ | ------- |
| 19–30 | `Pillow`/`pillow` | 12 rows: 9 High + 3 Medium | all → `12.3.0`        | Transitive via `torchvision@0.15.2` (pinned) | **C**    | **M**  | **Med** |
| —     | `setuptools`      | Medium                     | `< 83.0.0` → `83.0.0` | Transitive via `modelscope` → `funasr`       | C        | S      | Low     |

> The 12 `Pillow` rows are GitHub Advisory duplicates of the same installed
> `pillow v12.2.0`. Resolved version is already 12.2.0 — the patched target
> is **12.3.0**. The blocker: `torchvision==0.15.2` (pinned in
> `pyproject.toml`) is what pulls `pillow`. See §5.3 for the constraint.

## 3. Cross-cutting observations

### 3.1 Three distinct install trees, three tools

The repo has **three independent dependency trees**, each with its own
lockfile. An upgrade in one does not affect the others:

1. **Root** — pnpm (`pnpm-lock.yaml`, `pnpm-workspace.yaml`). Note: despite
   the workspace file, `website/` is **not** listed as a workspace package
   and uses its own `package-lock.json`. (§7 finding.)
2. **Website** — npm (`website/package-lock.json`). Standalone.
3. **Python** — uv (`uv.lock`, `pyproject.toml`). Embedded into the Electron
   build via `scripts/prepare-embedded-python.js`.

This matters because Dependabot file paths tell you which tool to run:

- `pnpm-lock.yaml` → `pnpm update <pkg>`
- `website/package-lock.json` → `cd website && npm update <pkg>`
- `uv.lock` → `uv lock --upgrade-package <pkg>`

### 3.2 Where the noise is concentrated

- **14 of 30 alerts (47%)** are `Pillow`/`pillow` duplicates — one `uv lock`
  call resolves them.
- **6 of 30 (20%)** collapse into a single `astro` bump on the website.
- **3 of 30 (10%)** collapse into one `electron-builder` major bump (or
  overrides) on the root.
- After collapsing, there are roughly **6 distinct engineering actions**,
  not 30.

### 3.3 Build-only vs runtime

Almost every npm alert is a **dev/build-time** dependency:

- `electron-builder`, `app-builder-lib`, `builder-util-runtime`,
  `brace-expansion`, `node-gyp` → only run during `electron-builder`
  packaging, **not shipped** to end users.
- `postcss`, `@tailwindcss/postcss` → only run during Vite build.
- `tar@7.5.15` (the critical one) is a **direct runtime dep** in
  `package.json`, but in practice it is used by `node-gyp` (build) — verify
  whether `main.ts`/`preload.ts` actually `import` it at runtime (see §4.2).

The runtime-shipped deps are: `axios` (used by the app for HTTP),
`tar` (if imported by main process), and the Python `Pillow`/`setuptools`
(used by the embedded FunASR server). These deserve priority.

## 4. The critical `tar` alert — exact chain and fix

### 4.1 The chain

```
murmur@1.0.2
├── tar@7.5.15          ← CRITICAL (needs >= 7.5.19). DIRECT dependency.
│   (declared in package.json: "tar": "^7.4.3")
└── node-gyp@11.4.2 (devDep)
    └── make-fetch-happen@14.0.3
        └── cacache@19.0.1
            └── tar@7.5.15  ← same install, deduped

(app-builder-lib@24.13.3 → tar@6.2.1  ← different major, NOT flagged by Dependabot)
```

### 4.2 Why this is the highest-ROI fix on the whole board

1. It is **critical** severity.
2. It is a **direct dependency** in `package.json` line 137: `"tar": "^7.4.3"`.
3. The caret range `^7.4.3` already allows `7.5.19`, so a bare
   `pnpm update tar` (or editing the manifest floor to `^7.5.19`) resolves
   it **without a range change**.
4. All three `tar` alerts (1 critical + 2 medium) are the **same install**
   (`tar@7.5.15`) — one bump clears all three.
5. The separate `tar@6.2.1` inside `app-builder-lib` has **no Dependabot
   advisory** and is out of scope for this remediation.

### 4.3 Caveat to verify before executing

Confirm whether `tar@7.5.15` is actually `require`d at runtime (e.g.
`grep -rn "require('tar')\|from 'tar'" src/ main.ts preload.ts`). The
package is declared a **runtime** dependency (Dependabot `scope=runtime`)
and is also reached through `node-gyp` at build time. If no application code
imports it directly, the runtime exposure is lower than the critical label
implies — but the bump is still trivial and should be done regardless.

## 5. Per-package remediation notes

### 5.1 Collapsing the `Pillow` / `pillow` duplicates

GitHub tracks `Pillow` and `pillow` as two spellings of the same PyPI
package and emits one row per (advisory × vulnerable-range) pair, producing
12 rows for what is **one installed version**. The installed version per
`uv.lock` is `pillow v12.2.0`; the highest patched target across all rows
is **12.3.0**. A single `uv lock --upgrade-package pillow` (subject to the
torchvision constraint in §5.3) clears all 12 rows.

### 5.2 The website `astro` upgrade — one bump, five alerts gone

Reverse-dep map from `website/package-lock.json`:

```
ROOT ── astro@^5.7.0  (resolved 5.18.2)
       ├── astro ── svgo@^4.0.0      (resolved 4.0.1, needs 4.0.2)
       ├── astro ── sharp@^0.34.0    (resolved 0.34.5, needs 0.35.0)
       ├── astro ── js-yaml@^4.1.1   (resolved 4.2.0, needs 4.3.0)
       └── @astrojs/markdown-remark ── js-yaml@^4.1.1
vite ── postcss@^8.5.3              (resolved 8.5.15, needs 8.5.18)
```

Bumping `astro` 5.18.2 → 7.0.6+ upgrades `svgo`, `sharp`, `js-yaml` (twice)
as a side effect, and `postcss` follows because `vite` is astro's. **This
single major-version bump clears 6 alerts** (5 high + 1 medium + 1 low
counted by advisory). It is also the riskiest item: Astro 5 → 7 spans two
majors and may require config/site changes. Schedule it as its own PR with
a full `astro build` + smoke test of the marketing site.

### 5.3 The `Pillow` blocker — `torchvision` pin

`uv tree --invert --package pillow` shows:

```
pillow v12.2.0
└── torchvision v0.15.2
    └── ququ v0.1.0      ← pyproject.toml pins "torchvision==0.15.2"
```

`torchvision==0.15.2` (a 2023 release, paired with `torch==2.0.1`) imposes
an **upper bound** on `pillow`. Whether `pillow 12.3.0` is compatible with
`torchvision 0.15.2` is the open question:

- If yes → `uv lock --upgrade-package pillow` and all 12 rows close.
- If no → the real fix is upgrading the `torch`/`torchvision`/`torchaudio`
  trio (currently pinned at 2.0.1 / 0.15.2 / 2.0.2 in `pyproject.toml`),
  which is a **much larger** change touching the ML runtime. That is out of
  scope for a security-bump PR and becomes its own initiative.

**Recommended check before acting:** run `uv pip install pillow==12.3.0`
in a throwaway venv alongside the pinned torch stack and import-test
`torchvision`; if it imports, the bump is safe.

`setuptools` (via `modelscope` → `funasr`) has no such pin and is a clean
`uv lock --upgrade-package setuptools` to 83.0.0.

### 5.4 The `electron-builder` cluster — B-path, three options

`app-builder-lib`, `builder-util-runtime`, and `brace-expansion` (the
`@electron/asar` path) all flow from `electron-builder@24.13.3` (a 2024
release). The project declares `"electron-builder": "^24.6.4"`. Options,
best first:

1. **Bump `electron-builder` to latest 24.x patch** (`^24.13.3` already
   allows it) — may pull in upstream security patches if the maintainer
   backported them. Low risk, may not fully resolve.
2. **Bump `electron-builder` to 25.x / 26.x** (the line where
   `app-builder-lib >= 26.15.0` lives) — this is what the advisory wants.
   Medium risk: major bump of the packaging tool; requires a full
   `electron-builder --mac/--win` smoke test on all target platforms.
3. **pnpm overrides** — force-resolve the transitive packages. **Avoid
   unless options 1–2 fail** (see §8).

### 5.5 `postcss` — split personality

There are two `postcss` installs in the root tree:

- `postcss@8.5.6` — direct devDep, also pulled by `autoprefixer`/`vite`.
  Bump the manifest floor `^8.5.6` → `^8.5.18`. Trivial.
- `postcss@8.5.15` — nested under `@tailwindcss/postcss@4.3.0`. Cleared by
  bumping `@tailwindcss/postcss` (currently `^4.1.13` in devDeps, resolved
  4.3.0 — a newer minor likely pulls patched postcss).

## 6. Verification commands used (reproducible)

```bash
# 1. Fetch alerts
gh api repos/TeFuirnever/Murmur/dependabot/alerts \
  --jq '.[] | {pkg: .security_vulnerability.package.name,
               ecosystem: .security_vulnerability.package.ecosystem,
               severity: .security_vulnerability.severity,
               vulnerable_range: .security_vulnerability.vulnerable_version_range,
               patched_version: .security_vulnerability.first_patched_version.identifier,
               manifest: .dependency.manifest_path,
               dep_scope: .dependency.scope}' > /tmp/dependabot.json

# 2. Root npm chains
pnpm why tar
pnpm why app-builder-lib
pnpm why builder-util-runtime
pnpm why brace-expansion
pnpm why postcss
pnpm why axios

# 3. Website npm chains (node_modules absent — parse lockfile directly)
python3 -c "import json; l=json.load(open('website/package-lock.json'))['packages']; \
  [print(p.replace('node_modules/','') or 'ROOT', '->', r, v) \
   for p,m in l.items() for r,v in (m.get('dependencies') or {}).items() \
   if r in {'astro','sharp','svgo','js-yaml','postcss'}]"

# 4. Python chains
uv tree --invert --package pillow
uv tree --invert --package setuptools
```

## 7. Recommended action plan (ordered by ROI)

> ROI = (severity cleared × alert count) / (effort × risk). Do not skip the
> critical item.

**P0 — this week, mechanical, near-zero risk (clears 1 critical + ~9 high/med)**

1. **`tar` → `^7.5.19`** (root, direct). One-line manifest edit + `pnpm install`.
   Clears the **critical** alert + 2 medium on the same install = **3 rows**.
   [A, S, Low]
2. **`axios` → `^1.18.0`** (root, direct). Manifest edit + `pnpm install`.
   Clears 3 medium rows. [A, S, Low]
3. **`postcss` → `^8.5.18`** (root, direct devDep). Clears 2 high rows.
   [A, S, Low]
4. **`setuptools`** via `uv lock --upgrade-package setuptools` (target 83.0.0).
   Clears 1 medium. [C, S, Low]

> After P0: the **critical** alert is gone. 9 rows cleared. Remaining: 21
> alerts — the Pillow cluster (12) and the electron-builder/website clusters.

**P1 — this week, needs a compat check (clears up to 12 high/med)**

5. **`Pillow`** via `uv lock --upgrade-package pillow` (target 12.3.0) —
   **but first verify `torchvision==0.15.2` compatibility** (§5.3). If
   compatible, this single command clears **all 12 Pillow rows**. [C, M, Med]
   If not compatible, defer to a `torch` stack upgrade (separate initiative).

**P2 — next sprint, needs testing (clears 3 high)**

6. **`electron-builder` → 25.x/26.x** (root devDep). Clears
   `app-builder-lib`, `builder-util-runtime`, `brace-expansion` = **3 rows**.
   Requires full packaging smoke test on mac/win/linux. [B, M, Med]
   Sub-step: bump `@tailwindcss/postcss` to clear the nested
   `postcss@8.5.15` (no separate Dependabot row, but hygiene).

**P3 — separate initiative, high risk (clears 6 on the website)**

7. **`astro` 5.18.2 → 7.0.6+** (website). Clears `astro` medium + low,
   `postcss`, `js-yaml`, `sharp`, `svgo` = **6 rows**. Major-version jump
   across two majors — own PR, own QA cycle on the marketing site.
   [A, L, High]

> No P4 / accept-risk bucket is needed: every flagged install is reachable
> from a direct dependency that can be bumped.

## 8. What NOT to do

- **Do not reach for `pnpm.overrides` / `npm_overrides` as a first
  resort.** Forcing `app-builder-lib@26.x` under `electron-builder@24`
  breaks the peer-dep contract electron-builder was tested against and can
  silently corrupt installers. Overrides are a last-resort patch for a
  vuln that is _exploited in your runtime_ and _cannot be fixed by bumping
  the direct dep_. None of the alerts here meet that bar — the direct
  bumps (P0/P1) and the `electron-builder` major (P2) cover everything.
- **Do not run `pnpm audit --fix` / `npm audit --fix` blindly.** On a
  pnpm+electron project it will propose semver-incompatible bumps and can
  wedge the lockfile. Triage per this document instead.
- **Do not bump `torch`/`torchvision`/`torchaudio` inside a security PR.**
  Those pins exist for FunASR model compatibility; changing them is an ML
  runtime decision, not a supply-chain one. Verify Pillow compat first
  (§5.3); only escalate to a torch upgrade if Pillow 12.3.0 truly cannot
  coexist.
- **Do not treat all 30 alerts as 30 tasks.** After dedup there are ~6
  distinct engineering actions (3 root bumps, 1 pillow, 1 electron-builder
  major, 1 astro major). Tracking the duplicates as individual tickets
  wastes review cycles — collapse them at the PR level.
- **Do not ignore the website tree.** It is a separate `npm` install; root
  `pnpm update` will not touch `website/package-lock.json`. The 6 website
  alerts need `cd website && ...`.
- **Do not ship the `astro` 5 → 7 bump in the same PR as the root
  `tar`/`axios` fix.** Mix a near-zero-risk change with a high-risk major
  bump and you lose the fast review path on the critical fix.

## 9. One-page scoreboard

| Bucket                                                                                      | Alerts | Action                                                                              | When       |
| ------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- | ---------- |
| `tar` (1 critical + 2 medium, same install)                                                 | 3      | bump `tar@^7.5.19`                                                                  | P0, now    |
| `axios` (direct, 3 dup advisories)                                                          | 3      | bump `axios@^1.18.0`                                                                | P0, now    |
| `postcss` (direct devDep, 2 advisories)                                                     | 2      | bump `postcss@^8.5.18`                                                              | P0, now    |
| `setuptools`                                                                                | 1      | `uv lock --upgrade-package setuptools`                                              | P0, now    |
| `Pillow`/`pillow` (12 dup advisories)                                                       | 12     | `uv lock --upgrade-package pillow` after torch-compat check                         | P1         |
| `electron-builder` cluster (`app-builder-lib` + `builder-util-runtime` + `brace-expansion`) | 3      | bump `electron-builder` major (+ `@tailwindcss/postcss` for nested postcss hygiene) | P2         |
| `astro` cluster (website: `astro`×2 + `postcss` + `js-yaml` + `sharp` + `svgo`)             | 6      | bump `astro` 5 → 7                                                                  | P3, own PR |
| **Total**                                                                                   | **30** | **6 distinct actions**                                                              |            |

Severity reconciliation: 1 critical + 19 high + 9 medium + 1 low = 30. The
critical row is fully addressed by P0 step 1.
