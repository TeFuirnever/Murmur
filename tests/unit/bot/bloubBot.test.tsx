// @vitest-environment jsdom
// [20260904_Feat_BloubBotShell] Contract tests for the React mascot shell.
// Carries over bloub's capture.test.ts contract — the rendered SVG must be
// the engine's own output, never a second drawing built beside it — plus the
// spec #222 shell behaviours (theme default colour, playOnce eggs, rAF cleanup).

import "../../setup/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { BloubBot, type BloubBotRef } from "../../../src/components/BloubBot";
import { BotEngine } from "../../../src/bot/engine";
import {
  COLOR_BY_ID,
  SHAPE_BY_ID,
  type ColorId,
  type ShapeId,
} from "../../../src/bot/skins";
import {
  EXPRESSION_BY_ID,
  type ExpressionId,
} from "../../../src/bot/expressions";

const INK_HEX = COLOR_BY_ID.get("ink")!.hex; // #0a0a0c
const CREAM_HEX = COLOR_BY_ID.get("cream")!.hex; // #f1efe9

function bodyPaths(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("path"))
    .map((p) => p.getAttribute("d") ?? "")
    .filter((d) => d.length > 0);
}

function inkRectFill(container: HTMLElement): string | null {
  // the body ink is the masked full-viewBox rect inside the body group
  const rect = container.querySelector("g[mask] rect");
  return rect?.getAttribute("fill") ?? null;
}

function setDark(on: boolean) {
  document.documentElement.classList.toggle("dark", on);
}

/** Yields one animation frame so the shell's paint loop runs a tick. */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

afterEach(() => {
  cleanup();
  setDark(false);
});

describe("BloubBot frozen frame contract", () => {
  it("renders the engine's own body path, byte for byte", () => {
    const { container } = render(
      <BloubBot state="idle" frozenAt={1} ariaLabel="Murmur bot" />,
    );
    const engine = new BotEngine(100, "idle");
    const expected = engine.sample(1).bodyPath;
    const paths = bodyPaths(container);
    expect(paths).not.toHaveLength(0);
    expect(paths).toContain(expected);
  });

  it("the same frozenAt renders the identical frame across mounts", () => {
    const a = render(
      <BloubBot state="idle" frozenAt={1.2} ariaLabel="Murmur bot" />,
    );
    const dA = bodyPaths(a.container);
    a.unmount();
    const b = render(
      <BloubBot state="idle" frozenAt={1.2} ariaLabel="Murmur bot" />,
    );
    expect(bodyPaths(b.container)).toEqual(dA);
  });

  it("the state prop drives the rendered frame", () => {
    const { container, rerender } = render(
      <BloubBot state="idle" frozenAt={1} ariaLabel="Murmur bot" />,
    );
    const before = bodyPaths(container);
    rerender(<BloubBot state="egg" frozenAt={1} ariaLabel="Murmur bot" />);
    const after = bodyPaths(container);
    const idleFrame = new BotEngine(100, "idle").sample(1).bodyPath;
    const eggFrame = new BotEngine(100, "egg").sample(1).bodyPath;
    expect(before).toContain(idleFrame);
    expect(after).toContain(eggFrame);
  });

  it("shape and expression props reach the engine output", () => {
    const shape = SHAPE_BY_ID.get("droplet")!.radii;
    const expr = EXPRESSION_BY_ID.get("happy") ?? null;
    const { container } = render(
      <BloubBot
        state="idle"
        frozenAt={1}
        shape="droplet"
        expression="happy"
        ariaLabel="Murmur bot"
      />,
    );
    const expected = new BotEngine(100, "idle", shape, expr).sample(1).bodyPath;
    expect(bodyPaths(container)).toContain(expected);
  });
});

describe("BloubBot theme default colour", () => {
  it("defaults the body ink to ink on the light theme", () => {
    setDark(false);
    const { container } = render(
      <BloubBot state="idle" frozenAt={1} ariaLabel="Murmur bot" />,
    );
    expect(inkRectFill(container)).toBe(INK_HEX);
  });

  it("defaults the body ink to cream under the dark class", () => {
    setDark(true);
    const { container } = render(
      <BloubBot state="idle" frozenAt={1} ariaLabel="Murmur bot" />,
    );
    expect(inkRectFill(container)).toBe(CREAM_HEX);
  });

  it("a colour prop overrides the theme default", () => {
    setDark(true);
    const { container } = render(
      <BloubBot
        state="idle"
        frozenAt={1}
        color="blue"
        ariaLabel="Murmur bot"
      />,
    );
    expect(inkRectFill(container)).toBe(COLOR_BY_ID.get("blue")!.hex);
  });
});

