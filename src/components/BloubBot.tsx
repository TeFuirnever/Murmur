// [20260905_Fix_BloubBotReviewFixes] Review-fix batch for this file: rAF
// clock clamp, egg-timer unmount cleanup, window-gated gaze release,
// paint-skip guard with dirty marks, imperative data-bot-state, NOTIF_BLUE
// import, required ariaLabel, getState on the ref. Blocks below carry the
// batch name where they land.
// [20260904_Feat_BloubBotShell] React mascot shell over the bloub engine
// (spec #224 ticket 2, contract in #222). The engine is the single source of
// truth: the component owns one rAF loop, samples it, and paints the returned
// BotFrame imperatively onto static SVG elements — zero React re-renders per
// frame, mirroring upstream BloubBot.vue's render order (mask eye-holes,
// back-arcs, body with paper underlay, front dots, badge, front arcs).

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { BotEngine, type BotFrame } from "../bot/engine";
import { HALF_VIEWBOX, RADIUS } from "../bot/viewBox";
import {
  COLOR_BY_ID,
  SHAPE_BY_ID,
  mixHex,
  type ColorId,
  type ShapeId,
} from "../bot/skins";
import { EXPRESSION_BY_ID, type ExpressionId } from "../bot/expressions";
import { STATE_BY_ID, type StateId } from "../bot/states";
import { NOTIF_BLUE } from "../bot/decor";
import { clamp } from "../bot/math";

const VB = HALF_VIEWBOX;
const SVG_NS = "http://www.w3.org/2000/svg";

export interface BloubBotProps {
  /** the state the bot should display (from the app-state mapping) */
  state: StateId;
  /** display size in px; drawing coordinates stay in viewBox units */
  size?: number;
  /** render one deterministic frame, no animation loop (tests, thumbnails) */
  frozenAt?: number;
  /** pause the clock without losing the phase (default true) */
  playing?: boolean;
  /** override chain: prop > settings key (ticket 5) > catalogue default */
  shape?: ShapeId;
  /** prop > settings key (ticket 5) > theme-aware default (ink / cream) */
  color?: ColorId;
  /** prop > settings key (ticket 5) > neutral */
  expression?: ExpressionId;
  /** accessible name; REQUIRED so every call site goes through i18n */
  ariaLabel: string;
  className?: string;
}

export interface BloubBotRef {
  /**
   * One-shot feedback flash (contract: wink / burst / comet only — an id
   * equal to the underlying state would no-op); returns to `state` after the
   * flash state's own duration.
   */
  playOnce: (id: StateId) => void;
  /** The state currently displayed (underlying or egg) — for tests and debug. */
  getState: () => StateId;
}

/**
 * Gaze amplitudes when following the pointer. CHOSEN, not measured — the
 * reference video shows no cursor tracking. Ported unchanged from upstream
 * `ui/gaze.ts`: wide enough to stand out from rest drift (±7deg yaw, ±5.5
 * pitch), restrained enough that no eye goes behind the sphere limb (an
 * engine test locks visibility up to ±42deg yaw).
 */
const YAW_MAX = 16;
const PITCH_MAX = 13;
/** Gaze height with the cursor centered, in absolute degrees (attentive pose). */
const PITCH = 10;

// [20260905_Feat_TrackingMoods] Issue #227: while the pointer stays and the
// bot is on a rest-face state, the eye SHAPE slowly cycles through these —
// a page veneer like upstream's settings-view humeurs, never touching the
// user's configured expression (restored on release). Ported from upstream
// ui/gaze.ts HUMEURS + App.vue's HUMEUR_MS = 4200; the list is not a matter
// of taste: every entry has ZERO ROLL. Yaw and pitch are neutralised by
// tracking (absolute), roll is not — a rolled mood followed by an unrolled
// one makes the eyes jump. Adding a rolled expression (e.g. curious, -15deg)
// reintroduces the jump.
const TRACKING_MOODS: readonly ExpressionId[] = [
  "surprised",
  "happy",
  "gleeful",
  "excited",
  "proud",
  "jaded",
];
/** One mood's duration, seconds. Long enough to notice, too long to agitate. */
const MOOD_INTERVAL_S = 4.2;

