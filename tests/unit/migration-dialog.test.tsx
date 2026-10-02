// [20261002_T9_MigrationUx] Ticket #420: the migration dialog. AC coverage:
//   AC1 — the upgrade first-launch prompt shows the explicit notice (volume +
//          impact), and NO download ever starts on its own;
//   AC3 — "defer" dismisses without any download call (the app keeps working
//          on the torch fallback; the next launch re-prompts via the
//          provider's mount-time check);
//   AC5 — a failed download renders the actionable error (the main-process
//          network/proxy message) with a settings pointer and retry;
//   plus: fresh-install shape (no torch fallback) must NOT show the dialog —
//   the legacy need_download flow owns that case.
// Pattern: useModelStatus.test.tsx (jsdom, stubbed bridge) + a11y queries.
// @vitest-environment jsdom
import "../setup/react";
// [20261002_T9_MigrationUx] The real i18n resources: interpolation of
// {{size}} needs the initialized instance (main.tsx does `import "./i18n"`;
// jsdom tests must do the same) and a PINNED language — jsdom's
// navigator.language picks "en", so the assertions below change it to
// zh-CN explicitly.
import "../../src/i18n";
import i18n from "../../src/i18n";
import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ModelStatusProvider,
  useModelStatus,
} from "../../src/hooks/useModelStatus";
import MigrationDialog from "../../src/components/MigrationDialog";
import type { ElectronAPI } from "../../src/electronAPI";
import type { ModelCheckResult, FunASRStatusResult } from "../../src/types/ipc";

type TestWindow = Omit<Window, "electronAPI"> & { electronAPI?: ElectronAPI };

const NOOP_UNSUB = () => {};

const MODEL_FILES_READY: ModelCheckResult = {
  success: true,
  models_downloaded: true,
  minimum_ready: true,
  missing_models: [],
};

const SERVER_READY: FunASRStatusResult = {
  success: true,
  installed: true,
  models_downloaded: true,
  initializing: false,
  models_initialized: true,
};

const MIGRATION_NEEDED = {
  needed: true,
  onnx_ready: false,
  torch_fallback_available: true,
  total_bytes: 704_000_000,
  remaining_bytes: 704_000_000,
};

