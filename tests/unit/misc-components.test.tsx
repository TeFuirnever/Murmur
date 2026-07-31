// @vitest-environment jsdom
// [20260729_Test_MiscComponents] Integration tests for three small, previously
// 0%-coverage modules:
//   1. src/i18n/index.ts  — i18next initializer (verify it loads + configures
//      zh-CN/en resources without throwing).
//   2. src/components/ui/tabs.tsx — shadcn Tabs primitives (render + prop pass).
//   3. src/settings/SettingsSidebar.tsx — sidebar buttons (render + click).
//
// Tabs and SettingsSidebar run under jsdom (RTL render needs a DOM). The i18n
// module also imports react-i18next, so this whole file uses the jsdom
// environment directive above. react-i18next is mocked so we assert on stable
// fallback strings rather than pulling real i18n resource resolution into
// every render path.
import "../setup/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// [20260729_Test_MiscComponents] Mock react-i18next faithfully for the
// component tests below. useTranslation returns a t() that resolves against
// the shipped zh-CN locale (flattened to dot-notation keys) and falls back to
// the provided string when the key is missing — mirroring react-i18next.
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

// [20260729_Test_MiscComponents] The mock must export initReactI18next too:
// src/i18n/index.ts imports it and calls i18n.use(initReactI18next) at module
// load time. Provide a no-op plugin object (i18n.use accepts any object with a
// .type property) so the dynamic import in the i18n describe block succeeds.
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, fallback?: string) => LOCALE[key] ?? fallback ?? key,
    i18n: { language: "zh-CN", changeLanguage: vi.fn() },
  }),
}));

import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../src/components/ui/tabs";
import {
  SettingsSidebar,
  type SettingsSection,
} from "../../src/settings/SettingsSidebar";

