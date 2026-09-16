// @vitest-environment jsdom
// [20260729_Test_SonnerToaster] Test the wrapper Toaster component.
import "../setup/react";
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock next-themes to control theme
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

// Mock sonner — render a plain div to avoid CSS/portal issues
vi.mock("sonner", () => ({
  Toaster: ({ theme, className }: { theme?: string; className?: string }) =>
    React.createElement("div", {
      "data-testid": "sonner-toaster",
      "data-theme": theme ?? "",
      className: className ?? "",
    }),
}));

import { Toaster } from "../../src/components/ui/sonner";

describe("Sonner Toaster wrapper", () => {
  it("renders and passes theme from next-themes", () => {
    render(<Toaster />);
    const toaster = screen.getByTestId("sonner-toaster");
    expect(toaster).toBeInTheDocument();
    expect(toaster.getAttribute("data-theme")).toBe("dark");
  });

  it("passes className through", () => {
    render(<Toaster />);
    const toaster = screen.getByTestId("sonner-toaster");
    expect(toaster.className).toContain("toaster");
  });
});