function makeElectronAPIStub(
  overrides: Partial<ElectronAPI> = {},
): ElectronAPI {
  return {
    checkModelFiles: vi.fn().mockResolvedValue(MODEL_FILES_READY),
    checkFunASRStatus: vi.fn().mockResolvedValue(SERVER_READY),
    downloadModels: vi.fn().mockResolvedValue({ success: true }),
    onModelDownloadProgress: vi.fn().mockReturnValue(NOOP_UNSUB),
    onSettingsUpdate: vi.fn().mockReturnValue(NOOP_UNSUB),
    log: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ElectronAPI;
}

function DialogHarness() {
  // A probe: lets tests read the live context state alongside the dialog.
  const status = useModelStatus();
  return (
    <>
      <MigrationDialog />
      <span data-testid="probe-dismissed">
        {status.migration.dismissed ? "yes" : "no"}
      </span>
    </>
  );
}

function renderDialog(stub: ElectronAPI) {
  (globalThis.window as TestWindow).electronAPI = stub;
  return render(
    <ModelStatusProvider>
      <DialogHarness />
    </ModelStatusProvider>,
  );
}

describe("[20261002_T9_MigrationUx] MigrationDialog (#420)", () => {
  let originalAPI: ElectronAPI | undefined;

  beforeAll(() => {
    void i18n.changeLanguage("zh-CN");
  });

  beforeEach(() => {
    originalAPI = (globalThis.window as TestWindow | undefined)?.electronAPI;
  });

  afterEach(() => {
    const win = globalThis.window as TestWindow;
    if (originalAPI !== undefined) {
      win.electronAPI = originalAPI;
    }
  });

  it("AC1: shows the explicit notice (volume + impact) and never auto-downloads", async () => {
    const downloadOnnxModels = vi.fn().mockResolvedValue({ success: true });
    renderDialog(
      makeElectronAPIStub({
        checkOnnxMigration: vi.fn().mockResolvedValue(MIGRATION_NEEDED),
        downloadOnnxModels,
      }),
    );

    const overlay = await screen.findByTestId("migration-overlay");
    expect(overlay).toBeDefined();
    // Volume interpolated from the computed status (704000000 → 671 MB).
    expect(screen.getByTestId("migration-body").textContent).toContain("671");
    expect(screen.getByTestId("migration-body").textContent).toContain("转写");
    // The resume promise is part of the notice.
    expect(screen.getByTestId("migration-body").textContent).toContain(
      "断点续传",
    );
    // The fallback note: the old model keeps serving while deferred.
    expect(screen.getByTestId("migration-fallback-note")).toBeDefined();

    // No silent background pull: the download must wait for the explicit CTA.
    await waitFor(() => {
      expect(
        screen.getByTestId("migration-download").getAttribute("disabled"),
      ).toBeNull();
    });
    expect(downloadOnnxModels).not.toHaveBeenCalled();
  });

  it("AC1-fresh: no torch fallback (fresh install shape) → dialog stays hidden", async () => {
    renderDialog(
      makeElectronAPIStub({
        checkOnnxMigration: vi.fn().mockResolvedValue({
          ...MIGRATION_NEEDED,
          torch_fallback_available: false,
        }),
      }),
    );
    await waitFor(() => {
      expect(screen.queryByTestId("migration-overlay")).toBeNull();
    });
  });

  it("AC3: defer dismisses the dialog without any download call", async () => {
    const downloadOnnxModels = vi.fn().mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderDialog(
      makeElectronAPIStub({
        checkOnnxMigration: vi.fn().mockResolvedValue(MIGRATION_NEEDED),
        downloadOnnxModels,
      }),
    );

    const defer = await screen.findByTestId("migration-defer");
    await user.click(defer);

    await waitFor(() => {
      expect(screen.queryByTestId("migration-overlay")).toBeNull();
    });
    expect(downloadOnnxModels).not.toHaveBeenCalled();
    expect(screen.getByTestId("probe-dismissed").textContent).toBe("yes");
  });

  it("AC1: download-now triggers the download and shows progress", async () => {
    let progressCb: ((...args: unknown[]) => void) | undefined;
    let resolveDownload: (r: { success: boolean }) => void = () => {};
    const downloadOnnxModels = vi.fn().mockImplementation(
      () =>
        new Promise<{ success: boolean }>((resolve) => {
          resolveDownload = resolve;
        }),
    );
    const user = userEvent.setup();
    renderDialog(
      makeElectronAPIStub({
        checkOnnxMigration: vi.fn().mockResolvedValue(MIGRATION_NEEDED),
        downloadOnnxModels,
        onModelDownloadProgress: vi.fn((cb: unknown) => {
          progressCb = cb as (...args: unknown[]) => void;
          return NOOP_UNSUB;
        }),
      }),
    );

    const download = await screen.findByTestId("migration-download");
    await user.click(download);
    expect(downloadOnnxModels).toHaveBeenCalledTimes(1);

    // While the download promise is pending, progress events drive the bar.
    await waitFor(() => {
      expect(screen.getByTestId("migration-progress")).toBeDefined();
    });
    act(() => {
      progressCb?.(undefined, {
        model: "asr-seaco-paraformer",
        stage: "downloading",
        progress: 40,
        overall_progress: 42,
      });
    });
    expect(screen.getByTestId("migration-progress").textContent).toContain(
      "42",
    );

    // Completion leaves the downloading state (the 3s settle re-check that
    // clears the prompt itself is main-poll business, covered hook-side).
    await act(async () => {
      resolveDownload({ success: true });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("migration-progress")).toBeNull();
    });
  });

  it("AC5: a failed download shows the actionable error, settings pointer and retry", async () => {
    const downloadOnnxModels = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "模型下载失败：所有下载源均不可用（network unreachable）。请检查网络连接或代理设置后重试；已下载部分已保留，重试将自动断点续传",
        ),
      )
      .mockResolvedValue({ success: true });
    const openSettingsWindow = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDialog(
      makeElectronAPIStub({
        checkOnnxMigration: vi.fn().mockResolvedValue(MIGRATION_NEEDED),
        downloadOnnxModels,
        openSettingsWindow,
      }),
    );

    const download = await screen.findByTestId("migration-download");
    await user.click(download);

    // The main-process message (proxy guidance + resume promise) is shown.
    const errorNode = await screen.findByTestId("migration-error");
    expect(errorNode.textContent).toContain("代理");
    expect(errorNode.textContent).toContain("断点续传");
    // Actionable pointer: the settings guide button.
    expect(screen.getByTestId("migration-open-settings")).toBeDefined();
    expect(screen.getByTestId("migration-error-guidance")).toBeDefined();

    await user.click(screen.getByTestId("migration-open-settings"));
    expect(openSettingsWindow).toHaveBeenCalledTimes(1);

    // Retry keeps partial bytes and completes.
    await user.click(screen.getByTestId("migration-download"));
    expect(downloadOnnxModels).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.queryByTestId("migration-error")).toBeNull();
    });
  });

  it("hides entirely when the ONNX set is already ready", async () => {
    renderDialog(
      makeElectronAPIStub({
        checkOnnxMigration: vi.fn().mockResolvedValue({
          needed: false,
          onnx_ready: true,
          torch_fallback_available: true,
          total_bytes: 704_000_000,
          remaining_bytes: 0,
        }),
      }),
    );
    await waitFor(() => {
      expect(screen.queryByTestId("migration-overlay")).toBeNull();
    });
  });
});
