// @vitest-environment jsdom
// [20260926_Fix_398_VocabFailedToasts] VocabManager remove/clear failures
// reused the add-failure toast (vocabAddFailed) for every failure path —
// the wrong message for the action (issue #398). Pins the per-action
// failure toast keys so delete/clear cannot regress onto the add key.
// The t() mock echoes the i18n key, so assertions target keys, not copy.
import "../../setup/react";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

// t() echoes its i18n key — deterministic, no locale backend required.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { toast } from "sonner";
import { VocabManager } from "../../../src/settings/sections/VocabManager";

type TestWindow = Omit<Window, "electronAPI"> & {
  electronAPI?: {
    listVocabCorrections: () => Promise<{
      success: boolean;
      entries: Array<{ wrong: string; right: string }>;
    }>;
    addVocabCorrection: (
      wrong: string,
      right: string,
    ) => Promise<{ success: boolean }>;
    deleteVocabCorrection: (wrong: string) => Promise<{ success: boolean }>;
    clearVocabCorrections: () => Promise<{ success: boolean }>;
  };
};

const originalAPI = (globalThis.window as unknown as TestWindow).electronAPI;

beforeEach(() => {
  (toast.error as ReturnType<typeof vi.fn>).mockClear();
  (globalThis.window as unknown as TestWindow).electronAPI = {
    listVocabCorrections: vi.fn().mockResolvedValue({
      success: true,
      entries: [{ wrong: "A", right: "B" }],
    }),
    addVocabCorrection: vi.fn().mockResolvedValue({ success: false }),
    deleteVocabCorrection: vi.fn().mockResolvedValue({ success: false }),
    clearVocabCorrections: vi.fn().mockResolvedValue({ success: false }),
  };
});

afterEach(() => {
  const win = globalThis.window as unknown as TestWindow;
  if (originalAPI === undefined) delete win.electronAPI;
  else win.electronAPI = originalAPI;
});

async function renderManager() {
  render(<VocabManager />);
  // Mount-time reload resolves before the interactions below.
  await waitFor(() =>
    expect(screen.getByTestId("vocab-manager")).toBeInTheDocument(),
  );
}

describe("[20260926_Fix_398_VocabFailedToasts] VocabManager failure toasts", () => {
  it("add failure shows the add-failure toast key", async () => {
    await renderManager();
    fireEvent.change(screen.getByLabelText("rewrite.wrongWord"), {
      target: { value: "A" },
    });
    fireEvent.change(screen.getByLabelText("rewrite.rightWord"), {
      target: { value: "B" },
    });
    fireEvent.click(screen.getByTestId("vocab-add"));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "settings.general.vocabAddFailed",
      ),
    );
  });

  it("remove failure shows the remove-failure toast key, not the add one", async () => {
    await renderManager();
    fireEvent.click(
      screen.getByRole("button", { name: "settings.general.vocabDelete" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "settings.general.vocabRemoveFailed",
      ),
    );
  });

  it("clear-all failure shows the clear-failure toast key, not the add one", async () => {
    await renderManager();
    // jsdom's window.confirm is a stub that returns nothing - accept the dialog.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByTestId("vocab-clear"));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "settings.general.vocabClearFailed",
      ),
    );
  });
});
