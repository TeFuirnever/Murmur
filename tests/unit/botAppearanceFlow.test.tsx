// @vitest-environment jsdom
// [20260905_Test_BotBranchRecovery] End-to-end pin for the settings ->
// mascot appearance flow (spec #224 tickets 3+5): stored bot_* keys must
// travel App's reactive botAppearance state into BloubBot's prop override
// chain, and "auto"/invalid values must fall back to the theme-aware
// default instead of crashing. Also covers the false arms of the
// membership guards added at the App boundary.

import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("../../src/hooks/useRecording", () => ({
  useRecording: () => ({
    isRecording: false,
    isProcessing: false,
    isOptimizing: false,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    error: null,
  }),
  determineProcessingMode: vi.fn(() => "optimize"),
}));

vi.mock("../../src/hooks/useModelStatus", () => ({
  useModelStatus: () => ({
    stage: "ready",
    isReady: true,
    downloadProgress: 0,
    error: null,
    downloadModels: vi.fn(),
    checkModelStatus: vi.fn(),
  }),
  ModelStatusProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

vi.mock("../../src/hooks/useHotkey", () => ({
  useHotkey: () => ({
    hotkey: "Cmd+Shift+Space",
    registerHotkey: vi.fn().mockResolvedValue(undefined),
    unregisterHotkey: vi.fn(),
    syncRecordingState: vi.fn(),
  }),
}));

vi.mock("../../src/hooks/useWindowDrag", () => ({
  useWindowDrag: () => ({
    isDragging: false,
    handleMouseDown: vi.fn(),
    handleMouseMove: vi.fn(),
    handleMouseUp: vi.fn(),
    handleClick: () => true,
  }),
}));

// per-key setting store, the shape refreshSettingsCache actually reads
const settingStore: Record<string, unknown> = {};

beforeEach(() => {
  Object.keys(settingStore).forEach((k) => delete settingStore[k]);
  const handlers: Record<string, unknown> = {
    getSetting: vi.fn((key: string, fallback: unknown) =>
      Promise.resolve(key in settingStore ? settingStore[key] : fallback),
    ),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getAllSettings: vi.fn().mockResolvedValue({}),
    copyText: vi.fn().mockResolvedValue(undefined),
    onHotkeyTriggered: vi.fn(() => () => {}),
    onWindowMaximizeChange: vi.fn(() => () => {}),
    onSettingsUpdate: vi.fn(() => () => {}),
    onModelStatusUpdate: vi.fn(() => () => {}),
    getAIModes: vi.fn().mockResolvedValue([]),
    setAlwaysOnTop: vi.fn(),
  };
  (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI =
    handlers;
});

// Import AFTER mocks
import App from "../../src/App";
import { BotEngine } from "../../src/bot/engine";

// scope to the mascot svg: the document's first <path> is a UI icon
function firstBodyPath(): string {
  return (
    document.querySelector("svg[data-bot-state] path")?.getAttribute("d") ?? ""
  );
}

describe("[20260905_Test_BotBranchRecovery] stored appearance flows to the mascot", () => {
  it("applies stored shape/colour/expression through the override chain", async () => {
    settingStore.bot_shape = "droplet";
    settingStore.bot_color = "blue";
    settingStore.bot_expression = "happy";
    render(React.createElement(App));
    // the rAF clock starts near 0; droplet silhouette differs from circle
    await waitFor(
      () => {
        expect(firstBodyPath()).not.toBe("");
      },
      { timeout: 3000 },
    );
    // shape assertion: body path length differs markedly from the circle's
    // (droplet radii vary); assert NOT the circle frame instead of byte
    // equality (clock keeps running)
    const circleFrame = new BotEngine(100, "idle").sample(0).bodyPath;
    expect(firstBodyPath()).not.toBe(circleFrame);
    // ink rect carries the stored colour (the getSetting promises land after
    // first paint; poll until the override chain repaints the rect)
    await expect
      .poll(
        async () =>
          document.querySelector("g[mask] rect")?.getAttribute("fill"),
        { timeout: 3000 },
      )
      .toBe("#3b93f0");
  });

  it("treats bot_color=auto as the theme default, not a literal id", async () => {
    settingStore.bot_color = "auto";
    render(React.createElement(App));
    await waitFor(() => expect(firstBodyPath()).not.toBe(""));
    const rect = document.querySelector("g[mask] rect");
    // light theme (no .dark class) -> ink default
    expect(rect?.getAttribute("fill")).toBe("#0a0a0c");
  });

  it("drops unknown stored ids to the catalogue default", async () => {
    settingStore.bot_shape = "banana";
    settingStore.bot_expression = "???";
    render(React.createElement(App));
    await waitFor(() => expect(firstBodyPath()).not.toBe(""));
    const circleFrame = new BotEngine(100, "idle").sample(0).bodyPath;
    // unknown shape -> undefined prop -> circle silhouette (allowing for the
    // running clock, assert the first anchor x matches the circle's)
    expect(firstBodyPath().slice(0, 8)).toBe(circleFrame.slice(0, 8));
  });
});
