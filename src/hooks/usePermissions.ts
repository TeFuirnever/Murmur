// [20260926_Fix_396_PermissionStatus] Issue #396: permission badges must show
// the real OS permission state, not a session flag. The hook queries the main
// process (SYSTEM.PERMISSION_STATUS) via the preload bridge on mount and
// after each test probe; the probe result itself stays session feedback
// (toast) and never fakes the badge. Session-probe toasts are unchanged.
// [20260926_Fix_401_PermissionI18n] Issue #401: all user-visible strings
// (dialog title/description, alert fallback, pasted test-text marker) resolve
// through the i18n singleton so an English UI never shows Chinese copy. The
// non-hook i18n.t() form is deliberate: the hook runs before components
// mount and must also work under the node-env test's mocked React.
import * as React from "react";
import i18n from "../i18n";
import type {
  MediaPermissionStatus,
  PermissionStatusResult,
} from "../types/ipc";

interface AlertDialog {
  title: string;
  description: string;
}

export const usePermissions = (
  showAlertDialog?: (alert: AlertDialog) => void,
) => {
  const [micStatus, setMicStatus] =
    React.useState<MediaPermissionStatus>("unknown");
  const [accessibilityStatus, setAccessibilityStatus] =
    React.useState<MediaPermissionStatus>("unknown");

  // Real-status refresh: reads the main-process answer into the badge
  // states. Unknown bridge / IPC failure keeps "unknown" (badge hidden).
  const refreshPermissionStatus = React.useCallback(async () => {
    if (!window.electronAPI?.getPermissionStatus) return;
    try {
      const status: PermissionStatusResult =
        await window.electronAPI.getPermissionStatus();
      setMicStatus(status.microphone);
      setAccessibilityStatus(status.accessibility);
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log("warn", "查询系统权限状态失败:", err);
      }
    }
  }, []);

  React.useEffect(() => {
    void refreshPermissionStatus();
  }, [refreshPermissionStatus]);

  const requestMicPermission = React.useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      if (showAlertDialog) {
        showAlertDialog({
          title: i18n.t("settings.permissions.micTestSuccessTitle"),
          description: i18n.t("settings.permissions.micTestSuccessDesc"),
        });
      } else {
        alert(i18n.t("settings.permissions.micTestSuccessAlert"));
      }
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log("error", "麦克风权限被拒绝:", err);
      }
      if (showAlertDialog) {
        showAlertDialog({
          title: i18n.t("settings.permissions.micTestFailedTitle"),
          description: i18n.t("settings.permissions.micTestFailedDesc"),
        });
      } else {
        alert(i18n.t("settings.permissions.micTestFailedAlert"));
      }
    }
    // The probe is session feedback only — the badge re-reads the REAL
    // system status instead of trusting the probe outcome (#396).
    await refreshPermissionStatus();
  }, [showAlertDialog, refreshPermissionStatus]);

  const testAccessibilityPermission = React.useCallback(async () => {
    if (!window.electronAPI?.pasteText) {
      if (showAlertDialog) {
        showAlertDialog({
          title: i18n.t("settings.permissions.apiUnavailableTitle"),
          description: i18n.t("settings.permissions.apiUnavailableDesc"),
        });
      } else {
        alert(i18n.t("settings.permissions.apiUnavailableAlert"));
      }
      return;
    }
    try {
      await window.electronAPI.pasteText(
        i18n.t("settings.permissions.accessibilityPasteText"),
      );
      if (showAlertDialog) {
        showAlertDialog({
          title: i18n.t("settings.permissions.accessibilityTestSuccessTitle"),
          description: i18n.t(
            "settings.permissions.accessibilityTestSuccessDesc",
          ),
        });
      } else {
        alert(i18n.t("settings.permissions.accessibilityTestSuccessAlert"));
      }
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log("error", "辅助功能权限测试失败:", err);
      }
      if (showAlertDialog) {
        showAlertDialog({
          title: i18n.t("settings.permissions.accessibilityTestFailedTitle"),
          description: i18n.t(
            "settings.permissions.accessibilityTestFailedDesc",
          ),
        });
      } else {
        alert(i18n.t("settings.permissions.accessibilityTestFailedAlert"));
      }
    }
    // Same as the mic probe: the badge re-reads the REAL system status
    // (#396) — the probe never impersonates it.
    await refreshPermissionStatus();
  }, [showAlertDialog, refreshPermissionStatus]);

  return {
    // Badges follow the main-process-reported real status only.
    micPermissionGranted: micStatus === "granted",
    accessibilityPermissionGranted: accessibilityStatus === "granted",
    requestMicPermission,
    testAccessibilityPermission,
  };
};