/**
 * Largest clock step per frame, in seconds. rAF is suspended while the window
 * is hidden or occluded; without this clamp the first frame after restore
 * would advance the clock by the whole hidden duration and every in-flight
 * fade would snap to completion. Same value as upstream BloubBot.vue's tick.
 */
const MAX_FRAME_DELTA = 0.064;

/**
 * States whose pose loops decoratively for as long as they hold. `orbit`'s
 * rings fade after 3.4 s and the pose degenerates into a slow-spinning ball,
 * so the shell re-issues the state at the boundary. Skipped under
 * prefers-reduced-motion (decoration, not life; breathing, blinks and drift
 * stay — they are what the bot is).
 */
const REPLAY_STATES: ReadonlySet<StateId> = new Set<StateId>(["orbit"]);

const LIGHT_INK_HEX = COLOR_BY_ID.get("ink")!.hex; // #0a0a0c
const DARK_INK_HEX = COLOR_BY_ID.get("cream")!.hex; // #f1efe9
const FALLBACK_PAPER = { light: "#f6f6f6", dark: "#1c1c1e" } as const;

function isDarkTheme(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  );
}

function readPaperHex(dark: boolean): string {
  // The paper path is the opaque colour the eye-holes see through to; it must
  // match the app background or back-arcs would reappear inside the eyes.
  if (typeof document === "undefined")
    return dark ? FALLBACK_PAPER.dark : FALLBACK_PAPER.light;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--background")
    .trim();
  return raw
    ? `hsl(${raw})`
    : dark
      ? FALLBACK_PAPER.dark
      : FALLBACK_PAPER.light;
}

/**
 * Stop-element cache per gradient: `querySelectorAll` per arc per frame is
 * steady DOM-query pressure for a permanently mounted mascot.
 */
const stopsCache = new WeakMap<SVGLinearGradientElement, SVGStopElement[]>();

interface ElementPool {
  /** Ensures exactly `count` children whose i-th child has tag `tagAt(i)`. */
  ensure(count: number, tagAt: (i: number) => string): Element[];
}

function makePool(group: SVGGElement | SVGDefsElement): ElementPool {
  let current: Element[] = [];
  return {
    ensure(count: number, tagAt: (i: number) => string) {
      let mismatch = current.length !== count;
      if (!mismatch) {
        for (let i = 0; i < count; i++) {
          if (current[i]!.tagName !== tagAt(i)) {
            mismatch = true;
            break;
          }
        }
      }
      if (mismatch) {
        current.forEach((el) => el.remove());
        current = [];
        for (let i = 0; i < count; i++) {
          const el = document.createElementNS(SVG_NS, tagAt(i));
          group.appendChild(el);
          current.push(el);
        }
      }
      return current;
    },
  };
}

