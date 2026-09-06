// @vitest-environment jsdom
// [20260816_Test_HistoryPage] Functional coverage for the History window
// entry (src/history.tsx was 0% — mount guard + page UI). Renders through
// the real entry module: the test provides #history-root, mocks the preload
// bridge assertion, then imports src/history.tsx and drives the page like a
// user would (search filter, copy, delete, export, empty state).
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

// sonner: stub Toaster as a plain div (portal/CSS issues under jsdom) while
// asserting on toast calls — same pattern as sonner-toaster.test.tsx.
vi.mock("sonner", () => ({
  Toaster: () =>
    React.createElement("div", { "data-testid": "sonner-toaster" }),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// The entry bails out unless the preload bridge exists. Specifier must match
// the source import verbatim ("assertElectronAPI.js") for vi.mock resolution.
vi.mock("../../src/bootstrap/assertElectronAPI.js", () => ({
  assertElectronAPI: vi.fn(() => true),
}));

// [20260905_Fix_247_I18nMainHistory] src/history.tsx now imports ./i18n and
// translates through react-i18next. Under jsdom the real i18n instance would
// boot at navigator.language ("en-US"), breaking the zh assertions below —
// resolve t() against the shipped zh-CN locale (flattened) instead, the same
// pattern as settings-page.test.tsx.
import zhCN from "../../src/i18n/locales/zh-CN.json";

function flatten(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}
const LOCALE = flatten(zhCN as Record<string, unknown>);

// [20260905_Fix_249_ReviewMinor] Hoisted BEFORE the vi.mock below — the
// mock factory and mockI18n reference it, and TS/ESLint reject use-before-
// declaration when the const sits after the mock block.
const historyI18nMocks = vi.hoisted(() => ({
  changeLanguage: vi.fn<(lng: string) => void>(),
}));

// Stable identity across renders — the real useTranslation returns a
// referentially stable t; a per-render t would rebuild hooks that depend
// on it (loadTranscriptions) and re-trigger their mount effects forever.
const translate = (
  key: string,
  fallbackOrOpts?: string | Record<string, unknown>,
  opts?: Record<string, unknown>,
): string => {
  const template =
    LOCALE[key] ?? (typeof fallbackOrOpts === "string" ? fallbackOrOpts : key);
  const vars =
    opts ??
    (typeof fallbackOrOpts === "object" && fallbackOrOpts !== null
      ? fallbackOrOpts
      : undefined);
  if (!vars) return template;
  return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
    vars[name] === undefined ? `{{${name}}}` : String(vars[name]),
  );
};

// [20260905_Fix_249_ReviewMinor] Stable i18n identity — a per-render
// literal would re-run every effect that depends on [i18n] and override
// the listener capture in this mock (hotkey/language effects re-register).
const mockI18n = {
  language: "zh-CN",
  changeLanguage: historyI18nMocks.changeLanguage,
};

vi.mock("react-i18next", () => ({
  // src/history.tsx imports ./i18n, which calls i18n.use(initReactI18next) —
  // the mock must provide the plugin symbol too.
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({
    t: translate,
    i18n: mockI18n,
  }),
}));

type TestWindow = Omit<Window, "electronAPI"> & {
  electronAPI?: {
    getTranscriptions: (
      limit: number,
      offset: number,
    ) => Promise<Array<Record<string, unknown>>>;
    deleteTranscription: (id: number) => Promise<unknown>;
    copyText: (text: string) => Promise<unknown>;
    exportTranscriptions: (format: string) => Promise<unknown>;
    clearAllTranscriptions: () => Promise<unknown>;
    getAllSettings: () => Promise<Record<string, unknown>>;
    closeHistoryWindow: () => void;
  };
};

const makeRecord = (
  id: number,
  text: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  text,
  raw_text: null,
  processed_text: null,
  confidence: null,
  created_at: new Date(Date.now() - id * 86_400_000).toISOString(),
  ...extra,
});

const apiMocks = {
  onSettingsUpdate: vi.fn(() => () => {}),
  getTranscriptions: vi.fn(),
  deleteTranscription: vi.fn(),
  copyText: vi.fn(),
  exportTranscriptions: vi.fn(),
  clearAllTranscriptions: vi.fn(),
  closeHistoryWindow: vi.fn(),
};

async function mountHistory() {
  // Fresh module graph per test so the mount guard re-runs.
  vi.resetModules();
  document.body.innerHTML = '<div id="history-root"></div>';
  (globalThis.window as unknown as TestWindow).electronAPI = {
    getTranscriptions: apiMocks.getTranscriptions,
    deleteTranscription: apiMocks.deleteTranscription,
    copyText: apiMocks.copyText,
    exportTranscriptions: apiMocks.exportTranscriptions,
    clearAllTranscriptions: apiMocks.clearAllTranscriptions,
    closeHistoryWindow: apiMocks.closeHistoryWindow,
    onSettingsUpdate: apiMocks.onSettingsUpdate,
    getAllSettings: vi.fn().mockResolvedValue({}),
  } as TestWindow["electronAPI"];
  await import("../../src/history");
  await waitFor(() => {
    expect(screen.getByText("Murmur - 转录历史")).toBeInTheDocument();
  });
}

describe("[20260816_Test_HistoryPage] history window entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getTranscriptions.mockResolvedValue([]);
  });

  it("shows the loading indicator while records are being fetched", async () => {
    // [20260905_Fix_249_ReviewCoverage] The loading branch arm.
    let release!: (v: unknown) => void;
    apiMocks.getTranscriptions.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    await mountHistory();
    await waitFor(() => {
      expect(screen.getByText("加载中...")).toBeInTheDocument();
    });
    release([]);
  });

  it("does not render when the history-root container is missing", async () => {
    // [20260905_Fix_249_ReviewCoverage] The mount guard's container-missing
    // arm: nothing renders, nothing throws.
    document.body.innerHTML = "";
    (globalThis.window as unknown as TestWindow).electronAPI = {
      getTranscriptions: apiMocks.getTranscriptions,
    } as unknown as TestWindow["electronAPI"];
    vi.resetModules();
    await import("../../src/history");
    await waitFor(() => {
      expect(document.body.querySelector("#history-root")).toBeNull();
    });
  });

  it("mounts the page and shows the empty state when no records exist", async () => {
    await mountHistory();
    expect(screen.getByPlaceholderText("搜索转录内容...")).toBeInTheDocument();
    expect(screen.getByText("暂无转录历史")).toBeInTheDocument();
    expect(screen.getByText("共 0 条记录")).toBeInTheDocument();
  });

  it("renders records with their final text and copy/delete buttons", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([
      makeRecord(2, "第二条记录"),
      makeRecord(1, "第一条记录"),
    ]);
    await mountHistory();
    expect(await screen.findByText("第二条记录")).toBeInTheDocument();
    expect(screen.getByText("第一条记录")).toBeInTheDocument();
    expect(screen.getByText("共 2 条记录")).toBeInTheDocument();
    // Multiple records render one copy/delete button each.
    expect(screen.getAllByTitle("复制文本")).toHaveLength(2);
    expect(screen.getAllByTitle("删除记录")).toHaveLength(2);
  });

  it("filters records client-side by the search query", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([
      makeRecord(1, "苹果发布会"),
      makeRecord(2, "香蕉牛奶"),
    ]);
    await mountHistory();
    expect(await screen.findByText("苹果发布会")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("搜索转录内容..."), {
      target: { value: "香蕉" },
    });

    expect(screen.queryByText("苹果发布会")).not.toBeInTheDocument();
    expect(screen.getByText("香蕉牛奶")).toBeInTheDocument();
    expect(screen.getByText("共 1 条记录")).toBeInTheDocument();
  });

  it("shows the no-match state for a query that hits nothing", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([makeRecord(1, "苹果")]);
    await mountHistory();
    expect(await screen.findByText("苹果")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("搜索转录内容..."), {
      target: { value: "不存在的词" },
    });

    expect(screen.getByText("没有找到匹配的记录")).toBeInTheDocument();
  });

  it("copies a record via the copy button and toasts success", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([makeRecord(1, "可复制文本")]);
    apiMocks.copyText.mockResolvedValue(undefined);
    const { toast } = await import("sonner");
    await mountHistory();
    fireEvent.click(await screen.findByTitle("复制文本"));

    await waitFor(() => {
      expect(apiMocks.copyText).toHaveBeenCalledWith("可复制文本");
      expect(toast.success).toHaveBeenCalledWith("文本已复制到剪贴板");
    });
  });

  it("keeps the failure path console-only on copy error (no toast)", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([makeRecord(1, "文本")]);
    apiMocks.copyText.mockRejectedValue(new Error("clipboard locked"));
    const { toast } = await import("sonner");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await mountHistory();
    fireEvent.click(await screen.findByTitle("复制文本"));

    await waitFor(() => {
      expect(errSpy).toHaveBeenCalledWith("复制失败:", expect.any(Error));
    });
    expect(toast.error).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("deletes a record through the IPC bridge", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([makeRecord(7, "待删除")]);
    apiMocks.deleteTranscription.mockResolvedValue({ changes: 1 });
    await mountHistory();
    fireEvent.click(await screen.findByTitle("删除记录"));

    await waitFor(() => {
      expect(apiMocks.deleteTranscription).toHaveBeenCalledWith(7);
    });
    // The list updates without refetching (client-side filter).
    await waitFor(() => {
      expect(screen.queryByText("待删除")).not.toBeInTheDocument();
      expect(screen.getByText("共 0 条记录")).toBeInTheDocument();
    });
  });

  it("toasts an error when loading history fails", async () => {
    apiMocks.getTranscriptions.mockRejectedValue(new Error("db locked"));
    const { toast } = await import("sonner");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await mountHistory();
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("加载历史记录失败");
    });
    errSpy.mockRestore();
  });

  it("exports all records as txt when the export button is clicked", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([makeRecord(1, "x")]);
    await mountHistory();
    fireEvent.click(await screen.findByText("导出全部"));
    expect(apiMocks.exportTranscriptions).toHaveBeenCalledWith("txt");
  });

  // [20260905_Fix_248_HistoryClearExport] Issue #248: the export button was
  // hardcoded to txt (the handler already supports txt/srt/vtt/md/docx) and
  // there was no clear-all entry (the CLEAR IPC chain was fully in place).
  it("exports with the format chosen in the format selector", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([makeRecord(1, "x")]);
    apiMocks.exportTranscriptions.mockResolvedValue({
      success: true,
      path: "/tmp/out.md",
    });
    await mountHistory();
    fireEvent.change(await screen.findByTestId("export-format"), {
      target: { value: "md" },
    });
    fireEvent.click(screen.getByTestId("export-all"));
    await waitFor(() => {
      expect(apiMocks.exportTranscriptions).toHaveBeenCalledWith("md");
    });
  });

  it("clears all records after confirmation and reloads the list", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      apiMocks.getTranscriptions.mockResolvedValue([makeRecord(1, "x")]);
      // Real handler contract after the #248 review fix: the CLEAR handler
      // wraps the SQLite RunResult into { success: true, changes }.
      apiMocks.clearAllTranscriptions.mockResolvedValue({
        success: true,
        changes: 1,
      });
      await mountHistory();
      await screen.findByText("x");

      fireEvent.click(screen.getByTestId("clear-all"));

      await waitFor(() => {
        expect(apiMocks.clearAllTranscriptions).toHaveBeenCalledTimes(1);
      });
      // The list reloads after the wipe — the empty state shows.
      await waitFor(() => {
        expect(screen.getByText("暂无转录历史")).toBeInTheDocument();
      });
      expect(screen.getByText("共 0 条记录")).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("keeps the records when the clear confirmation is dismissed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      apiMocks.getTranscriptions.mockResolvedValue([makeRecord(1, "x")]);
      await mountHistory();
      await screen.findByText("x");

      fireEvent.click(screen.getByTestId("clear-all"));

      expect(apiMocks.clearAllTranscriptions).not.toHaveBeenCalled();
      expect(screen.getByText("x")).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("returns silently when the bridge is absent for export and clear", async () => {
    // [20260905_Fix_249_CoveragePush] The no-bridge early returns: without
    // electronAPI both actions are no-ops (no crash, no toast possible).
    apiMocks.getTranscriptions.mockResolvedValue([makeRecord(1, "x")]);
    await mountHistory();
    (globalThis.window as unknown as TestWindow).electronAPI = undefined;
    fireEvent.click(await screen.findByTestId("export-all"));
    fireEvent.click(screen.getByTestId("clear-all"));
    // No IPC, no throw — the records are still rendered.
    expect(screen.getByText("x")).toBeInTheDocument();
  });

  it("toasts failure when the export IPC rejects", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    apiMocks.getTranscriptions.mockResolvedValue([makeRecord(1, "x")]);
    apiMocks.exportTranscriptions.mockRejectedValue(new Error("disk full"));
    await mountHistory();
    fireEvent.click(await screen.findByTestId("export-all"));
    const { toast } = await import("sonner");
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("导出失败");
    });
    errSpy.mockRestore();
  });

  it("stays silent when the export save dialog is cancelled", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([makeRecord(1, "x")]);
    apiMocks.exportTranscriptions.mockResolvedValue({
      success: false,
      canceled: true,
    });
    await mountHistory();
    fireEvent.click(await screen.findByTestId("export-all"));
    await waitFor(() => {
      expect(apiMocks.exportTranscriptions).toHaveBeenCalledWith("txt");
    });
    const { toast } = await import("sonner");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts failure when the clear IPC reports unsuccessful", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      apiMocks.getTranscriptions.mockResolvedValue([makeRecord(1, "x")]);
      apiMocks.clearAllTranscriptions.mockResolvedValue({
        success: false,
        error: "db locked",
      });
      await mountHistory();
      await screen.findByText("x");

      fireEvent.click(screen.getByTestId("clear-all"));

      const { toast } = await import("sonner");
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("清空失败");
      });
      // The list is NOT reset when the wipe failed.
      expect(screen.getByText("x")).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("applies a language change broadcast to the history window", async () => {
    // [20260905_Fix_249_ReviewMinor] The settings window's language switch
    // must reach the history window's i18n instance live.
    await mountHistory();
    const unsub = apiMocks.onSettingsUpdate as unknown as ReturnType<
      typeof vi.fn
    >;
    const cb = unsub.mock.calls[0]?.[0] as
      | ((d: { key: string; value?: string }) => void)
      | undefined;
    cb?.({ key: "language", value: "en" });
    expect(historyI18nMocks.changeLanguage).toHaveBeenCalledWith("en");
  });

  it("closes the window via the header button", async () => {
    await mountHistory();
    fireEvent.click(screen.getByText("关闭窗口"));
    expect(apiMocks.closeHistoryWindow).toHaveBeenCalled();
  });
});

