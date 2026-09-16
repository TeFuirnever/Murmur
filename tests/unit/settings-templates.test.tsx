// [20260912_Feat_242_TemplateSystem] Ticket #242 (spec #193 T15): component
// tests for the TemplatesSection settings editor. Covers the four UI ACs:
//   (a) debounced autosave — a content edit schedules exactly one save
//       400ms out; leaving the section mid-debounce flushes it;
//   (b) restore-default visibility — visible ONLY for a built-in mode that
//       currently has a custom override file (pure customs get delete);
//   (c) shadow warning — a template whose name equals a built-in mode;
//   (d) the placeholder hint line lists {text} {output_lang} {speakers}
//       with the empty-speakers note.
// Pattern mirrored from settings-sections.test.tsx: jsdom, react-i18next
// mocked against the shipped zh-CN locale, window.electronAPI stubbed.
//
// [20260912_Fix_242_ReviewRound2] Added: fileName keying (stem ≠
// frontmatter name), pending-save identity preservation, save-throttle
// classification + one-shot retry, reload-failure surfacing, frontmatter
// warning toast, disabled name input for existing templates, act-wrapped
// unmount flush.
// @vitest-environment jsdom
import "../setup/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import { toast } from "sonner";

import zhCN from "../../src/i18n/locales/zh-CN.json";

// Flatten the nested locale into dot-notation keys (same helper as
// settings-sections.test.tsx) so assertions see real shipped strings.
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

function translate(
  key: string,
  opts?: string | Record<string, unknown>,
): string {
  const template = LOCALE[key];
  const fallback = typeof opts === "string" ? opts : undefined;
  const base = template ?? fallback ?? key;
  if (typeof opts !== "object" || opts === null) return base;
  return base.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    name in opts ? String(opts[name]) : "",
  );
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: translate,
    i18n: { language: "zh-CN", changeLanguage: vi.fn() },
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}));

import { TemplatesSection } from "../../src/settings/sections/TemplatesSection";

const electronAPIMock = {
  listTemplates: vi.fn(),
  readTemplate: vi.fn(),
  saveTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
};

type WindowWithAPI = { electronAPI?: unknown };

// The LIST contract carries the ON-DISK fileName next to the parsed
// display name (they diverge for hand-edited files — see the service
// regression fixture in templatesService.test.ts).
const CUSTOM_LIST = {
  success: true,
  templates: [
    { name: "meeting", label: "会议纪要", fileName: "meeting.md" },
    { name: "optimize", label: "影子润色", fileName: "optimize.md" },
  ],
};

const FILE_CONTENTS: Record<string, string> = {
  "meeting.md": "---\nname: meeting\nlabel: 会议纪要\n---\n会议正文",
  "optimize.md": "---\nname: optimize\nlabel: 影子润色\n---\n覆盖内置",
};

function primeFiles(): void {
  electronAPIMock.listTemplates.mockResolvedValue(CUSTOM_LIST);
  electronAPIMock.readTemplate.mockImplementation(async (fileName: string) => {
    const content = FILE_CONTENTS[fileName];
    return content !== undefined
      ? { success: true, content }
      : { success: false, error: "not_found" };
  });
}

async function renderLoaded(): Promise<void> {
  render(React.createElement(TemplatesSection));
  // Flush the mount-time list load (promise chain + state update) inside
  // act so the re-render lands before assertions.
  await act(async () => {});
}

async function selectEntry(testId: string): Promise<void> {
  fireEvent.click(screen.getByTestId(`template-entry-${testId}`));
  await act(async () => {});
}

function getEditor(): HTMLTextAreaElement {
  return screen.getByTestId("template-content-editor") as HTMLTextAreaElement;
}

function getNameInput(): HTMLInputElement {
  return screen.getByTestId("template-name-input") as HTMLInputElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  electronAPIMock.listTemplates.mockResolvedValue({
    success: true,
    templates: [],
  });
  electronAPIMock.readTemplate.mockResolvedValue({
    success: false,
    error: "not_found",
  });
  electronAPIMock.saveTemplate.mockImplementation(async (fileName: string) => ({
    success: true,
    fileName,
  }));
  electronAPIMock.deleteTemplate.mockResolvedValue({ success: true });
  (window as unknown as WindowWithAPI).electronAPI = electronAPIMock;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as WindowWithAPI).electronAPI;
});

