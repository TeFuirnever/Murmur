# What was measured (bloub bot port)

Ported note, adapted for Murmur. Upstream original:
[jeremy-prt/bloub](https://github.com/jeremy-prt/bloub), `docs/measurements.md`
(MIT). The bot engine in `src/bot/` is a faithful port of that project; this
document is the iron rule that travels with it.

Nothing here was drawn by eye. The reference video was cut at 10 frames per
second, then each state measured off the frames: silhouettes by sub-pixel ray
casting, eyes by capsule fitting (PCA), colours and stroke widths by direct
sampling.

**The numeric constants of the bot are measurements, not settings.** Gaze angles,
eye sizes, radii, timings, colours: all of it comes from frame-by-frame analysis.
Rounding them off, simplifying them, or replacing them with values that look
tidier breaks the resemblance, which is the only success criterion of the port.
The port is verified zero-drift against the upstream constants, and the ported
test suite locks them.

## Verified traps, not to be "corrected"

- The eyes lean like `\\`, not `//`.
- The body is a **perfect circle**, not a squircle, radial deviation under 0.7%.
- Transitions are **exponential ease-outs**; the body **never** overshoots. The
  one spring is local and written into the state concerned (the notification
  badge's +14% pop). There is deliberately no spring engine.
- The vertical `!` has a **tapered** bar (top/bottom = 1.76); the leaning `!` has
  a **capsule** bar. They are not the same shape.
- The leaning `!`'s dot is a **teardrop**, round end towards the bar, point away,
  not a disc.
- In the comet state the dot **does not move**: the trail orbits it.
- At rest the avatar **doesn't float**: the video measures the centre stable to
  ±0.003. The code keeps a deliberate trace of it (a drift of a few thousandths
  of the radius, and a 0.5% breath) purely so the image isn't completely frozen.
  The visible life is gaze drift and blinking. Don't add a float on top.

## The eyes live on a sphere

The eye nearer the edge is about 0.69 times the width of the other and 0.663
times its area, exactly the depth factor of a point on a sphere at that distance
from the centre. So each eye takes the sphere's tangent frame, projected
orthographically: the compression, the tilt and the passage behind the limb all
follow on their own.

The gaze poses (`REST_GAZE` and the per-state `gaze`) come from fitting that
model to the measured positions, with a residual error of about 1 px on a 190 px
ball.

Two notes for anyone comparing numbers. The far/near width ratio appears as 0.69
in `face.ts`, as 0.674 in `face.test.ts` (the raw video figure) and computes to
about 0.708 from the model: source versus fit, and the test's tolerance covers
the spread. Likewise the rest tilt is not a constant anywhere: it emerges from
`REST_GAZE` through the tangent frame, at about 26° off vertical.

## Every shape change is hidden by a blink

That's the morph-damping mechanism in the original, reproduced by `blinkIn` on
the states concerned. The forced blink lasts 0.2 s; the scheduled idle blink is
`BLINK_DUR = 0.18`.

## The eye-fit table is build-time, not per-frame

`src/bot/eyefit.ts` solves the face placement on non-circular customiser shapes
once, at import, into `EYE_SHIFT_TABLE`. Seven per-frame variants were tried
upstream and all trembled; do not move the solve into the render loop. The
engine reads the table on the boundaries of each morph and interpolates along
that morph's own curve — never on the interpolated value.

## Regenerating the profiles

`src/bot/profiles.ts` is generated data, ported verbatim from upstream. Do not
edit it by hand; treat it as read-only measurement tables. The generator
(`tools/extract-profiles.py`) needs the reference video, which does not travel
with this port — regeneration happens upstream:

```bash
mkdir -p frames
ffmpeg -i reference.mp4 -vf fps=10 frames/h_%04d.png
pip install numpy pillow
python tools/extract-profiles.py frames/ > src/bot/profiles.ts
```

The script composes exact filenames (`h_0164.png` and friends, zero-padded to
four), so the `h_` prefix and the `fps=10` cut both matter. It extracts the
three profiles that can't be built analytically (egg, hexagon, triangle); the
rest are either the measured circle or constructed in `skins.ts`.

## Identifier renames in this port

The port Englishifies identifiers per spec #224 (ticket 1, decision #221):
`RAYON`→`RADIUS`, `DEMI_VIEWBOX`→`HALF_VIEWBOX`, `repere.ts`→`viewBox.ts`,
`encre`→`ink`, the 32 catalogue data ids (shapes/colours/expressions), and the
French internal names (`decalageDesYeux`→`eyeShift`, `departFige`→
`frozenDeparture`, `origine`→`fadeOrigin`, `empreintes`→`eyeFootprints`,
`epreuves`→`trials`, ...). Numbers were not touched — the port is verified
zero-drift against upstream, and the ported tests pass unchanged in behavior.