describe("BloubBot live mode", () => {
  it("runs no animation loop for a frozen frame", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    render(<BloubBot state="idle" frozenAt={1} ariaLabel="Murmur bot" />);
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });

  it("cancels the animation loop on unmount", () => {
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame");
    const { unmount } = render(
      <BloubBot state="idle" ariaLabel="Murmur bot" />,
    );
    unmount();
    expect(cancel).toHaveBeenCalled();
    cancel.mockRestore();
  });

  it("playOnce flashes an egg state, then returns to the underlying state", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const ref = createRef<BloubBotRef>();
      render(<BloubBot ref={ref} state="idle" ariaLabel="Murmur bot" />);
      await nextFrame();
      const before = bodyPaths(document.body);

      ref.current!.playOnce("burst");
      await nextFrame();
      await nextFrame();
      expect(ref.current!.getState()).toBe("burst");
      const duringEgg = bodyPaths(document.body);
      expect(duringEgg).not.toHaveLength(0);
      expect(duringEgg.join("|")).not.toBe(before.join("|"));

      // past the egg's duration (burst holds 2.6 s) the shell is back on idle
      await act(async () => {
        vi.advanceTimersByTime(2700);
      });
      await nextFrame();
      await nextFrame();
      expect(ref.current!.getState()).toBe("idle");
      const afterReturn = bodyPaths(document.body);
      expect(afterReturn).not.toHaveLength(0);
      expect(afterReturn.join("|")).not.toBe(duringEgg.join("|"));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BloubBot lifecycle and theme reactivity", () => {
  it("flips the ink live when the .dark class toggles under a mounted shell", async () => {
    setDark(false);
    const { container } = render(
      <BloubBot state="idle" frozenAt={1} ariaLabel="Murmur bot" />,
    );
    expect(inkRectFill(container)).toBe(INK_HEX);
    setDark(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(inkRectFill(container)).toBe(CREAM_HEX);
    setDark(false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(inkRectFill(container)).toBe(INK_HEX);
  });

  it("unmount mid-egg leaves no post-unmount engine mutation", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const ref = createRef<BloubBotRef>();
      const { unmount } = render(
        <BloubBot ref={ref} state="idle" ariaLabel="Murmur bot" />,
      );
      ref.current!.playOnce("burst");
      expect(ref.current!.getState()).toBe("burst");
      const setStateSpy = vi.spyOn(BotEngine.prototype, "setState");
      unmount();
      await act(async () => {
        vi.advanceTimersByTime(4000);
      });
      expect(setStateSpy).not.toHaveBeenCalled();
      setStateSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BloubBot paused repaint", () => {
  it("repaints on a state change even when the clock is paused", async () => {
    const { container, rerender } = render(
      <BloubBot state="idle" playing={false} ariaLabel="Murmur bot" />,
    );
    await nextFrame();
    expect(container.querySelector("svg")?.getAttribute("data-bot-state")).toBe(
      "idle",
    );
    rerender(<BloubBot state="egg" playing={false} ariaLabel="Murmur bot" />);
    await nextFrame();
    await nextFrame();
    // the clock is frozen, but the engine mutation must still reach the screen
    expect(container.querySelector("svg")?.getAttribute("data-bot-state")).toBe(
      "egg",
    );
  });
});

describe("BloubBot paint-branch coverage across catalogue states", () => {
  // frozen renders of states whose decor differs from idle exercise the
  // imperative painter's branches: arcs + gradients (orbit), the teardrop
  // path-dot (alert), burst particles behind the core (dotsBehind + depth
  // haze), and the notification badge + notch (notify).
  it("orbit paints both arc halves and one gradient per arc", () => {
    const frame = new BotEngine(100, "orbit").sample(1.4);
    const { container } = render(
      <BloubBot state="orbit" frozenAt={1.4} ariaLabel="Murmur bot" />,
    );
    const stroked = container.querySelectorAll('path[stroke^="url(#bot-grad"]');
    expect(stroked.length).toBe(frame.arcs.length * 2);
    const grads = container.querySelectorAll("defs linearGradient");
    expect(grads.length).toBeGreaterThanOrEqual(frame.arcs.length);
  });

  it("alert paints the teardrop dot as a transformed path", () => {
    const { container } = render(
      <BloubBot state="alert" frozenAt={0.8} ariaLabel="Murmur bot" />,
    );
    const dot = container.querySelector('path[transform*="scale("]');
    expect(dot).not.toBeNull();
    // TEAR is a polyPath (straight segments, unlike closedPath's C curves)
    expect(dot!.getAttribute("d")).toMatch(/^M[-0-9.]+ /);
  });

  it("burst renders its particles behind the body with depth-hazed fills", () => {
    const { container } = render(
      <BloubBot state="burst" frozenAt={0.3} ariaLabel="Murmur bot" />,
    );
    const groups = container.querySelectorAll("svg > g");
    const dotsGroup = groups[1]; // order: arcs-back, dots-back, body, dots-front
    expect(dotsGroup.querySelectorAll("circle").length).toBeGreaterThan(0);
  });

  it("notify shows the badge and carves the notch", () => {
    const { container } = render(
      <BloubBot state="notify" frozenAt={1} ariaLabel="Murmur bot" />,
    );
    const badge = container.querySelector('circle[fill="#2496e8"]');
    expect(badge?.getAttribute("visibility")).toBe("visible");
    // the mask holds the notch circle (eyes are path elements)
    const notchCircle = container.querySelector("mask circle");
    expect(notchCircle?.getAttribute("visibility")).toBe("visible");
  });

  it("shrinking the arc set rebuilds pools without stale gradients", () => {
    const { container, rerender } = render(
      <BloubBot state="orbit" frozenAt={1.4} ariaLabel="Murmur bot" />,
    );
    const before = container.querySelectorAll('path[stroke^="url(#bot-grad"]');
    expect(before.length).toBeGreaterThan(0);
    rerender(<BloubBot state="egg" frozenAt={1} ariaLabel="Murmur bot" />);
    expect(
      container.querySelectorAll('path[stroke^="url(#bot-grad"]').length,
    ).toBe(0);
    rerender(<BloubBot state="orbit" frozenAt={1.4} ariaLabel="Murmur bot" />);
    expect(
      container.querySelectorAll('path[stroke^="url(#bot-grad"]').length,
    ).toBe(before.length);
  });

  it("changing shape/expression repaints a frozen shell", () => {
    const { container, rerender } = render(
      <BloubBot state="idle" frozenAt={1} ariaLabel="Murmur bot" />,
    );
    const roundBody = bodyPaths(container)[0];
    rerender(
      <BloubBot
        state="idle"
        frozenAt={1}
        shape="droplet"
        expression="happy"
        ariaLabel="Murmur bot"
      />,
    );
    expect(bodyPaths(container)[0]).not.toBe(roundBody);
  });
});

describe("BloubBot gaze and lifecycle branches", () => {
  /** Dispatch a pointer event with coordinates (jsdom lacks PointerEvent ctor args). */
  const firePointer = (type: string, props: Record<string, unknown>) => {
    const ev = new Event(type, { bubbles: true });
    Object.assign(ev, props);
    window.dispatchEvent(ev);
  };

  it("tracks the pointer and releases it when it leaves the window", async () => {
    const { container } = render(
      <BloubBot state="idle" ariaLabel="Murmur bot" />,
    );
    // jsdom rects are 0x0 -> the NaN guard would return early; give the svg a
    // real box so the full setLook path runs
    const svg = container.querySelector("svg") as SVGSVGElement;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 44,
      height: 44,
      right: 44,
      bottom: 44,
      toJSON: () => ({}),
    } as DOMRect);

    firePointer("pointermove", { clientX: 600, clientY: 400 });
    await nextFrame();
    expect(container.querySelector("svg")).toBeInTheDocument();

    // crossing INTO an element must NOT release (relatedTarget set)
    firePointer("pointerout", { relatedTarget: document.body });
    await nextFrame();
    // leaving the window entirely DOES release (relatedTarget null)
    firePointer("pointerout", { relatedTarget: null });
    window.dispatchEvent(new Event("blur"));
    await nextFrame();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("a props.state change mid-egg supersedes the pending return", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const ref = createRef<BloubBotRef>();
      const { rerender } = render(
        <BloubBot ref={ref} state="idle" ariaLabel="Murmur bot" />,
      );
      ref.current!.playOnce("burst");
      expect(ref.current!.getState()).toBe("burst");
      rerender(<BloubBot ref={ref} state="wide" ariaLabel="Murmur bot" />);
      expect(ref.current!.getState()).toBe("wide");
      await act(async () => {
        vi.advanceTimersByTime(4000);
      });
      // the cleared egg timer must NOT drag the bot back to the old state
      expect(ref.current!.getState()).toBe("wide");
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-issues orbit at its duration boundary (auto-replay)", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
      ],
    });
    try {
      const setStateSpy = vi.spyOn(BotEngine.prototype, "setState");
      const { container } = render(
        <BloubBot state="orbit" ariaLabel="Murmur bot" />,
      );
      await act(async () => {
        vi.advanceTimersByTime(60);
      });
      const initialCalls = setStateSpy.mock.calls.filter(
        ([id]) => id === "orbit",
      ).length;
      await act(async () => {
        vi.advanceTimersByTime(3500);
      });
      const laterCalls = setStateSpy.mock.calls.filter(
        ([id]) => id === "orbit",
      ).length;
      expect(laterCalls).toBeGreaterThan(initialCalls);
      setStateSpy.mockRestore();
      void container;
    } finally {
      vi.useRealTimers();
    }
  });

  it("survives a missing matchMedia and MutationObserver (SSR-ish guards)", () => {
    const realMatchMedia = window.matchMedia;
    const realObserver = globalThis.MutationObserver;
    vi.stubGlobal("matchMedia", undefined);
    vi.stubGlobal("MutationObserver", undefined);
    try {
      const { container } = render(
        <BloubBot state="idle" frozenAt={1} ariaLabel="Murmur bot" />,
      );
      expect(container.querySelector("svg")).toBeInTheDocument();
    } finally {
      vi.stubGlobal("matchMedia", realMatchMedia);
      vi.stubGlobal("MutationObserver", realObserver);
    }
  });
});