// [20260816_Test_BranchPush] history.tsx branch matrix — covers the remaining
// arcs: formatDate day buckets, confidence badge presence, processed/raw card
// show/hide rules, the navigator.clipboard copy fallback, and the
// electronAPI-absent early returns in load/delete/export/close. Rationale:
// the suite above covers the happy data flow; these pin the display and
// guard branches.
describe("[20260816_Test_BranchPush] history branch matrix", () => {
  // jsdom has no navigator.clipboard — stub it for the web-fallback branch.
  const clipboardStub = { writeText: vi.fn().mockResolvedValue(undefined) };

  async function mountHistoryWithoutAPI() {
    vi.resetModules();
    document.body.innerHTML = '<div id="history-root"></div>';
    delete (globalThis.window as unknown as TestWindow).electronAPI;
    await import("../../src/history");
    await waitFor(() => {
      expect(screen.getByText("Murmur - 转录历史")).toBeInTheDocument();
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getTranscriptions.mockResolvedValue([]);
    Object.defineProperty(navigator, "clipboard", {
      value: clipboardStub,
      configurable: true,
    });
  });

  afterEach(() => {
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it("buckets dates into 今天/昨天/N天前/absolute formats", async () => {
    const now = Date.now();
    apiMocks.getTranscriptions.mockResolvedValue([
      makeRecord(1, "今天条目", {
        created_at: new Date(now - 1_000).toISOString(),
      }),
      makeRecord(2, "昨天条目", {
        created_at: new Date(now - 1.5 * 86_400_000).toISOString(),
      }),
      makeRecord(3, "三天前条目", {
        created_at: new Date(now - 3.5 * 86_400_000).toISOString(),
      }),
      makeRecord(4, "更早条目", {
        created_at: new Date(now - 10.5 * 86_400_000).toISOString(),
      }),
    ]);
    await mountHistory();
    expect(await screen.findByText(/^今天 \d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.getByText(/^昨天 \d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.getByText("3天前")).toBeInTheDocument();
    const olderText = new Date(now - 10.5 * 86_400_000).toLocaleDateString(
      "zh-CN",
      {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      },
    );
    expect(screen.getByText(olderText)).toBeInTheDocument();
  });

  it("rounds the confidence into a badge only when present and non-zero", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([
      makeRecord(1, "带置信度", { confidence: 0.856 }),
      makeRecord(2, "零置信度", { confidence: 0 }),
      makeRecord(3, "无置信度", { confidence: null }),
    ]);
    await mountHistory();
    expect(await screen.findByText("置信度: 86%")).toBeInTheDocument();
    // Zero is falsy -> treated as absent; only one badge across three records.
    expect(screen.getAllByText(/置信度:/)).toHaveLength(1);
  });

  it("shows the AI-optimized card when processed text differs from raw", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([
      makeRecord(1, "最终文本", {
        raw_text: "原始文本",
        processed_text: "优化后的文本",
      }),
    ]);
    await mountHistory();
    expect(await screen.findByText("AI优化:")).toBeInTheDocument();
    expect(screen.getByText("优化后的文本")).toBeInTheDocument();
    // raw_text differs from text -> the raw card shows too.
    expect(screen.getByText("原始识别:")).toBeInTheDocument();
    expect(screen.getByText("原始文本")).toBeInTheDocument();
  });

  it("hides the AI-optimized card when it matches the raw text", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([
      makeRecord(1, "相同最终", {
        raw_text: "相同内容",
        processed_text: "相同内容",
      }),
    ]);
    await mountHistory();
    expect(await screen.findByText("相同最终")).toBeInTheDocument();
    expect(screen.queryByText("AI优化:")).not.toBeInTheDocument();
    expect(screen.getByText("原始识别:")).toBeInTheDocument();
  });

  it("treats whitespace-only processed text as absent", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([
      makeRecord(1, "空白优化", { raw_text: null, processed_text: "   " }),
    ]);
    await mountHistory();
    expect(await screen.findByText("空白优化")).toBeInTheDocument();
    expect(screen.queryByText("AI优化:")).not.toBeInTheDocument();
    expect(screen.queryByText("原始识别:")).not.toBeInTheDocument();
  });

  it("hides the raw card when it matches the final text", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([
      makeRecord(1, "完全一致", { raw_text: "完全一致", processed_text: null }),
    ]);
    await mountHistory();
    expect(await screen.findByText("最终结果:")).toBeInTheDocument();
    expect(screen.queryByText("原始识别:")).not.toBeInTheDocument();
  });

  it("copies through navigator.clipboard when the bridge disappears", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([makeRecord(1, "无桥复制")]);
    await mountHistory();
    // Wait for the record before dropping the bridge: the mount effect's
    // loadTranscriptions bails without electronAPI, and React passive effects
    // can flush after mountHistory's header check — deleting the bridge too
    // early leaves the list empty and this test races (seen on macos CI).
    expect(await screen.findByText("无桥复制")).toBeInTheDocument();
    delete (globalThis.window as unknown as TestWindow).electronAPI;
    fireEvent.click(screen.getByTitle("复制文本"));
    await waitFor(() => {
      expect(clipboardStub.writeText).toHaveBeenCalledWith("无桥复制");
    });
    const { toast } = await import("sonner");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("renders an empty page without fetching when the bridge is absent", async () => {
    await mountHistoryWithoutAPI();
    expect(screen.getByText("暂无转录历史")).toBeInTheDocument();
    expect(screen.getByText("共 0 条记录")).toBeInTheDocument();
    expect(apiMocks.getTranscriptions).not.toHaveBeenCalled();
    // Close/export guards short-circuit without the bridge.
    fireEvent.click(screen.getByText("关闭窗口"));
    fireEvent.click(screen.getByText("导出全部"));
    expect(apiMocks.exportTranscriptions).not.toHaveBeenCalled();
  });

  it("skips deletion when the bridge is absent", async () => {
    apiMocks.getTranscriptions.mockResolvedValue([makeRecord(5, "待删除无桥")]);
    await mountHistory();
    // Same race as the clipboard test above: the button only exists once the
    // load effect has run, so await the record before removing the bridge.
    expect(await screen.findByText("待删除无桥")).toBeInTheDocument();
    delete (globalThis.window as unknown as TestWindow).electronAPI;
    fireEvent.click(screen.getByTitle("删除记录"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(apiMocks.deleteTranscription).not.toHaveBeenCalled();
    expect(screen.getByText("待删除无桥")).toBeInTheDocument();
  });

  it("treats a null transcription result as an empty list", async () => {
    apiMocks.getTranscriptions.mockResolvedValue(null);
    await mountHistory();
    await waitFor(() => {
      expect(screen.getByText("共 0 条记录")).toBeInTheDocument();
    });
    expect(screen.getByText("暂无转录历史")).toBeInTheDocument();
  });
});
