// @vitest-environment happy-dom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import TranscriptionResult from "../../../src/components/TranscriptionResult";

describe("TranscriptionResult", () => {
  it("shows transcription text", () => {
    render(<TranscriptionResult text="hello world" />);
    expect(screen.getByText("hello world")).toBeTruthy();
  });

  it("shows duration when provided", () => {
    render(<TranscriptionResult text="hello" duration={125} />);
    expect(screen.getByText(/2分5秒/)).toBeTruthy();
  });

  it("shows short duration in seconds", () => {
    render(<TranscriptionResult text="hello" duration={45} />);
    expect(screen.getByText(/45秒/)).toBeTruthy();
  });

  it("hides duration section when duration is 0", () => {
    const { container } = render(
      <TranscriptionResult text="hello" duration={0} />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("shows expand button when segments provided", () => {
    render(
      <TranscriptionResult
        text="hello world"
        segments={[{ start_ms: 0, end_ms: 1000, text: "hello" }]}
      />,
    );
    expect(screen.getByText("查看分段详情")).toBeTruthy();
  });

  it("toggles segment details on click", () => {
    render(
      <TranscriptionResult
        text="hello world"
        segments={[
          { start_ms: 0, end_ms: 1000, text: "hello" },
          { start_ms: 1000, end_ms: 2000, text: "world" },
        ]}
      />,
    );
    const toggleBtn = screen.getByText("查看分段详情");
    fireEvent.click(toggleBtn);
    expect(screen.getByText("收起分段详情")).toBeTruthy();
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText("world")).toBeTruthy();
    expect(screen.getByText(/00:00.*00:01/)).toBeTruthy();
  });

  it("hides segment section when no segments", () => {
    render(<TranscriptionResult text="hello" />);
    expect(screen.queryByText("查看分段详情")).toBeNull();
  });
});
