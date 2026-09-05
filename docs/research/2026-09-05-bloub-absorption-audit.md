# Bloub Absorption Audit (2026-09-05)

Follow-up to [2026-09-04-bloub-integration-survey.md](./2026-09-04-bloub-integration-survey.md). This audit enumerates **every asset/surface of the bloub repository** and classifies its absorption status into Murmur `feat/bloub-mascot` @ `3869f60`.

- Upstream (read-only): `/Users/guanxueliang/Desktop/oh-my-ai/bloub` — [jeremy-prt/bloub](https://github.com/jeremy-prt/bloub), MIT
- Absorbing repo: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur`, branch `feat/bloub-mascot`, HEAD `3869f60` (16 commits since `main`, tickets 1-6 of spec #224 plus unrelated spec #226 sqlite work)
- Scope authority: spec #224 (`gh issue view 224 --repo TeFuirnever/Murmur`), decisions #217/#219/#220/#221/#222. Asset disposition list: #221.

Paths below are repo-relative (`bloub:` prefix = upstream). All bot tests were executed for this audit: **11 files, 156 tests, all green** (`npx vitest run tests/unit/bot`).

**Headline: 100% of the in-scope surface is absorbed with verified zero numeric drift. No real gaps found.** Everything absent is either ratified by #224/#221 (by-design exclusion) or listed under "Gaps worth deciding" as open questions.

---

## 0. Summary table

| #   | Surface                                                               | bloub source                                                                                                    | Murmur destination                                                                                                                                     | Status                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Engine `src/bot/` (12 files)                                          | `bloub:src/bot/{engine,states,decor,face,expressions,eyefit,math,profiles,shape,skins,cycles}.ts` + `repere.ts` | `src/bot/` same 11 names + `viewBox.ts`                                                                                                                | **Absorbed** (semantic 1:1, zero numeric drift)                                                                                                                                             |
| 2   | Engine tests (6 files)                                                | `bloub:src/bot/*.test.ts` (cycles/engine/expressions/face/shape/skins)                                          | `tests/unit/bot/*.test.ts` (same 6)                                                                                                                    | **Absorbed** (same describes + it-counts, translated)                                                                                                                                       |
| 3   | `ui/capture.test.ts` contract                                         | `bloub:src/ui/capture.test.ts` (4 tests)                                                                        | `tests/unit/bot/bloubBot.test.tsx` ("byte for byte" + frozen-frame + state-drives-frame)                                                               | **Absorbed** (contract translated to React shell, per spec ticket 1)                                                                                                                        |
| 4   | Shapes catalogue (8)                                                  | `bloub:src/bot/skins.ts` `cercle/galet/squircle/capsule/triangle/hexagone/nuage/goutte`                         | `src/bot/skins.ts` `circle/pebble/squircle/capsule/triangle/hexagon/cloud/droplet`                                                                     | **Absorbed** (8/8, ids Englishified per #221)                                                                                                                                               |
| 5   | Colours catalogue (12)                                                | `bloub:src/bot/skins.ts` (`encre`…`gris`)                                                                       | `src/bot/skins.ts` (`ink`…`gray`)                                                                                                                      | **Absorbed** (12/12; all 12 hex values byte-identical)                                                                                                                                      |
| 6   | Expressions catalogue (16)                                            | `bloub:src/bot/expressions.ts` (`neutre`…`somnolent`)                                                           | `src/bot/expressions.ts` (`neutral`…`drowsy`)                                                                                                          | **Absorbed** (16/16)                                                                                                                                                                        |
| 7   | 15 states incl. `swirl`                                               | `bloub:src/bot/states.ts`                                                                                       | `src/bot/states.ts:158-174`                                                                                                                            | **Absorbed** (15/15; `swirl` engine-only, never triggered — per #219)                                                                                                                       |
| 8   | Iron-rules doc                                                        | `bloub:docs/measurements.md` (79 lines)                                                                         | `docs/bot/measurements.md` (104 lines, adapted + upstream link)                                                                                        | **Absorbed** (adapted, not verbatim — see §6)                                                                                                                                               |
| 9   | React shell (new surface, #222)                                       | — (`bloub:src/components/BloubBot.vue` is the Vue analogue)                                                     | `src/components/BloubBot.tsx` + `tests/unit/bot/bloubBot.test.tsx` (523 lines, 27 `it`s)                                                               | **Absorbed** (re-authored, by design)                                                                                                                                                       |
| 10  | Gaze constants                                                        | `bloub:src/ui/gaze.ts` `YAW_MAX=16 PITCH_MAX=13 PITCH=10`                                                       | `src/components/BloubBot.tsx:78-81` (same values)                                                                                                      | **Absorbed** (inline constants)                                                                                                                                                             |
| 11  | Gaze UI machinery (`TURN/SPIN/TURN_TIME/HUMEURS/tourLook/lookTarget`) | `bloub:src/ui/gaze.ts` (+ `gaze.test.ts`)                                                                       | absent (BloubBot computes `yaw: nx*YAW_MAX, pitch: PITCH-ny*PITCH_MAX, mix:1, spin:0, wander:0` at `BloubBot.tsx:486-488`)                             | **By-design excluded** (settings-entry swirl + arrival + mood-cycling are Vue-layer; see §5.2 / open question Q3)                                                                           |
| 12  | cycles.ts montage editor support                                      | `bloub:src/bot/cycles.ts`                                                                                       | `src/bot/cycles.ts`                                                                                                                                    | **Absorbed but unconsumed** in `src/` (only `tests/unit/bot/cycles.test.ts` + `shapeBranches.test.ts` import it; Murmur runtime uses only `REPLAY_STATES = {orbit}` inside BloubBot.tsx:98) |
| 13  | Vue component layer (16 files)                                        | `bloub:src/App.vue` + 15 `src/components/*.vue`                                                                 | absent (`find src -name '*.vue'` → 0)                                                                                                                  | **By-design excluded** (#224: Vue UI not ported)                                                                                                                                            |
| 14  | Export pipeline                                                       | `bloub:src/ui/{capture,export,video,anime}.ts` + mediabunny dep                                                 | absent (no `mediabunny` in `src/` or `package.json`)                                                                                                   | **By-design excluded** (#224)                                                                                                                                                               |
| 15  | bloub i18n (7 files, fr/en/zh)                                        | `bloub:src/i18n/**`                                                                                             | absent as code; equivalent = 41 `bot.*`/`settings.bot.*` keys per locale in `src/i18n/locales/{zh-CN,en}.json`                                         | **By-design excluded** (labels re-expressed; French absent app-wide)                                                                                                                        |
| 16  | Other `src/ui/` (intro, stockage, timeline, useModalDialog)           | `bloub:src/ui/*.ts`                                                                                             | absent                                                                                                                                                 | **By-design excluded** (Vue-layer: arrival sequence, localStorage montage persistence, timeline formatting, modal driver)                                                                   |
| 17  | Docs other than measurements                                          | `bloub:docs/{architecture,export,i18n,interface,intro}.md` + `demo.gif` + `states.png`                          | absent (`docs/bot/` contains only `measurements.md`)                                                                                                   | **By-design excluded** per #221 asset list, except `architecture.md` = open question Q1                                                                                                     |
| 18  | `tools/extract-profiles.py`                                           | `bloub:tools/extract-profiles.py`                                                                               | absent; `src/bot/profiles.ts` checked in as the generated artifact                                                                                     | **By-design excluded** (#221: "不随行: extract-profiles.py")                                                                                                                                |
| 19  | Favicon chain + `og.png` + `--ink`                                    | `bloub:public/{favicon.ico,favicon.svg,apple-touch-icon.png,og.png}`, `styles.css --ink`                        | absent (Murmur `website/` favicons are its own branding, unrelated)                                                                                    | **By-design excluded** (#221)                                                                                                                                                               |
| 20  | LICENSE (MIT, Jérémy Perret)                                          | `bloub:LICENSE`                                                                                                 | `THIRD_PARTY_NOTICES.md:3-12` + full MIT text (Apache-2.0 notice-retention compliant)                                                                  | **Absorbed**                                                                                                                                                                                |
| 21  | README attribution                                                    | `bloub:README.md`                                                                                               | `README.md:83` (feature note + upstream link + zero-drift claim)                                                                                       | **Absorbed**                                                                                                                                                                                |
| 22  | CLAUDE.md invariants                                                  | `bloub:CLAUDE.md` ("most important rule" + invariants list)                                                     | `AGENTS.md` high-risk entry for `src/bot/` (measurements rule, eyefit build-time rule, ogl/motion boundary note); `CHANGELOG.md:14` boundary statement | **Absorbed** (condensed; full reasoning lives in `docs/bot/measurements.md`)                                                                                                                |

In-scope set = rows 1-10, 12 (engine + tests + catalogues + doc + shell + constants) + the six delivery tickets verified in §7. All absorbed.

---

## 1. Engine: `src/bot/` (row 1)

All 12 upstream files landed; none dropped; none added beyond the rename `repere.ts` → `viewBox.ts`.

Method: comments stripped, then token-multiset comparison (identifiers, string literals, numbers, punctuation) per file pair, with the ratified #221 rename map (including catalogue-id translation `gris`→`gray` etc.) applied to the upstream side.

**Result — numeric constants: 12/12 files identical multisets.** The only numeric difference in the whole port is `profiles.ts`, where upstream trailing zeros were dropped (`0.9970` → `0.997`, 23 values): same numbers, different literal formatting. No constant was rounded, added or removed.

**Result — export maps: 1:1 in every file** (same export count and kind). The complete rename list found:

| bloub                               | Murmur                                    | file                                                                  |
| ----------------------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| `RAYON`, `DEMI_VIEWBOX`             | `RADIUS`, `HALF_VIEWBOX`                  | `viewBox.ts`                                                          |
| `MAX_BLOCS`                         | `MAX_BLOCKS`                              | `cycles.ts`                                                           |
| `POUR_TESTS`, `decalageDesYeux`     | `TEST_HOOKS`, `eyeShift`                  | `eyefit.ts`                                                           |
| `DERIVE_*`, `empreintes`, `resous`… | `DRIFT_*`, `eyeFootprints`, `solveShift`… | `eyefit.ts`, `engine.ts` (all paired with matching occurrence counts) |

Every identifier pair matched occurrence-for-occurrence (e.g. `origine`×9 ↔ `fadeOrigin`×9, `marge`×12 ↔ `margin`×12), which is only possible if the port is a pure rename + comment translation. Residual diffs are Prettier mechanics (single→double quotes, semicolons, trailing commas, line wrapping) — verified formatting-only by whitespace-normalized diffs of `math.ts` and `shape.ts`.

Semantic-drift spot checks (see §8): `EYE_SPLIT 15.46`, `NOTIF_BLUE #2496e8`, blink `pair(0.18, 0.34)`, `TEAR = polyPath(hullOfCircles(0, 0, 0.118, 0, 0.172, 0.012))`, `TRI_ORBIT 0.213` — all byte-identical to upstream.

Upstream comments (French) were fully translated to English; each Murmur file carries the `[20260904_Refactor_BloubEnginePort]` header tag plus, where load-bearing, the measurement warning (e.g. `src/bot/shape.ts` header points to `docs/bot/measurements.md`). `grep` for French identifiers in `src/bot/` finds none (only English words like `pebble`, `verts` variable in `roundedPolygon`).

## 2. Tests (rows 2-3)

Six engine suites ported into `tests/unit/bot/` with identical structure:

| bloub file            | describes (translated 1:1)                                                                                                                  | it-count bloub→Murmur |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `cycles.test.ts`      | cycle par defaut / durees / lecture / relecture du stockage → default cycle / durations / playback / storage re-reading                     | 23 → 23               |
| `engine.test.ts`      | 8 describes → 8 (custom shape, engine, gaze following the pointer, gaze robustness, reset, silhouettes, state change during a fade, states) | 37 → 37               |
| `expressions.test.ts` | catalogue / changement → catalogue / change                                                                                                 | 9 → 9                 |
| `face.test.ts`        | yeux poses sur une sphere → eyes posed on a sphere                                                                                          | 5 → 5                 |
| `shape.test.ts`       | profils des formes / radiusAtAngle → customiser shape profiles / radiusAtAngle                                                              | 6 → 6                 |
| `skins.test.ts`       | formes du personnalisateur → customiser shapes                                                                                              | 6 → 6                 |

`capture.test.ts` (the only DOM test upstream, `happy-dom`) tested the **offscreen export reader** (`ouvreCycle`): viewBox frame parity, deterministic replay, block-joint frames equal to engine output, frame-0-is-first-state. Murmur has no offscreen reader (export dropped), so the _contract_ — "the component draws exactly what the engine samples, byte for byte" — was translated into `tests/unit/bot/bloubBot.test.tsx` ("renders the engine's own body path, byte for byte", "the same frozenAt renders the identical frame across mounts", "the state prop drives the rendered frame"), exactly as spec ticket 1 prescribed. The replay/joint concerns resurface as the shell's orbit auto-replay test ("re-issues orbit at its duration boundary").

Murmur additions beyond the port (no upstream counterpart, both tagged):

- `tests/unit/bot/shapeBranches.test.ts` (202 lines, `[20260905_Test_BotBranchRecovery]`) — branch-coverage pins for defensive fallbacks, added when the port dropped the global branch threshold below 92%.
- Integration-level suites: `tests/unit/botSettings.test.tsx`, `botAppearanceFlow.test.tsx`, `botFileState.test.ts`, `appFileInjection.test.tsx`, plus e2e boot-health references.

Suite execution: **156/156 green** in 2.91 s (two expected `NO_I18NEXT_INSTANCE` stderr notes in jsdom shells, pre-existing pattern).

## 3. Catalogues (rows 4-7)

- **Shapes 8/8**: `circle, pebble, squircle, capsule, triangle, hexagon, cloud, droplet` (`SHAPE_BY_ID`).
- **Colours 12/12**: `ink, cream, gray, brown, red, orange, amber, green, turquoise, blue, violet, rose`; diffing all hex literals between `bloub:src/bot/skins.ts` and `src/bot/skins.ts` → **identical multiset** (`#0a0a0c`, `#f1efe9`, `#a3a3a3`, `#8b5e3c`, `#e8483f`, `#f08a24`, `#f0b429`, `#3ecf8e`, `#2fbfa0`, `#3b93f0`, `#8b5cf6`, `#e152b0`).
- **Expressions 16/16**: `neutral, attentive, surprised, excited, happy, gleeful, angry, sad, scared, wary, confused, curious, proud, shy, jaded, drowsy`.
- **States 15/15** in `StateId` (`src/bot/states.ts:158-174`), including the five never-triggered states `egg/hexagon/notify/play/swirl` — `grep` confirms none of them is referenced outside `src/bot/` except the `playOnce` egg channel, matching decision #219.
- **Labels**: every id has a label in both locales — `settings.bot.shape.*` (8), `settings.bot.color.*` (12), `settings.bot.expression.*` (16), plus `settings.bot.description/autoColor`, `settings.sections.bot`, `settings.sidebar.bot`, `bot.ariaLabel`. Murmur re-translated the Chinese rather than copying upstream (`鹅卵石` vs upstream `卵石`, `方圆` vs `圆角方形`) — equivalent coverage, Murmur's own wording.

## 4. Vue layer and export pipeline — confirmed absent (rows 13-14, 16)

`find Murmur/src -name '*.vue'` → 0 files. `grep -r mediabunny Murmur/src Murmur/package.json` → nothing. The specific functionality Murmur therefore lacks (all ratified out in #224 "Vue UI layer NOT ported" / "export NOT ported"):

- **Customiser panel** (`Customizer.vue`, `BlockPicker.vue`, `SideRail.vue`, `ZoomSlider.vue`, `Settings.vue`) — replaced by the settings-window `BotSection` (3 dropdown pickers; no live zoom/board preview).
- **Montage/timeline editor** (`Timeline.vue`, `TimelineTrack.vue`, `CycleDialog.vue`, `CycleMenu.vue`) and **state board `#planche`** (`BotTile.vue` grid) — no in-app way to build cycles; only the fixed orbit replay exists.
- **Arrival sequence** (`ui/intro.ts`: solo ball, full eye revolution `tourLook`, interface fade-in) — Murmur's mascot is permanently mounted; no arrival moment.
- **Settings-entry swirl turn** (`gaze.ts` `TURN=26/SPIN=360/TURN_TIME=1.1`, consumed by `App.vue`) — the `swirl` state exists in the engine but nothing triggers it.
- **Gaze mood-cycling** (`HUMEURS` cycling `surpris/heureux/hilare/excite/fier/blase` while tracking, `App.vue:510`) — see Q3.
- **Export bar** (`ExportBar.vue`, `GifDialog.vue`, `ui/capture.ts` SVG/PNG/clipboard, `ui/export.ts` framing/naming, `ui/video.ts` MP4 via mediabunny, `ui/anime.ts` CSS-animated SVG assembly), **name/confirm dialogs** (`NameDialog.vue`, `ConfirmDialog.vue`, `ui/useModalDialog.ts`), **localStorage persistence** (`ui/stockage.ts`) — all absent.

Nothing in `Murmur/src` imports these behaviours; the Vue-layer support modules (`ui/timeline.ts`, `ui/intro.ts`, `ui/stockage.ts`, `ui/useModalDialog.ts`, `ui/anime.ts`) are likewise absent (grep hits for their names in Murmur are Murmur's own unrelated modules, e.g. its `main.tsx`/`settings.tsx` exports).

## 5. i18n and gaze details (rows 10-11, 15)

### 5.1 bloub i18n → Murmur keys

Upstream `src/i18n/` (7 files: `index.ts`, `langues.ts`, `format.ts`, `locales/{en,fr,zh}.ts`, `i18n.test.ts`) is a standalone language-switcher; not ported (Murmur has its own i18n runtime with exactly two locales, `src/i18n/locales/{zh-CN,en}.json`). The bot surface that needed labels (catalogue ids, section title, aria label) is fully covered in both locales (§3). **French absent by design** — Murmur ships no French locale at all, so this is app-wide policy, not a bot-specific omission.

### 5.2 gaze.ts disposition

| upstream symbol                   | value               | Murmur fate                                                                                                              |
| --------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `YAW_MAX` / `PITCH_MAX` / `PITCH` | 16 / 13 / 10        | absorbed verbatim, `BloubBot.tsx:78-81`                                                                                  |
| pointer→look mapping              | `lookTarget()`      | re-expressed inline (`BloubBot.tsx:486-488`) as `yaw: nx*YAW_MAX, pitch: PITCH-ny*PITCH_MAX, mix: 1, spin: 0, wander: 0` |
| `TURN` / `SPIN` / `TURN_TIME`     | 26 / 360 / 1.1      | absent (settings-entry head-turn; no side panel to turn toward)                                                          |
| `HUMEURS`                         | 6-expression cycle  | absent (no mood-cycling during tracking; the configured expression holds)                                                |
| `tourLook` / `TOUR_TIME`          | arrival spin        | absent (no arrival sequence)                                                                                             |
| `wander: pointer ? 0 : 1`         | idle wander restore | approximated by `setLook(null)` on pointer-leave/blur (`releaseGaze`), letting the state's own measured drift take over  |

The `aim()` rule ("only on rest-face states; elsewhere the pose IS the animation") is preserved and commented at `BloubBot.tsx:465-470`, including the NaN guard for zero-sized bounding boxes.

## 6. Docs (rows 8, 17, 20-22)

- `bloub:docs/measurements.md` → `docs/bot/measurements.md`: adapted, not verbatim — adds a provenance header (upstream link, MIT, "faithful port… zero-drift… test suite locks them"), translates `pastille`→`badge`, and adds a port-specific line; all measured values and traps carried over (diff reviewed; no constant altered).
- `bloub:docs/architecture.md` (English upstream; engine reasoning: mask eyes, `radiusAtAngle`, eyefit table vs solver, "What not to try again", `swirl` the unmeasured state) — **not landed**; its two iron rules survive as the `AGENTS.md` `src/bot/` high-risk sentence and inside `measurements.md`/`eyefit.ts` comments. Full doc = open question Q1.
- `bloub:docs/{export,i18n,intro,interface}.md`, `demo.gif`, `states.png` — not landed; they document the excluded layers (export/Vue/i18n switcher) or serve as visual reference (Q2).
- `bloub:LICENSE` → `THIRD_PARTY_NOTICES.md` (full MIT text, copyright `2026 Jérémy Perret`, scope statement covering `src/bot/`, `tests/unit/bot/`, `docs/bot/measurements.md`, plus the x.ai-imitation disclosure).
- `bloub:README.md` attribution → `README.md:83` feature blurb with upstream link and zero-drift claim; `CHANGELOG.md:14` full entry incl. the ogl/motion boundary statement; `AGENTS.md` high-risk area entry for `src/bot/`.
- `bloub:CLAUDE.md` "most important rule" (measurements, don't round) → `AGENTS.md` high-risk entry ("numeric constants are frame-by-frame video measurements — never round or 'fix' them; the eye-fit table is build-time only, never re-solve per frame; see `docs/bot/measurements.md`").

## 7. Spec #224 delivery tickets — commit-by-commit verification

All six tickets landed on `feat/bloub-mascot`, each with its review-fix commit:

1. `7e3ba40` engine + tests same PR (+ `fab0365` MIT notice) — §1-2 evidence.
2. `1f01424` React shell `BloubBot.tsx` (+ `2181608`, `470ca07` review fixes: paused repaint on engine mutation).
3. `7777439` state wiring: `App.tsx:492-531` `getBotState()` maps mic/model stages per #219 table; eggs wired at `App.tsx:189,212,233,237,472,878` (comet/wink/burst via `playOnce`).
4. `1f8ff94` + `1f22abb` `useFileTranscription` lifted; mapping isolated in `src/lib/botFileState.ts` (`selected→wide, transcribing→orbit, error→exclaim`, done→comet egg), pure and tested.
5. `f262f33` + `1f23c15` `BotSection.tsx` (116 lines, options generated from the engine catalogues with `t()` fallbacks); keys `bot_shape/bot_color/bot_expression` in all four required places: `useSettings.ts:31-33` (state), `:94-96` (defaults, incl. theme-following `"auto"` colour), `:170-172` (loadSettings), `settingsHandlers.ts:43-45` (ALLOWED_SETTING_KEYS).
6. `2485949` docs — README/CHANGELOG/AGENTS/boundary statement (§6).

Iron-rule compliance: zero new runtime dependencies (`git diff main...feat/bloub-mascot -- package.json` shows only spec #226 sqlite removals); zero new IPC channels (settings ride the existing channel); `prefers-reduced-motion` runtime-following present (`BloubBot.tsx:416-417` with missing-`matchMedia` guard); `.dark` class detection with live re-flip tested.

## 8. Claimed invariants — verification evidence

| Claim                        | Evidence                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| measurements doc exists      | `docs/bot/measurements.md` (104 lines, provenance header)                                                                                                 |
| zero numeric drift           | token-multiset equality on all 12 files (§1); only `profiles.ts` trailing zeros reformatted, values equal                                                 |
| `EYE_SPLIT 15.46`            | `src/bot/face.ts:25` = `bloub:face.ts:21`                                                                                                                 |
| `NOTIF_BLUE #2496e8`         | `src/bot/decor.ts:286` = `bloub:decor.ts:274`                                                                                                             |
| `BLINK_DUR 0.18`             | blink pairs `pair(0.18, 0.34)` / `pair(0.18, 0.34 + back*0.07)` at `states.ts:430,476` = `bloub:states.ts:422,468`                                        |
| TEAR path constants          | `TEAR = polyPath(hullOfCircles(0, 0, 0.118, 0, 0.172, 0.012))` byte-identical (`states.ts:139` = `bloub:states.ts:131`); `TRI_ORBIT 0.213` also identical |
| no French identifier residue | grep over `src/bot/` clean (§1)                                                                                                                           |
| engine + tests same PR       | `7e3ba40` contains both                                                                                                                                   |

---

## 9. Gaps worth deciding

### (a) By-design exclusions — ratified in #224/#221, NOT gaps

Vue customiser/timeline/state-board/arrival/swirl-entry (§4), export pipeline incl. mediabunny (§4), bloub i18n layer incl. French (§5.1), `tools/extract-profiles.py`, favicon chain + `og.png` + `--ink` (§6), `docs/{export,i18n,intro,interface}.md` + `demo.gif` + `states.png` as docs of excluded layers, catalogue-id Englishification, comment translation, Prettier reformatting.

### (b) In-scope but incomplete — real gaps

**None found.** Every surface the spec scoped is present, tested, and drift-free; all DoD items have commit-level evidence (§7); the one coverage dip the port caused was itself remedied (`shapeBranches.test.ts`).

### (c) Open questions — nobody decided either way

1. **`bloub:docs/architecture.md` not imported.** It is engine documentation (not Vue documentation) — the eyefit "table, not a solver" reasoning, "What not to try again", the two-blacks colour rule. Its iron rules survive in AGENTS.md/measurements.md, but the full reasoning is one dead link away. Import (adapted) or leave? Cheap to add, and `src/bot/` is now a high-risk area.
2. **`demo.gif` / `states.png` visual references.** The measurements doc's authority rests on a reference video nobody in this repo has; the two upstream images are the closest artefacts. Keep a copy under `docs/bot/` for future fidelity disputes?
3. **Gaze mood-cycling (`HUMEURS`).** Upstream's live site cycles six expressions while the cursor is tracked; Murmur holds the configured expression (pointer tracking was ratified "v1 内置" in #222 without addressing moods). Want the bot to feel livelier during long pointer interactions?
4. **`src/bot/cycles.ts` is dead-but-tested.** Ported whole per "engine 12 files isomorphic" and fully covered by `cycles.test.ts`/`shapeBranches.test.ts`, but no production code consumes it (BloubBot uses only its own `REPLAY_STATES` orbit set, and no montage UI exists). Keep as dormant capability awaiting a future "montage" feature, or trim to the orbit subset? Trimming would delete tested code for no runtime gain; keeping costs ~250 lines of vendored surface. Recommend keeping (it is upstream-verbatim, zero maintenance), but the decision is yours.
5. **Idle wander semantics.** Upstream restores `wander: 1` while keeping the head turned when the pointer disappears; Murmur releases the look entirely (`setLook(null)`), returning to the state's own measured drift. Visually similar, mechanically different; flagging for completeness only.

---

_Audit method note: file-level enumeration of both repos; semantic comparison via comment-stripped token multisets with the #221 rename map; export-map and describe/it-count comparison for tests; commit-by-commit ticket verification against `git log main..feat/bloub-mascot`; bot suite executed (156/156 green). Upstream was not modified._

---

## Ratification (2026-09-05)

User accepted the audit verdict and the recommendations:

1. **Import `bloub:docs/architecture.md`** — done: [`docs/bot/architecture.md`](../bot/architecture.md) (port-adapted header, content preserved).
2. **Fidelity references** — done: `docs/bot/demo.gif` + `docs/bot/states.png` copied verbatim from upstream (visual ground truth for the replica; upstream retains ownership of the design they imitate — see THIRD_PARTY_NOTICES.md).
3. **HUMEURS mood-cycling** — experiment ticket opened: #227.
4. **`cycles.ts` dead-but-tested** — kept as-is (engine completeness; the ported suite locks it).
