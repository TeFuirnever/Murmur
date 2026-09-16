// @vitest-environment happy-dom
// [20260815_Refactor_LoadingDotsCss] LoadingIndicator and LoadingDots were two
// implementations of the same wave animation (inline-style keyframes vs a
// 350ms setInterval re-render). This suite locks the merged CSS-driven
// LoadingDots: three dots animated by the `loading-dots` keyframes from
// src/index.css with staggered delays, no JS timer.
import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { LoadingDots } from "../../../src/components/ui/loading-dots";

describe("[20260815_Refactor_LoadingDotsCss] LoadingDots", () => {
  it("renders three dots driven by the loading-dots keyframes", () => {
    const { container } = render(<LoadingDots />);
    const dots = container.querySelectorAll(".rounded-full");
    expect(dots.length).toBe(3);
    for (const dot of Array.from(dots)) {
      expect((dot as HTMLElement).style.animation).toContain("loading-dots");
    }
  });

  it("staggers each dot by 0.15s", () => {
    const { container } = render(<LoadingDots />);
    const dots = container.querySelectorAll(".rounded-full");
    expect((dots[0] as HTMLElement).style.animationDelay).toBe("0s");
    expect((dots[1] as HTMLElement).style.animationDelay).toBe("0.15s");
    expect((dots[2] as HTMLElement).style.animationDelay).toBe("0.3s");
  });

  // [20260815_Refactor_LoadingDotsCss] Sites on the solid bg-primary button
  // (ProcessingPanel) need white dots — the default gray is ~1:1 contrast on
  // --primary in light mode (architect review finding).
  it("applies a custom dot color class when provided", () => {
    const { container } = render(<LoadingDots dotClassName="bg-white" />);
    const dots = container.querySelectorAll(".rounded-full");
    for (const dot of Array.from(dots)) {
      expect((dot as HTMLElement).className).toContain("bg-white");
    }
  });
});
