// @vitest-environment jsdom
// [20260816_Test_GeneralSection] GeneralSection was 0% — render + interaction
// coverage for the always-on-top toggle (live IPC side effect), theme select,
// and auto-paste/close-behavior selects.
// [20260926_Fix_399_DefaultModeOptions] Issue #399: the default_mode dropdown
// exposed only 4 of the 10 built-in modes and no custom-template modes (the
// read side dispatches any mode name — pure UI exposure gap). The i18n mock
// now resolves against the shipped zh-CN locale (same pattern as
// settings-sections.test.tsx) so assertions pin real user-visible strings.
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";

import zhCN from "../../src/i18n/locales/zh-CN.json";

// Flatten the nested locale into dot-notation keys for O(1) lookup.
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => LOCALE[key] ?? fallback ?? key,
    i18n: { language: "zh-CN", changeLanguage: vi.fn() },
  }),
}));

import { GeneralSection } from "../../src/settings/sections/GeneralSection";
import {
  DEFAULT_SETTINGS,
  type SettingsState,
} from "../../src/settings/useSettings";

const BASE: SettingsState = {
  ai_api_key: "",
  ai_base_url: "https://api.openai.com/v1",
  ai_model: "gpt-3.5-turbo",
  ai_temperature: 0.3,
  ai_max_tokens: 8192,
  enable_ai_optimization: true,
  window_always_on_top: true,
  auto_paste: "paste",
  close_behavior: "hide",
  theme: "system",
  // [20260905_Fix_246_HotkeySettingsUi] new settings key
  hotkey: "CommandOrControl+Shift+Space",
  // [20260905_Fix_249_DefaultModeUi] new settings key
  default_mode: "auto",
  hotwords: "",
  bot_shape: "circle",
  bot_color: "auto",
  bot_expression: "neutral",
  // [20260926_Refactor_403_SettingsSchema] show_notifications joined
  // SettingsState with the schema (#400 shipped it as local state; #403
  // folds it in — the switch now reads/writes through the standard
  // settings pipeline like every other General-tab control).
  show_notifications: true,
  // [20260926_Issue404] auto_start joins SettingsState with the schema
  // (#404 General-tab launch-at-login switch).
  auto_start: false,
};

type TestWindow = Omit<Window, "electronAPI"> & {
  electronAPI?: {
    setAlwaysOnTop: (v: boolean) => void;
    // Optional members: each test's inline stub only provides what it needs
    // (issue #399 baseline-path tests stub setAlwaysOnTop+getAIModes only).
    getSetting?: (key: string, defaultValue?: unknown) => Promise<unknown>;
    setSetting?: (key: string, value: unknown) => Promise<void>;
    // [20260926_Fix_399_DefaultModeOptions] Optional so the beforeEach stub
    // (setAlwaysOnTop only) keeps exercising the static-baseline path.
    getAIModes?: () => Promise<
      Array<{ name: string; label: string; description: string }>
    >;
    // [20260926_Issue404] Launch-at-login apply (issue #404).
    setLoginItemSettings?: (enabled: boolean) => Promise<unknown>;
  };
};

