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
import { COLOR_BY_ID, SHAPE_BY_ID } from "../../../src/bot/skins";
import { EXPRESSION_BY_ID } from "../../../src/bot/expressions";

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
    const { container } = render(<BloubBot state="idle" frozenAt={1} />);
    const engine = new BotEngine(100, "idle");
    const expected = engine.sample(1).bodyPath;
    const paths = bodyPaths(container);
    expect(paths).not.toHaveLength(0);
    expect(paths).toContain(expected);
  });

  it("the same frozenAt renders the identical frame across mounts", () => {
    const a = render(<BloubBot state="idle" frozenAt={1.2} />);
    const dA = bodyPaths(a.container);
    a.unmount();
    const b = render(<BloubBot state="idle" frozenAt={1.2} />);
    expect(bodyPaths(b.container)).toEqual(dA);
  });

  it("the state prop drives the rendered frame", () => {
    const { container, rerender } = render(
      <BloubBot state="idle" frozenAt={1} />,
    );
    const before = bodyPaths(container);
    rerender(<BloubBot state="egg" frozenAt={1} />);
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
      <BloubBot state="idle" frozenAt={1} shape="droplet" expression="happy" />,
    );
    const expected = new BotEngine(100, "idle", shape, expr).sample(1).bodyPath;
    expect(bodyPaths(container)).toContain(expected);
  });
});

describe("BloubBot theme default colour", () => {
  it("defaults the body ink to ink on the light theme", () => {
    setDark(false);
    const { container } = render(<BloubBot state="idle" frozenAt={1} />);
    expect(inkRectFill(container)).toBe(INK_HEX);
  });

  it("defaults the body ink to cream under the dark class", () => {
    setDark(true);
    const { container } = render(<BloubBot state="idle" frozenAt={1} />);
    expect(inkRectFill(container)).toBe(CREAM_HEX);
  });

  it("a colour prop overrides the theme default", () => {
    setDark(true);
    const { container } = render(
      <BloubBot state="idle" frozenAt={1} color="blue" />,
    );
    expect(inkRectFill(container)).toBe(COLOR_BY_ID.get("blue")!.hex);
  });
});

describe("BloubBot live mode", () => {
  it("runs no animation loop for a frozen frame", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    render(<BloubBot state="idle" frozenAt={1} />);
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });

  it("cancels the animation loop on unmount", () => {
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame");
    const { unmount } = render(<BloubBot state="idle" />);
    unmount();
    expect(cancel).toHaveBeenCalled();
    cancel.mockRestore();
  });

  it("playOnce flashes an egg state, then returns to the underlying state", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const ref = createRef<BloubBotRef>();
      render(<BloubBot ref={ref} state="idle" />);
      await nextFrame();
      const before = bodyPaths(document.body);

      ref.current!.playOnce("burst");
      await nextFrame();
      await nextFrame();
      const duringEgg = bodyPaths(document.body);
      expect(duringEgg).not.toHaveLength(0);
      expect(duringEgg.join("|")).not.toBe(before.join("|"));

      // past the egg's duration (burst holds 2.6 s) the shell is back on idle
      await act(async () => {
        vi.advanceTimersByTime(2700);
      });
      await nextFrame();
      await nextFrame();
      const afterReturn = bodyPaths(document.body);
      expect(afterReturn).not.toHaveLength(0);
      expect(afterReturn.join("|")).not.toBe(duringEgg.join("|"));
    } finally {
      vi.useRealTimers();
    }
  });
});