// ---------------------------------------------------------------------------
// [20260729_Test_MiscComponents] i18n/index.ts
//
// The module calls i18n.use(initReactI18next).init(...) at import time, reading
// navigator.language and (when present) localStorage. We verify the import
// itself succeeds and that the configured instance exposes the two resource
// languages. A fresh dynamic import per test isolates the module state.
// ---------------------------------------------------------------------------
describe("[20260729_Test_MiscComponents] i18n/index.ts", () => {
  beforeEach(() => {
    vi.resetModules();
    // localStorage is present under jsdom; clear any "language" entry so the
    // init path through savedLanguage is deterministic.
    window.localStorage.clear();
  });

  it("initializes i18next without throwing and exports the instance", async () => {
    const mod = await import("../../src/i18n/index");
    const i18n = mod.default;
    expect(i18n).toBeDefined();
    expect(typeof i18n.t).toBe("function");
    // isInitialized is set true by a successful init().
    expect(i18n.isInitialized).toBe(true);
  });

  it("registers zh-CN and en translation resources", async () => {
    const mod = await import("../../src/i18n/index");
    const i18n = mod.default;
    const langs = i18n.languages;
    // fallbackLng (zh-CN) and the resolved lng (zh-CN under jsdom's default
    // navigator.language) are both guaranteed present in the languages list.
    expect(langs).toContain("zh-CN");
    // The en resource bundle must exist (registered via resources.en).
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
    expect(i18n.hasResourceBundle("zh-CN", "translation")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// [20260729_Test_MiscComponents] components/ui/tabs.tsx
// ---------------------------------------------------------------------------
describe("[20260729_Test_MiscComponents] Tabs primitives", () => {
  it("renders Tabs, TabsList, TabsTrigger and TabsContent", () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList data-testid="list">
          <TabsTrigger value="a">trigger a</TabsTrigger>
          <TabsTrigger value="b">trigger b</TabsTrigger>
        </TabsList>
        <TabsContent value="a">content a</TabsContent>
        <TabsContent value="b">content b</TabsContent>
      </Tabs>,
    );

    // The active trigger is a tab with aria-selected; Radix sets it from
    // defaultValue="a".
    const triggerA = screen.getByRole("tab", { name: "trigger a" });
    const triggerB = screen.getByRole("tab", { name: "trigger b" });
    expect(triggerA).toBeInTheDocument();
    expect(triggerB).toBeInTheDocument();
    expect(triggerA).toHaveAttribute("aria-selected", "true");

    // TabsList forwards className; verify the base class merged through.
    const list = screen.getByTestId("list");
    expect(list.className).toContain("rounded-md");

    // Both content panels exist in the DOM. Radix marks the active one with
    // data-state="active" and the inactive with data-state="inactive" plus a
    // `hidden` attribute (which excludes it from getByRole queries), so query
    // the raw DOM by role attribute instead of relying on the ARIA role helper.
    const panels = container.querySelectorAll("[role=tabpanel]");
    expect(panels.length).toBe(2);
    const states = Array.from(panels).map((p) => p.getAttribute("data-state"));
    expect(states).toContain("active");
    expect(states).toContain("inactive");
  });

  it("merges additional className on TabsTrigger", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a" className="my-trigger" data-testid="t">
            a
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a">body</TabsContent>
      </Tabs>,
    );

    const trigger = screen.getByTestId("t");
    // Base focus-visible ring class merged with the custom class.
    expect(trigger.className).toContain("focus-visible:ring-2");
    expect(trigger.className).toContain("my-trigger");
  });

  it("switches active tab on click", async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">a</TabsTrigger>
          <TabsTrigger value="b">b</TabsTrigger>
        </TabsList>
        <TabsContent value="a">content a</TabsContent>
        <TabsContent value="b">content b</TabsContent>
      </Tabs>,
    );

    // Radix Tabs toggles selection on pointer-up; userEvent simulates the full
    // pointer interaction (where a bare fireEvent.click does not).
    await user.click(screen.getByRole("tab", { name: "b" }));
    expect(screen.getByRole("tab", { name: "b" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "a" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});

// ---------------------------------------------------------------------------
// [20260729_Test_MiscComponents] settings/SettingsSidebar.tsx
// ---------------------------------------------------------------------------
describe("[20260729_Test_MiscComponents] SettingsSidebar", () => {
  it("renders all four sections with their labels", () => {
    render(
      <SettingsSidebar activeSection="general" onSectionChange={vi.fn()} />,
    );

    // Labels come from the zh-CN locale (mocked t() resolves settings.sidebar.*).
    expect(screen.getByRole("tab", { name: "通用" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "权限" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "AI 配置" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "关于" })).toBeInTheDocument();
  });

  it("marks the active section as aria-selected", () => {
    render(
      <SettingsSidebar activeSection="permissions" onSectionChange={vi.fn()} />,
    );

    expect(screen.getByRole("tab", { name: "权限" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "通用" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("calls onSectionChange with the section id when a tab is clicked", () => {
    const onSectionChange = vi.fn();
    render(
      <SettingsSidebar
        activeSection="general"
        onSectionChange={onSectionChange}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "AI 配置" }));
    expect(onSectionChange).toHaveBeenCalledWith("ai");
    expect(onSectionChange).toHaveBeenCalledTimes(1);
  });

  it("applies the active styling only to the selected section button", () => {
    const onSectionChange: (s: SettingsSection) => void = vi.fn();
    const { container } = render(
      <SettingsSidebar
        activeSection="about"
        onSectionChange={onSectionChange}
      />,
    );

    // The active button carries the Apple-blue background tint class.
    const activeButtons = container.querySelectorAll(
      ".bg-\\[\\#0071e3\\]\\/10",
    );
    expect(activeButtons.length).toBe(1);
    // And it is the "关于" (about) tab.
    const aboutButton = screen.getByRole("tab", { name: "关于" });
    expect(aboutButton.className).toContain("bg-[#0071e3]/10");
  });
});
