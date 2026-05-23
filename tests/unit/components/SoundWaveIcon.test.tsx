// @vitest-environment happy-dom
import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SoundWaveIcon } from "../../../src/components/SoundWaveIcon";

describe("SoundWaveIcon", () => {
  it("renders 4 bars", () => {
    const { container } = render(<SoundWaveIcon />);
    const bars = container.querySelectorAll(".rounded-full");
    expect(bars.length).toBe(4);
  });

  it("renders in inactive state by default", () => {
    const { container } = render(<SoundWaveIcon />);
    const bars = container.querySelectorAll(".rounded-full");
    const first = bars[0] as HTMLElement;
    expect(first.style.height).toBe("6.4px"); // 16 * 0.4
    expect(first.classList.contains("wave-bar")).toBe(false);
  });

  it("renders in active state", () => {
    const { container } = render(<SoundWaveIcon isActive />);
    const bars = container.querySelectorAll(".rounded-full");
    const first = bars[0] as HTMLElement;
    expect(first.style.height).toBe("12.8px"); // 16 * 0.8
    expect(first.classList.contains("wave-bar")).toBe(true);
  });

  it("applies custom size", () => {
    const { container } = render(<SoundWaveIcon size={32} />);
    const bars = container.querySelectorAll(".rounded-full");
    const first = bars[0] as HTMLElement;
    expect(first.style.height).toBe("12.8px"); // 32 * 0.4
    expect(first.style.width).toBe("4.8px"); // 32 * 0.15
  });

  it("applies staggered animation delay when active", () => {
    const { container } = render(<SoundWaveIcon isActive />);
    const bars = container.querySelectorAll(".rounded-full");
    expect((bars[0] as HTMLElement).style.animationDelay).toBe("0s");
    expect((bars[1] as HTMLElement).style.animationDelay).toBe("0.1s");
    expect((bars[2] as HTMLElement).style.animationDelay).toBe("0.2s");
    expect((bars[3] as HTMLElement).style.animationDelay).toContain("0.3");
  });
});
