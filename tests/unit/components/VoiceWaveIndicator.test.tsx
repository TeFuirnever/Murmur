// @vitest-environment happy-dom
import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { VoiceWaveIndicator } from "../../../src/components/VoiceWaveIndicator";

describe("VoiceWaveIndicator", () => {
  it("renders 4 bars", () => {
    const { container } = render(<VoiceWaveIndicator isListening={false} />);
    const bars = container.querySelectorAll(".rounded-full");
    expect(bars.length).toBe(4);
  });

  it("shows short bars when not listening", () => {
    const { container } = render(<VoiceWaveIndicator isListening={false} />);
    const bars = container.querySelectorAll(".rounded-full");
    bars.forEach((bar) => {
      expect(bar.classList.contains("h-2")).toBe(true);
    });
  });

  it("shows tall animated bars when listening", () => {
    const { container } = render(<VoiceWaveIndicator isListening={true} />);
    const bars = container.querySelectorAll(".rounded-full");
    bars.forEach((bar) => {
      expect(bar.classList.contains("animate-pulse")).toBe(true);
      expect(bar.classList.contains("h-5")).toBe(true);
    });
  });

  it("applies staggered animation when listening", () => {
    const { container } = render(<VoiceWaveIndicator isListening={true} />);
    const bars = container.querySelectorAll(".rounded-full");
    expect((bars[0] as HTMLElement).style.animationDelay).toBe("0s");
    expect((bars[1] as HTMLElement).style.animationDelay).toContain("0.1");
    expect((bars[2] as HTMLElement).style.animationDelay).toContain("0.2");
  });

  it("has no animation delay when not listening", () => {
    const { container } = render(<VoiceWaveIndicator isListening={false} />);
    const bars = container.querySelectorAll(".rounded-full");
    bars.forEach((bar) => {
      expect((bar as HTMLElement).style.animationDelay).toBe("0s");
    });
  });
});
