// @vitest-environment jsdom
// [20260926_Fix_401_PermissionI18n] Issue #401: the PermissionCard "granted"
// badge must render the i18n copy (settings.permissions.granted) instead of
// the hardcoded 已授予, and buttonText is a required prop (no 授予权限 default
// landmine — every caller must pass localized copy).
import "../../setup/react";
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Mic } from "lucide-react";
import PermissionCard from "../../../src/components/ui/permission-card";
import i18n from "../../../src/i18n";
import en from "../../../src/i18n/locales/en.json";
import zhCN from "../../../src/i18n/locales/zh-CN.json";

const enP = en.settings.permissions;
const zhP = zhCN.settings.permissions;

describe("[20260926_Fix_401_PermissionI18n] PermissionCard badge", () => {
  afterEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("renders the i18n granted badge in zh-CN, not the hardcoded 已授予", async () => {
    await i18n.changeLanguage("zh-CN");
    render(
      <PermissionCard
        icon={Mic}
        title="T"
        description="D"
        granted
        onRequest={vi.fn()}
        buttonText={zhP.testMicrophone}
      />,
    );
    expect(screen.getByText(zhP.granted)).toBeInTheDocument();
    expect(screen.queryByText("已授予")).toBeNull();
  });

  it("renders the i18n granted badge in English", async () => {
    await i18n.changeLanguage("en");
    render(
      <PermissionCard
        icon={Mic}
        title="T"
        description="D"
        granted
        onRequest={vi.fn()}
        buttonText={enP.testMicrophone}
      />,
    );
    expect(screen.getByText(enP.granted)).toBeInTheDocument();
  });

  it("renders buttonText as the request button (localized by the caller)", () => {
    render(
      <PermissionCard
        icon={Mic}
        title="T"
        description="D"
        granted={false}
        onRequest={vi.fn()}
        buttonText={zhP.testMicrophone}
      />,
    );
    expect(
      screen.getByRole("button", { name: zhP.testMicrophone }),
    ).toBeInTheDocument();
  });
});
