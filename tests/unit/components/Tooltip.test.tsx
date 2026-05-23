// @vitest-environment happy-dom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Tooltip } from "../../../src/components/Tooltip";

describe("Tooltip", () => {
  it("renders children", () => {
    render(
      <Tooltip content="tip">
        <span>target</span>
      </Tooltip>,
    );
    expect(screen.getByText("target")).toBeTruthy();
  });

  it("does not show tooltip content by default", () => {
    render(
      <Tooltip content="secret tip">
        <span>target</span>
      </Tooltip>,
    );
    expect(screen.queryByText("secret tip")).toBeNull();
  });

  it("shows tooltip content on mouse enter", () => {
    render(
      <Tooltip content="secret tip">
        <span>target</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("target"));
    expect(screen.getByText("secret tip")).toBeTruthy();
  });

  it("hides tooltip content on mouse leave", () => {
    render(
      <Tooltip content="secret tip">
        <span>target</span>
      </Tooltip>,
    );
    const target = screen.getByText("target");
    fireEvent.mouseEnter(target);
    expect(screen.getByText("secret tip")).toBeTruthy();
    fireEvent.mouseLeave(target);
    expect(screen.queryByText("secret tip")).toBeNull();
  });

  it("defaults to top position", () => {
    const { container } = render(
      <Tooltip content="tip">
        <span>target</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("target"));
    const tooltipEl = container.querySelector(".mb-2");
    expect(tooltipEl).toBeTruthy();
  });

  it("supports bottom position", () => {
    const { container } = render(
      <Tooltip content="tip" position="bottom">
        <span>target</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("target"));
    const tooltipEl = container.querySelector(".mt-2");
    expect(tooltipEl).toBeTruthy();
  });
});