describe("[20260912_Feat_242_TemplateSystem] TemplatesSection", () => {
  it("lists custom templates and built-in modes", async () => {
    primeFiles();
    await renderLoaded();
    expect(screen.getByTestId("template-entry-meeting")).toBeInTheDocument();
    expect(screen.getByTestId("template-entry-optimize")).toBeInTheDocument();
    // A built-in not shadowed by a custom file is listed too.
    expect(screen.getByTestId("template-entry-summarize")).toBeInTheDocument();
    // The shadowed built-in appears once (the custom override wins).
    expect(screen.getAllByTestId("template-entry-optimize")).toHaveLength(1);
  });

  it("shows the placeholder hint listing {text} {output_lang} {speakers}", async () => {
    await renderLoaded();
    const hint = screen.getByTestId("template-placeholder-hint");
    expect(hint.textContent).toContain("{text}");
    expect(hint.textContent).toContain("{output_lang}");
    expect(hint.textContent).toContain("{speakers}");
    // The hint is the shipped i18n string, which carries the AC note that
    // {speakers} renders empty when no speaker data exists.
    expect(hint.textContent).toBe(
      translate("settings.templates.placeholderHint"),
    );
  });

  it("selecting a custom template loads its content via the on-disk fileName", async () => {
    primeFiles();
    await renderLoaded();
    await selectEntry("meeting");
    expect(getEditor().value).toBe(FILE_CONTENTS["meeting.md"]);
    // [20260912_Fix_242_ReviewRound2] The bridge receives the file key,
    // not the parsed display name.
    expect(electronAPIMock.readTemplate).toHaveBeenCalledWith("meeting.md");
  });

  it("autosaves 400ms after a content edit keyed off the fileName (not before)", async () => {
    primeFiles();
    await renderLoaded();
    await selectEntry("meeting");

    fireEvent.change(getEditor(), { target: { value: "更新后的正文" } });

    await vi.advanceTimersByTimeAsync(399);
    expect(electronAPIMock.saveTemplate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(electronAPIMock.saveTemplate).toHaveBeenCalledTimes(1);
    expect(electronAPIMock.saveTemplate).toHaveBeenCalledWith(
      "meeting.md",
      "更新后的正文",
    );
  });

  it("flushes a pending autosave when the section unmounts mid-debounce", async () => {
    primeFiles();
    const { unmount } = render(React.createElement(TemplatesSection));
    await act(async () => {});
    await selectEntry("meeting");

    fireEvent.change(getEditor(), { target: { value: "未保存的草稿" } });

    // Leave the section before the 400ms debounce elapses; wrapped in act
    // [20260912_Fix_242_ReviewRound2] so the flush's updates stay act-clean.
    await act(async () => {
      unmount();
    });
    expect(electronAPIMock.saveTemplate).toHaveBeenCalledTimes(1);
    expect(electronAPIMock.saveTemplate).toHaveBeenCalledWith(
      "meeting.md",
      "未保存的草稿",
    );
  });

  // [20260912_Fix_242_ReviewRound2] Pending-save identity: an in-flight
  // save A must not wipe a newer pending edit B, or the unmount flush
  // saves nothing and B is lost.
  it("keeps a newer pending edit when an older save resolves in flight", async () => {
    primeFiles();
    let resolveA: (value: unknown) => void = () => {};
    electronAPIMock.saveTemplate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveA = resolve;
        }),
    );
    const { unmount } = render(React.createElement(TemplatesSection));
    await act(async () => {});
    await selectEntry("meeting");

    fireEvent.change(getEditor(), { target: { value: "草稿A" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(electronAPIMock.saveTemplate).toHaveBeenCalledTimes(1);

    // B is scheduled while A is still in flight.
    fireEvent.change(getEditor(), { target: { value: "草稿B" } });
    await act(async () => {
      resolveA({ success: true, fileName: "meeting.md" });
    });

    await act(async () => {
      unmount();
    });
    // B — not A, and not dropped — reached the bridge.
    expect(electronAPIMock.saveTemplate).toHaveBeenCalledTimes(2);
    expect(electronAPIMock.saveTemplate).toHaveBeenLastCalledWith(
      "meeting.md",
      "草稿B",
    );
  });

  // [20260912_Fix_242_ReviewRound2] The SAVE throttle is classified and
  // surfaced distinctly, then retried exactly once after the limiter
  // window instead of dying as a generic save-failure toast.
  it("classifies a rate-limited save, warns, and retries once after the window", async () => {
    primeFiles();
    electronAPIMock.saveTemplate.mockResolvedValue({
      success: false,
      error: "Rate limit exceeded",
    });
    await renderLoaded();
    await selectEntry("meeting");

    fireEvent.change(getEditor(), { target: { value: "被限流的正文" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(toast.error).toHaveBeenCalledWith(
      translate("settings.templates.saveThrottled"),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(electronAPIMock.saveTemplate).toHaveBeenLastCalledWith(
      "meeting.md",
      "被限流的正文",
    );
    // Exactly one retry — no further attempts after that.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(electronAPIMock.saveTemplate).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed list reload instead of failing silently", async () => {
    electronAPIMock.listTemplates.mockResolvedValue({
      success: false,
      error: "io",
    });
    await renderLoaded();
    expect(toast.error).toHaveBeenCalledWith(
      translate("settings.templates.loadFailed"),
    );
  });

  it("hides restore-default for a pristine built-in mode (content IS the default)", async () => {
    await renderLoaded();
    await selectEntry("summarize");
    expect(
      screen.queryByTestId("template-restore-default"),
    ).not.toBeInTheDocument();
  });

  it("shows restore-default for a built-in mode that has a custom override", async () => {
    primeFiles();
    await renderLoaded();
    await selectEntry("optimize");
    expect(screen.getByTestId("template-restore-default")).toBeInTheDocument();
  });

  it("restore-default deletes the override file and reloads the list", async () => {
    primeFiles();
    await renderLoaded();
    await selectEntry("optimize");
    fireEvent.click(screen.getByTestId("template-restore-default"));
    await act(async () => {});
    expect(electronAPIMock.deleteTemplate).toHaveBeenCalledWith("optimize.md");
    // The list reloaded after the delete.
    expect(electronAPIMock.listTemplates).toHaveBeenCalledTimes(2);
  });

  it("shows delete (not restore-default) for a pure custom template", async () => {
    primeFiles();
    await renderLoaded();
    await selectEntry("meeting");
    expect(
      screen.queryByTestId("template-restore-default"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("template-delete")).toBeInTheDocument();
  });

  // [20260912_Fix_242_ReviewRound2] Name edits were never saved — selecting
  // an existing template disables the input so "rename" cannot silently
  // duplicate the file.
  it("disables the name input while an existing template is selected", async () => {
    primeFiles();
    await renderLoaded();
    expect(getNameInput().disabled).toBe(false);
    await selectEntry("meeting");
    expect(getNameInput().disabled).toBe(true);
  });

  it("shows the shadow warning when the name equals a built-in mode", async () => {
    primeFiles();
    await renderLoaded();
    // Typing a built-in name into the editor warns BEFORE saving.
    fireEvent.change(getNameInput(), { target: { value: "summarize" } });
    expect(screen.getByTestId("template-shadow-warning")).toBeInTheDocument();

    // A non-built-in name has no warning.
    fireEvent.change(getNameInput(), { target: { value: "meeting" } });
    expect(
      screen.queryByTestId("template-shadow-warning"),
    ).not.toBeInTheDocument();
  });

  // [20260912_Fix_242_ReviewRound2] Post-save validation: a frontmatter-less
  // file saves fine but the editor warns it will never appear as a mode.
  it("warns when a save persists content without frontmatter", async () => {
    primeFiles();
    electronAPIMock.saveTemplate.mockResolvedValue({
      success: true,
      fileName: "meeting.md",
      warning: "missing_frontmatter",
    });
    await renderLoaded();
    await selectEntry("meeting");
    fireEvent.change(getEditor(), { target: { value: "没有 frontmatter" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(toast.warning).toHaveBeenCalledWith(
      translate("settings.templates.frontmatterWarning"),
    );
  });
});
