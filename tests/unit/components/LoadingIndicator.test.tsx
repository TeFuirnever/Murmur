// @vitest-environment happy-dom
import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { LoadingIndicator } from "../../../src/components/LoadingIndicator";

describe("LoadingIndicator", () => {
  it("renders 3 dots", () => {
    const { container } = render(<LoadingIndicator />);
    const dots = container.querySelectorAll(".rounded-full");
    expect(dots.length).toBe(3);
  });

  it("applies default size", () => {
    const { container } = render(<LoadingIndicator />);
    const dots = container.querySelectorAll(".rounded-full");
    const first = dots[0] as HTMLElement;
    expect(first.style.height).toBe("12px"); // 20 * 0.6
  });

  it("applies custom size", () => {
    const { container } = render(<LoadingIndicator size={40} />);
    const dots = container.querySelectorAll(".rounded-full");
    const first = dots[0] as HTMLElement;
    expect(first.style.height).toBe("24px"); // 40 * 0.6
  });

  it("applies staggered animation delay", () => {
    const { container } = render(<LoadingIndicator />);
    const dots = container.querySelectorAll(".rounded-full");
    expect((dots[0] as HTMLElement).style.animationDelay).toBe("0s");
    expect((dots[1] as HTMLElement).style.animationDelay).toBe("0.2s");
    expect((dots[2] as HTMLElement).style.animationDelay).toBe("0.4s");
  });
});