function BloubBotImpl(
  {
    state,
    size = 48,
    frozenAt,
    playing = true,
    shape,
    color,
    expression,
    ariaLabel,
    className,
  }: BloubBotProps,
  ref: Ref<BloubBotRef>,
) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const maskId = `bot-mask-${uid}`;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const maskBodyRef = useRef<SVGPathElement | null>(null);
  const paperBodyRef = useRef<SVGPathElement | null>(null);
  const bodyGroupRef = useRef<SVGGElement | null>(null);
  // [20260905_Fix_InkRectRepaint] the ink rect's fill is ref-owned: a colour
  // prop change resolves in a post-render effect, so the JSX one-shot bind
  // goes stale (theme flips only worked because the class observer forces a
  // re-render). Paint owns it like every other attribute.
  const inkRectRef = useRef<SVGRectElement | null>(null);
  const eyeRefs = useRef<Array<SVGPathElement | null>>([null, null]);
  const notchRef = useRef<SVGCircleElement | null>(null);
  const notifRef = useRef<SVGCircleElement | null>(null);
  const dotsBackRef = useRef<SVGGElement | null>(null);
  const dotsFrontRef = useRef<SVGGElement | null>(null);
  const arcBackRef = useRef<SVGGElement | null>(null);
  const arcFrontRef = useRef<SVGGElement | null>(null);
  const gradDefsRef = useRef<SVGDefsElement | null>(null);

  const pools = useRef<{
    dotsBack?: ElementPool;
    dotsFront?: ElementPool;
    arcBack?: ElementPool;
    arcFront?: ElementPool;
    gradients?: ElementPool;
  }>({});

  // --- engine + clock (imperative; never React state) ---------------------
  const underlyingRef = useRef<StateId>(state);
  const displayRef = useRef<{ state: StateId; setAt: number }>({
    state,
    setAt: 0,
  });
  const clockRef = useRef({
    value: 0,
    realLast: 0,
    running: playing,
    paintedAt: -1,
  });
  const engineRef = useRef<BotEngine | null>(null);
  const eggTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedRef = useRef(false);
  const paperRef = useRef(readPaperHex(isDarkTheme()));
  const inkRef = useRef<string>(
    color
      ? (COLOR_BY_ID.get(color)?.hex ?? LIGHT_INK_HEX)
      : isDarkTheme()
        ? DARK_INK_HEX
        : LIGHT_INK_HEX,
  );
  const [, forceThemeRepaint] = useState(0);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  // [20260905_Feat_TrackingMoods] cycle state; `lastAt` re-arms whenever
  // tracking STARTS so the first mood waits a full interval
  const moodRef = useRef({
    tracking: false,
    active: false,
    index: 0,
    lastAt: 0,
  });
  /** Re-evaluated each tick so tracking survives resizes and egg returns. */
  const gazeTickRef = useRef<(() => void) | null>(null);

  const engine = useCallback(() => {
    if (!engineRef.current) {
      engineRef.current = new BotEngine(
        RADIUS,
        underlyingRef.current,
        shape ? (SHAPE_BY_ID.get(shape)?.radii ?? null) : null,
        expression ? (EXPRESSION_BY_ID.get(expression) ?? null) : null,
      );
    }
    return engineRef.current;
  }, [shape, expression]);

  const clockNow = useCallback(() => clockRef.current.value, []);

  const resolveInk = useCallback(() => {
    return color
      ? (COLOR_BY_ID.get(color)?.hex ?? LIGHT_INK_HEX)
      : isDarkTheme()
        ? DARK_INK_HEX
        : LIGHT_INK_HEX;
  }, [color]);

  // --- imperative paint ----------------------------------------------------
  const paint = useCallback(
    (frame: BotFrame) => {
      const inkHex = inkRef.current;
      const paperHex = paperRef.current;
      svgRef.current?.setAttribute("data-bot-state", displayRef.current.state);
      if (inkRectRef.current) inkRectRef.current.setAttribute("fill", inkHex);
      if (maskBodyRef.current)
        maskBodyRef.current.setAttribute("d", frame.bodyPath);
      if (paperBodyRef.current)
        paperBodyRef.current.setAttribute("d", frame.bodyPath);
      if (bodyGroupRef.current) {
        bodyGroupRef.current.setAttribute("opacity", String(frame.bodyAlpha));
      }
      for (let i = 0; i < 2; i++) {
        const el = eyeRefs.current[i];
        if (!el) continue;
        const eye = frame.eyes[i];
        if (!eye) {
          el.setAttribute("visibility", "hidden");
          continue;
        }
        el.setAttribute("d", eye.d);
        el.setAttribute("transform", eye.matrix);
        el.setAttribute("opacity", String(eye.alpha));
        el.setAttribute("visibility", "visible");
      }
      const notch = notchRef.current;
      if (notch) {
        if (frame.notch) {
          notch.setAttribute("cx", String(frame.notch.x));
          notch.setAttribute("cy", String(frame.notch.y));
          notch.setAttribute("r", String(frame.notch.r));
          notch.setAttribute("visibility", "visible");
        } else {
          notch.setAttribute("visibility", "hidden");
        }
      }
      const notif = notifRef.current;
      if (notif) {
        if (frame.notif) {
          notif.setAttribute("cx", String(frame.notif.x));
          notif.setAttribute("cy", String(frame.notif.y));
          notif.setAttribute("r", String(frame.notif.r));
          notif.setAttribute("visibility", "visible");
        } else {
          notif.setAttribute("visibility", "hidden");
        }
      }

      const p = pools.current;
      p.dotsBack ??= makePool(dotsBackRef.current!);
      p.dotsFront ??= makePool(dotsFrontRef.current!);
      p.arcBack ??= makePool(arcBackRef.current!);
      p.arcFront ??= makePool(arcFrontRef.current!);
      p.gradients ??= makePool(gradDefsRef.current!);

      // a dot is a circle unless the state supplies a path shape (the
      // teardrop of the tilted "!"), drawn in ball-radius units
      const paintDots = (pool: ElementPool, dots: BotFrame["dots"]) => {
        const els = pool.ensure(dots.length, (i) =>
          dots[i]!.d ? "path" : "circle",
        );
        dots.forEach((dot, i) => {
          const el = els[i]!;
          const fill =
            dot.color ??
            (dot.depth === undefined
              ? inkHex
              : mixHex(paperHex, inkHex, dot.depth));
          el.setAttribute("fill", fill);
          el.setAttribute("opacity", String(dot.opacity));
          if (dot.d) {
            el.setAttribute("d", dot.d);
            el.setAttribute(
              "transform",
              `translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${RADIUS})`,
            );
          } else {
            el.setAttribute("cx", String(dot.x));
            el.setAttribute("cy", String(dot.y));
            el.setAttribute("r", String(dot.r));
          }
        });
      };
      paintDots(p.dotsBack!, frame.dotsBehind ? frame.dots : []);
      paintDots(p.dotsFront!, frame.dotsBehind ? [] : frame.dots);

      const backs = p.arcBack!.ensure(
        frame.arcs.length,
        () => "path",
      ) as SVGPathElement[];
      const fronts = p.arcFront!.ensure(
        frame.arcs.length,
        () => "path",
      ) as SVGPathElement[];
      const grads = p.gradients!.ensure(
        frame.arcs.length,
        () => "linearGradient",
      ) as SVGLinearGradientElement[];
      frame.arcs.forEach((arc, i) => {
        const grad = grads[i]!;
        grad.setAttribute("id", `bot-grad-${uid}-${i}`);
        grad.setAttribute("gradientUnits", "userSpaceOnUse");
        grad.setAttribute("x1", String(arc.grad.x1));
        grad.setAttribute("y1", String(arc.grad.y1));
        grad.setAttribute("x2", String(arc.grad.x2));
        grad.setAttribute("y2", String(arc.grad.y2));
        let stops = stopsCache.get(grad);
        if (!stops || stops.length !== arc.grad.stops.length) {
          grad.replaceChildren();
          stops = arc.grad.stops.map((c, si) => {
            const stop = document.createElementNS(SVG_NS, "stop");
            stop.setAttribute(
              "offset",
              String(si / (arc.grad.stops.length - 1)),
            );
            stop.setAttribute("stop-color", c);
            grad.appendChild(stop);
            return stop;
          });
          stopsCache.set(grad, stops);
        } else {
          // const capture: narrowing does not survive into the closure
          const cached = stops;
          arc.grad.stops.forEach((c, si) =>
            cached[si]!.setAttribute("stop-color", c),
          );
        }
        for (const [el, d] of [
          [backs[i]!, arc.back],
          [fronts[i]!, arc.front],
        ] as const) {
          el.setAttribute("d", d);
          el.setAttribute("stroke", `url(#bot-grad-${uid}-${i})`);
          el.setAttribute("stroke-width", String(arc.width));
          el.setAttribute("opacity", String(arc.opacity));
        }
      });
    },
    [uid],
  );

  // follow the `.dark` class on <html> — Murmur's single theme source of truth
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      inkRef.current = resolveInk();
      paperRef.current = readPaperHex(isDarkTheme());
      forceThemeRepaint((n) => n + 1);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [resolveInk]);

  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      reducedRef.current = mq.matches;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // props -> engine (timestamped setters are the engine's only intake contract)
  useEffect(() => {
    if (underlyingRef.current === state) return;
    if (eggTimerRef.current !== null) {
      clearTimeout(eggTimerRef.current);
      eggTimerRef.current = null;
    }
    underlyingRef.current = state;
    const now = clockNow();
    displayRef.current = { state, setAt: now };
    engine().setState(state, now);
    // [20260905_Fix_BloubBotReviewFixes] repaint even when paused (engine mutation changed sample() output)
    clockRef.current.paintedAt = -1;
  }, [state, engine, clockNow]);

  useEffect(() => {
    engine().setShape(
      shape ? (SHAPE_BY_ID.get(shape)?.radii ?? null) : null,
      clockNow(),
    );
    // [20260905_Fix_BloubBotReviewFixes] repaint even when paused (engine mutation changed sample() output)
    clockRef.current.paintedAt = -1;
  }, [shape, engine, clockNow]);

  useEffect(() => {
    // [20260905_Feat_TrackingMoods] a prop change is the user's choice —
    // drop any pending mood override so a later release can't restore stale
    const mood = moodRef.current;
    mood.active = false;
    mood.index = 0;
    engine().setExpression(
      expression ? (EXPRESSION_BY_ID.get(expression) ?? null) : null,
      clockNow(),
    );
    // [20260905_Fix_BloubBotReviewFixes] repaint even when paused (engine mutation changed sample() output)
    clockRef.current.paintedAt = -1;
  }, [expression, engine, clockNow]);

  // pointer gaze: only on rest-face states; elsewhere the pose IS the measured
  // animation and a look target would smear it (upstream `aim()` rule)
  useEffect(() => {
    if (frozenAt !== undefined) return;
    const applyGaze = () => {
      const pointer = lastPointerRef.current;
      const now = clockNow();
      if (!pointer || !STATE_BY_ID.get(displayRef.current.state)?.baseFace) {
        engine().setLook(null, now);
        return;
      }
      const box = svgRef.current?.getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) return; // 0/0 -> NaN; the engine keeps its last target
      const nx = clamp(
        (pointer.x - (box.left + box.width / 2)) /
          Math.max(1, window.innerWidth / 2),
        -1,
        1,
      );
      const ny = clamp(
        (pointer.y - (box.top + box.height / 2)) /
          Math.max(1, window.innerHeight / 2),
        -1,
        1,
      );
      engine().setLook(
        {
          yaw: nx * YAW_MAX,
          pitch: PITCH - ny * PITCH_MAX,
          mix: 1,
          spin: 0,
          wander: 0,
        },
        now,
      );
    };
    gazeTickRef.current = applyGaze;
    const releaseGaze = () => {
      lastPointerRef.current = null;
      engine().setLook(null, clockNow());
    };
    const onMove = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      applyGaze();
    };
    // fires for every element boundary crossing as it bubbles; only a leave
    // with no destination element means the pointer left the window
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) releaseGaze();
    };
    const onBlur = () => releaseGaze();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerout", onOut);
    window.addEventListener("blur", onBlur);
    return () => {
      gazeTickRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onOut);
      window.removeEventListener("blur", onBlur);
    };
  }, [frozenAt, engine, clockNow]);

  /** [20260905_Feat_TrackingMoods] issue #227: rotate while tracking. */
  const stepMood = useCallback(
    (now: number) => {
      const mood = moodRef.current;
      const tracking =
        lastPointerRef.current !== null &&
        STATE_BY_ID.get(displayRef.current.state)?.baseFace === true;
      if (tracking) {
        if (!mood.tracking) {
          // tracking just started: arm the first full interval
          mood.tracking = true;
          mood.lastAt = now;
          return;
        }
        if (now - mood.lastAt >= MOOD_INTERVAL_S) {
          const next = EXPRESSION_BY_ID.get(
            TRACKING_MOODS[mood.index % TRACKING_MOODS.length]!,
          );
          if (next) {
            engine().setExpression(next, now);
            mood.active = true;
            mood.index += 1;
            mood.lastAt = now;
          }
        }
      } else if (mood.tracking || mood.active) {
        // tracking ended (pointer left / state changed): morph back to the
        // user's configured expression — the engine glides, so the return is
        // part of the staging, not a cut
        mood.tracking = false;
        mood.active = false;
        mood.index = 0;
        engine().setExpression(
          expression ? (EXPRESSION_BY_ID.get(expression) ?? null) : null,
          now,
        );
      }
    },
    [engine, expression],
  );

  // the single animation loop
  useEffect(() => {
    if (frozenAt !== undefined) {
      paint(engine().sample(frozenAt));
      return;
    }
    let raf = 0;
    clockRef.current.realLast = performance.now();
    clockRef.current.running = playing;
    const tick = () => {
      const c = clockRef.current;
      const realNow = performance.now();
      if (c.running) {
        c.value += Math.min((realNow - c.realLast) / 1000, MAX_FRAME_DELTA);
      }
      c.realLast = realNow;
      if (c.value !== c.paintedAt) {
        const display = displayRef.current;
        if (
          c.running &&
          !reducedRef.current &&
          REPLAY_STATES.has(display.state) &&
          c.value - display.setAt >=
            (STATE_BY_ID.get(display.state)?.duration ?? Infinity)
        ) {
          engine().setState(display.state, c.value);
          display.setAt = c.value;
        }
        gazeTickRef.current?.();
        stepMood(c.value);
        paint(engine().sample(c.value));
        c.paintedAt = c.value;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frozenAt, playing, engine, paint, stepMood]);

  // ink + paper resolution and (frozen) repaint — declared LAST so the frame
  // is painted after the state/shape/expression setters have run (effects
  // execute in declaration order)
  useEffect(() => {
    inkRef.current = resolveInk();
    paperRef.current = readPaperHex(isDarkTheme());
    if (frozenAt !== undefined) paint(engine().sample(frozenAt));
  });

  // an egg outstanding at unmount must not mutate the detached engine
  useEffect(() => {
    return () => {
      if (eggTimerRef.current !== null) clearTimeout(eggTimerRef.current);
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      playOnce: (id: StateId) => {
        if (eggTimerRef.current !== null) clearTimeout(eggTimerRef.current);
        const now = clockNow();
        engine().setState(id, now);
        displayRef.current = { state: id, setAt: now };
        const hold = STATE_BY_ID.get(id)?.duration ?? 2;
        eggTimerRef.current = setTimeout(() => {
          eggTimerRef.current = null;
          const back = clockNow();
          engine().setState(underlyingRef.current, back);
          displayRef.current = { state: underlyingRef.current, setAt: back };
        }, hold * 1000);
      },
      getState: () => displayRef.current.state,
    }),
    [engine, clockNow],
  );

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
      role="img"
      aria-label={ariaLabel}
      className={className}
    >
      <defs ref={gradDefsRef}>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x={-VB}
          y={-VB}
          width={VB * 2}
          height={VB * 2}
        >
          <path ref={maskBodyRef} fill="#fff" />
          <path
            ref={(el) => {
              eyeRefs.current[0] = el;
            }}
            fill="#000"
          />
          <path
            ref={(el) => {
              eyeRefs.current[1] = el;
            }}
            fill="#000"
          />
          <circle ref={notchRef} fill="#000" />
        </mask>
      </defs>
      <g ref={arcBackRef} fill="none" strokeLinecap="round" />
      <g ref={dotsBackRef} />
      <g ref={bodyGroupRef}>
        {/* opaque paper under the body: eye-holes are real holes, and without
            this the back-arcs would reappear inside them */}
        <path ref={paperBodyRef} fill={paperRef.current} />
        <g mask={`url(#${maskId})`}>
          <rect
            ref={inkRectRef}
            x={-VB}
            y={-VB}
            width={VB * 2}
            height={VB * 2}
            fill={inkRef.current}
          />
        </g>
      </g>
      <g ref={dotsFrontRef} />
      {/* all attributes of the badge are paint-owned (visibility included) */}
      <circle ref={notifRef} fill={NOTIF_BLUE} />
      <g ref={arcFrontRef} fill="none" strokeLinecap="round" />
    </svg>
  );
}

export const BloubBot = forwardRef(BloubBotImpl);
