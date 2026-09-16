// @vitest-environment jsdom
// [20260910_Feat_237_StreamDegradation] TDD for the T10 settings-page
// degradation-memory panel: list rendering, empty state, and the reset
// round-trip (reset → reload). The bridge is stubbed per test.
import "../setup/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { StreamDegradationManager } from "../../src/settings/sections/StreamDegradationManager";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function bridgeWith(
  entries: Array<{ baseUrl: string; at: number }>,
  resetImpl?: () => Promise<{ success: boolean; removed: number }>,
) {
  const list = vi.fn(async () => ({ success: true, entries }));
  const reset = vi.fn(
    resetImpl ?? (async () => ({ success: true, removed: entries.length })),
  );
  (window as { electronAPI?: unknown }).electronAPI = {
    listStreamDegradations: list,
    resetStreamDegradations: reset,
  };
  return { list, reset };
}

describe("[20260910_Feat_237_StreamDegradation] StreamDegradationManager", () => {
  beforeEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it("lists remembered gateways", async () => {
    bridgeWith([
      { baseUrl: "https://gw-a.example.com/v1", at: 1_757_000_000_000 },
      { baseUrl: "https://gw-b.example.com/v1", at: 1_757_000_100_000 },
    ]);
    render(<StreamDegradationManager />);
    await screen.findByText("https://gw-a.example.com/v1");
    expect(screen.getByText("https://gw-b.example.com/v1")).toBeInTheDocument();
  });

  it("shows the empty state when nothing is remembered", async () => {
    bridgeWith([]);
    const { container } = render(<StreamDegradationManager />);
    await waitFor(() =>
      expect(
        container.querySelector("[data-testid='stream-degradation-empty']"),
      ).not.toBeNull(),
    );
  });

  it("reset clears the memory and reloads the list", async () => {
    let entries = [{ baseUrl: "https://gw.example.com/v1", at: 1 }];
    const { reset, list } = bridgeWith(entries, async () => {
      entries = [];
      return { success: true, removed: 1 };
    });
    // The list stub closes over the initial array; re-point it per call.
    list.mockImplementation(async () => ({ success: true, entries }));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<StreamDegradationManager />);
    await screen.findByText("https://gw.example.com/v1");
    fireEvent.click(screen.getByTestId("stream-degradation-reset"));

    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
    await screen.findByTestId("stream-degradation-empty");
  });

  it("surfaces a reset failure instead of clearing silently", async () => {
    bridgeWith([{ baseUrl: "https://gw.example.com/v1", at: 1 }], async () => {
      throw new Error("ipc down");
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { toast } = await import("sonner");

    render(<StreamDegradationManager />);
    await screen.findByText("https://gw.example.com/v1");
    fireEvent.click(screen.getByTestId("stream-degradation-reset"));

    // The failure is surfaced AND the entry stays — no silent clear.
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText("https://gw.example.com/v1")).toBeInTheDocument();
  });
});