describe("[20260816_Test_GeneralSection] GeneralSection", () => {
  const onInputChange = vi.fn();
  const setAlwaysOnTop = vi.fn();
  const originalAPI = (globalThis.window as unknown as TestWindow).electronAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis.window as unknown as TestWindow).electronAPI = {
      setAlwaysOnTop,
    };
  });

  afterEach(() => {
    const win = globalThis.window as unknown as TestWindow;
    if (originalAPI === undefined) delete win.electronAPI;
    else win.electronAPI = originalAPI;
  });

  it("renders the always-on-top switch reflecting the setting", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    const toggle = screen.getByRole("switch", { name: "窗口始终置顶" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  // [20260926_Fix_397_JsxCommentLeak] Issue #397 F1: a bare `//` line sat in
  // the JSX children between the always-on-top label and its description, so
  // React rendered the source comment as literal UI text under the toggle.
  it("does not leak the axe-a11y source comment into the rendered UI", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    expect(screen.queryByText(/20260906_Test_AxeA11y/)).not.toBeInTheDocument();
    expect(screen.queryByText(/axe gate/)).not.toBeInTheDocument();
  });

  it("toggling always-on-top persists the change AND applies it live via IPC", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "窗口始终置顶" }));
    // [20260712_Fix_SetAlwaysOnTop] regression lock: the IPC write must fire
    // immediately, not only on Save.
    expect(onInputChange).toHaveBeenCalledWith("window_always_on_top", false);
    expect(setAlwaysOnTop).toHaveBeenCalledWith(false);
  });

  it("changing the theme select reports the new value", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    // Labels have no htmlFor; target selects by their current display value.
    fireEvent.change(screen.getByDisplayValue("跟随系统"), {
      target: { value: "dark" },
    });
    expect(onInputChange).toHaveBeenCalledWith("theme", "dark");
  });

  it("changing auto-paste behavior reports the selected mode", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    // Locale string (pasteOption) — the shipped zh-CN value, not the inline
    // component fallback (which still reads 自动粘贴到光标处).
    fireEvent.change(screen.getByDisplayValue("自动粘贴到当前应用"), {
      target: { value: "clipboard_only" },
    });
    expect(onInputChange).toHaveBeenCalledWith("auto_paste", "clipboard_only");
  });

  it("switching the language persists it and updates the document lang", () => {
    // [20260905_Fix_249_ReviewMinor] The choice also goes through
    // onInputChange("language") so the main/history windows can follow live.
    window.localStorage.clear();
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    fireEvent.change(screen.getByDisplayValue("中文"), {
      target: { value: "en" },
    });
    expect(window.localStorage.getItem("language")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(onInputChange).toHaveBeenCalledWith("language", "en");
  });

  it("changing close behavior reports the selected mode", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    // Locale string (hideBehavior) — the shipped zh-CN value, not the inline
    // component fallback (隐藏到托盘).
    fireEvent.change(screen.getByDisplayValue("隐藏到菜单栏"), {
      target: { value: "quit" },
    });
    expect(onInputChange).toHaveBeenCalledWith("close_behavior", "quit");
  });

  // [20260905_Fix_249_DefaultModeUi] Issue #249: "default_mode" was read by
  // useRecording/useFileTranscription but had no write path (not even in
  // ALLOWED_SETTING_KEYS), so the user's choice never persisted. The General
  // tab gets a select over the read-side vocabulary (auto / off / mode names).
  it("renders the default AI mode select reflecting the setting", () => {
    render(
      <GeneralSection
        settings={{ ...BASE, default_mode: "correct" }}
        onInputChange={onInputChange}
      />,
    );
    expect(screen.getByDisplayValue("校对纠错")).toBeInTheDocument();
  });

  it("changing the default AI mode reports the selected mode", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    fireEvent.change(screen.getByTestId("default-mode"), {
      target: { value: "off" },
    });
    expect(onInputChange).toHaveBeenCalledWith("default_mode", "off");
  });

  // [20260926_Fix_399_DefaultModeOptions] Issue #399: the dropdown exposed
  // only 4 of the 10 built-in modes. The full value list (auto + 10 built-ins
  // + off) is the baseline contract, mirrored from BUILT_IN_MODES in
  // src/helpers/ipc/aiHandlers.ts via the shared renderer constant.
  it("renders every built-in mode in the default-mode dropdown (#399)", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    const values = within(screen.getByTestId("default-mode"))
      .getAllByRole("option")
      .map((option) => option.getAttribute("value"));
    expect(values).toEqual([
      "auto",
      "optimize",
      "optimize_long",
      "format",
      "correct",
      "summarize",
      "enhance",
      "xiaohongshu",
      "zhihu",
      "douyin",
      "de-ai",
      "off",
    ]);
  });

  it("appends custom template modes once GET_MODES resolves (#399)", async () => {
    (globalThis.window as unknown as TestWindow).electronAPI = {
      setAlwaysOnTop,
      getAIModes: vi.fn().mockResolvedValue([
        { name: "optimize", label: "智能润色", description: "" },
        { name: "weekly-report", label: "周报整理", description: "" },
      ]),
    };
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    await waitFor(() => {
      const values = within(screen.getByTestId("default-mode"))
        .getAllByRole("option")
        .map((option) => option.getAttribute("value"));
      expect(values).toContain("weekly-report");
    });
    // The custom entry shows the template's own (backend) label.
    expect(screen.getByText("周报整理")).toBeInTheDocument();
  });

  it("keeps one option per mode name when a template shadows a built-in (#399)", async () => {
    (globalThis.window as unknown as TestWindow).electronAPI = {
      setAlwaysOnTop,
      getAIModes: vi.fn().mockResolvedValue([
        { name: "optimize", label: "智能润色", description: "" },
        // Shadowing template: same mode name "correct", custom label.
        { name: "correct", label: "我的校对覆盖", description: "" },
      ]),
    };
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    await waitFor(() => {
      const values = within(screen.getByTestId("default-mode"))
        .getAllByRole("option")
        .map((option) => option.getAttribute("value"));
      expect(values).toContain("correct");
    });
    const values = within(screen.getByTestId("default-mode"))
      .getAllByRole("option")
      .map((option) => option.getAttribute("value"));
    // Exactly one "correct" option — no built-in/template value duplication.
    expect(values.filter((v) => v === "correct")).toHaveLength(1);
  });

  it("falls back to the full built-in list when GET_MODES fails (#399)", async () => {
    const getAIModes = vi.fn().mockRejectedValue(new Error("bridge down"));
    (globalThis.window as unknown as TestWindow).electronAPI = {
      setAlwaysOnTop,
      getAIModes,
    };
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    // The static baseline survives the bridge failure — the select never
    // blanks and a saved mode value stays displayable.
    const values = within(screen.getByTestId("default-mode"))
      .getAllByRole("option")
      .map((option) => option.getAttribute("value"));
    expect(values).toEqual([
      "auto",
      "optimize",
      "optimize_long",
      "format",
      "correct",
      "summarize",
      "enhance",
      "xiaohongshu",
      "zhihu",
      "douyin",
      "de-ai",
      "off",
    ]);
    await waitFor(() => expect(getAIModes).toHaveBeenCalled());
  });

  // [20260926_Fix_399_UnifiedKnobWording] Issue #399 evidence #3: the AI tab
  // toggle (enable_ai_optimization) and the General tab dropdown
  // (default_mode) are ONE knob. The descriptions cross-reference instead of
  // each describing themselves.
  it("cross-references the AI tab toggle from the default-mode description (#399)", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    expect(screen.getByText(/「启用 AI 处理」/)).toBeInTheDocument();
  });

  it("defaults the contract default_mode to auto", () => {
    expect(DEFAULT_SETTINGS.default_mode).toBe("auto");
  });

  // [20260905_Fix_249_CoveragePush] Branch arms added with the default-mode
  // and hotkey-recorder UI: the always-on-top OFF render arm, the recorder's
  // blur-cancels-capture behavior, and the hotwords input path.
  it("renders the always-on-top switch unchecked when the setting is off", () => {
    render(
      <GeneralSection
        settings={{ ...BASE, window_always_on_top: false }}
        onInputChange={onInputChange}
      />,
    );
    expect(
      screen.getByRole("switch", { name: "窗口始终置顶" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("cancels the hotkey capture when the cancel button is clicked", () => {
    // [20260905_Fix_249_ReviewMinor] Clicking 取消 used to blur the capture
    // zone first (→ setRecording(false)) and THEN toggle back to true, so the
    // button re-entered capture instead of ending it. onMouseDown keeps the
    // focus on the button, letting onClick end the capture cleanly.
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    fireEvent.click(screen.getByTestId("hotkey-record"));
    expect(screen.getByTestId("hotkey-capture")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("hotkey-record"));
    fireEvent.click(screen.getByTestId("hotkey-record"));

    expect(screen.queryByTestId("hotkey-capture")).not.toBeInTheDocument();
    expect(screen.getByTestId("hotkey-record")).toHaveTextContent("更改");
  });

  it("cancels the hotkey capture when the zone loses focus", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    fireEvent.click(screen.getByTestId("hotkey-record"));
    const capture = screen.getByTestId("hotkey-capture");
    fireEvent.blur(capture);
    // Recording ended — the capture zone is gone and the button resets.
    expect(screen.queryByTestId("hotkey-capture")).not.toBeInTheDocument();
    expect(screen.getByTestId("hotkey-record")).toHaveTextContent("更改");
  });

  it("reports hotword list edits", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    fireEvent.change(screen.getByLabelText("热词"), {
      target: { value: "张晗玥" },
    });
    expect(onInputChange).toHaveBeenCalledWith("hotwords", "张晗玥");
  });

  // [20260926_Issue400] show_notifications switch: gates the update-download
  // system notification in the main process. [20260926_Refactor_403_
  // SettingsSchema] Issue #403 folded the key into SettingsState, so the
  // switch now goes through the standard pipeline — it renders from
  // settings state and toggles through onInputChange (which auto-persists
  // via SETTINGS.SET) exactly like the always-on-top switch above. The
  // stored-value read semantics (absent → on, only literal false → off)
  // live in the schema load arm and are covered by useSettings-hook tests.
  it("renders the show-notifications switch reflecting the setting state", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    expect(screen.getByRole("switch", { name: "系统通知" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("renders the show-notifications switch unchecked when the setting is off", () => {
    render(
      <GeneralSection
        settings={{ ...BASE, show_notifications: false }}
        onInputChange={onInputChange}
      />,
    );
    expect(screen.getByRole("switch", { name: "系统通知" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("toggling the show-notifications switch routes through onInputChange", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    const toggle = screen.getByRole("switch", { name: "系统通知" });

    fireEvent.click(toggle);
    expect(onInputChange).toHaveBeenCalledWith("show_notifications", false);
  });

  it("toggling an off show-notifications switch reports the on value", () => {
    render(
      <GeneralSection
        settings={{ ...BASE, show_notifications: false }}
        onInputChange={onInputChange}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "系统通知" }));
    expect(onInputChange).toHaveBeenCalledWith("show_notifications", true);
  });

  // [20260926_Issue404] auto_start switch (issue #404): same standard
  // pipeline as show_notifications — renders from settings state, toggles
  // through onInputChange (auto-persists via SETTINGS.SET) — PLUS the live
  // main-process side effect: the toggle must call the
  // SYSTEM.SET_LOGIN_ITEM bridge so the OS login item changes immediately
  // (same pattern as the always-on-top switch's immediate setAlwaysOnTop).
  it("renders the auto-start switch reflecting the setting state", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    expect(screen.getByTestId("auto-start")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("renders the auto-start switch checked when the setting is on", () => {
    render(
      <GeneralSection
        settings={{ ...BASE, auto_start: true }}
        onInputChange={onInputChange}
      />,
    );
    expect(screen.getByTestId("auto-start")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("toggling auto-start persists AND applies the OS login item live", () => {
    const setLoginItemSettings = vi.fn();
    (globalThis.window as unknown as TestWindow).electronAPI = {
      setAlwaysOnTop,
      setLoginItemSettings,
    };
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    fireEvent.click(screen.getByTestId("auto-start"));
    expect(onInputChange).toHaveBeenCalledWith("auto_start", true);
    expect(setLoginItemSettings).toHaveBeenCalledWith(true);
  });

  it("toggling auto-start off reports the off value and applies the off login item", () => {
    const setLoginItemSettings = vi.fn();
    (globalThis.window as unknown as TestWindow).electronAPI = {
      setAlwaysOnTop,
      setLoginItemSettings,
    };
    render(
      <GeneralSection
        settings={{ ...BASE, auto_start: true }}
        onInputChange={onInputChange}
      />,
    );
    fireEvent.click(screen.getByTestId("auto-start"));
    expect(onInputChange).toHaveBeenCalledWith("auto_start", false);
    expect(setLoginItemSettings).toHaveBeenCalledWith(false);
  });

  it("does not throw when the login-item bridge is absent (test stubs / older preload)", () => {
    (globalThis.window as unknown as TestWindow).electronAPI = {
      setAlwaysOnTop,
    };
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    expect(() =>
      fireEvent.click(screen.getByTestId("auto-start")),
    ).not.toThrow();
    expect(onInputChange).toHaveBeenCalledWith("auto_start", true);
  });

  // [20260926_Perf_402_TextInputDebounce] The hotwords textarea is debounced
  // at the persistence layer; leaving the field must flush the pending write
  // (issue #402: avoid losing the tail keystroke on window close).
  it("requests a pending-write flush when the hotwords textarea blurs", () => {
    const onInputBlur = vi.fn();
    render(
      <GeneralSection
        settings={BASE}
        onInputChange={onInputChange}
        onInputBlur={onInputBlur}
      />,
    );
    fireEvent.blur(screen.getByLabelText("热词"));
    expect(onInputBlur).toHaveBeenCalledTimes(1);
  });
});
