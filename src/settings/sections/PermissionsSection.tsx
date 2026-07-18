import type React from "react";
import { toast } from "sonner";
import { Mic, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePermissions } from "../../hooks/usePermissions";
import PermissionCard from "../../components/ui/permission-card";

export const PermissionsSection: React.FC = () => {
  const { t } = useTranslation();

  const showAlert = (alert: { title: string; description: string }) => {
    toast(alert.title, {
      description: alert.description,
      duration: 4000,
    });
  };

  const {
    micPermissionGranted,
    accessibilityPermissionGranted,
    requestMicPermission,
    testAccessibilityPermission,
  } = usePermissions(showAlert);

  return (
    <div className="space-y-2">
      <p className="text-xs text-[#86868b] mb-4">
        {t(
          "settings.permissions.description",
          "测试和管理应用权限，确保麦克风和辅助功能正常工作。",
        )}
      </p>
      <PermissionCard
        icon={Mic}
        title={t("settings.permissions.microphone", "麦克风权限")}
        description={t(
          "settings.permissions.microphoneDesc",
          "录制语音所需的权限",
        )}
        granted={micPermissionGranted}
        onRequest={requestMicPermission}
        buttonText={t("settings.permissions.testMicrophone", "测试麦克风")}
      />
      <PermissionCard
        icon={Shield}
        title={t("settings.permissions.accessibility", "辅助功能权限")}
        description={t(
          "settings.permissions.accessibilityDesc",
          "自动粘贴文本所需的权限",
        )}
        granted={accessibilityPermissionGranted}
        onRequest={testAccessibilityPermission}
        buttonText={t("settings.permissions.testAccessibility", "测试权限")}
      />
    </div>
  );
};