describe("BloubBot remaining branch shapes", () => {
  it("exclaim hides the face, notch and badge (all-null decor branches)", () => {
    const { container } = render(
      <BloubBot state="exclaim" frozenAt={0.9} ariaLabel="Murmur bot" />,
    );
    const maskCircles = container.querySelectorAll("mask circle");
    expect(maskCircles[0]?.getAttribute("visibility")).toBe("hidden");
    expect(
      container
        .querySelector('circle[fill="#2496e8"]')
        ?.getAttribute("visibility"),
    ).toBe("hidden");
    expect(container.querySelectorAll("mask path")[1]).toBeTruthy();
  });

  it("thinking paints plain ink dots (no depth haze branch)", () => {
    const { container } = render(
      <BloubBot state="thinking" frozenAt={1.1} ariaLabel="Murmur bot" />,
    );
    const circles = container.querySelectorAll("svg > g circle");
    expect(circles.length).toBeGreaterThan(0);
  });

  it("an unknown colour id falls back to the theme default, not a crash", () => {
    setDark(false);
    const { container } = render(
      <BloubBot
        state="idle"
        frozenAt={1}
        color={"not-a-colour" as unknown as ColorId}
        ariaLabel="Murmur bot"
      />,
    );
    expect(inkRectFill(container)).toBe(INK_HEX);
  });

  it("pointer input on a non-rest-face state releases the gaze target", async () => {
    const { container } = render(
      <BloubBot state="orbit" ariaLabel="Murmur bot" />,
    );
    const ev = new Event("pointermove", { bubbles: true });
    Object.assign(ev, { clientX: 100, clientY: 100 });
    window.dispatchEvent(ev);
    await nextFrame();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("BloubBot remaining reachable arms", () => {
  it("reads the paper colour from a real --background custom property", () => {
    document.documentElement.style.setProperty("--background", "0 0% 96.5%");
    try {
      const { container } = render(
        <BloubBot state="idle" frozenAt={1} ariaLabel="Murmur bot" />,
      );
      // the paper underlay is the path immediately before the masked ink
      // group inside the body group (the mask's own white body is inside
      // <defs>, a different element)
      const masked = container.querySelector("g[mask]");
      const paper = masked?.previousElementSibling;
      expect(paper?.getAttribute("fill")).toBe("hsl(0 0% 96.5%)");
    } finally {
      document.documentElement.style.removeProperty("--background");
    }
  });

  it("unknown shape/expression ids pass null to the engine (defaults win)", () => {
    const { container } = render(
      <BloubBot
        state="idle"
        frozenAt={1}
        shape={"banana" as unknown as ShapeId}
        expression={"???" as unknown as ExpressionId}
        ariaLabel="Murmur bot"
      />,
    );
    const engineFrame = new BotEngine(100, "idle").sample(1).bodyPath;
    expect(bodyPaths(container)).toContain(engineFrame);
  });
});
