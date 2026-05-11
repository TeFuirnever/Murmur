import React, { useState } from "react";
import { Mic, Shield, Settings } from "lucide-react";
import { usePermissions } from "../hooks/usePermissions";
import PermissionCard from "./ui/permission-card";
import { toast } from "sonner";

const SettingsPanel = ({ onClose }) => {
  const showAlert = (alert) => {
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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xl flex items-center justify-center z-50">
      <div className="bg-white dark:bg-[#2c2c2e] rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <Settings className="w-6 h-6 text-[#0071e3]" />
            <h2 className="text-xl font-bold text-[#1d1d1f] text-heading">
              设置
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <span className="text-gray-500 text-xl">×</span>
          </button>
        </div>

        {/* 内容区域 */}
        <div className="p-6 space-y-8">
          {/* 权限部分 */}
          <div>
            <h3 className="text-lg font-semibold text-[#1d1d1f] mb-4 text-heading">
              权限管理
            </h3>
            <p className="text-sm text-[#86868b] mb-6">
              测试和管理应用权限，确保麦克风和辅助功能正常工作。
            </p>

            <div className="space-y-4">
              <PermissionCard
                icon={Mic}
                title="麦克风权限"
                description="录制语音所需的权限"
                granted={micPermissionGranted}
                onRequest={requestMicPermission}
                buttonText="测试麦克风"
              />

              <PermissionCard
                icon={Shield}
                title="辅助功能权限"
                description="自动粘贴文本所需的权限"
                granted={accessibilityPermissionGranted}
                onRequest={testAccessibilityPermission}
                buttonText="测试权限"
              />
            </div>
          </div>

          {/* 应用信息部分 */}
          <div className="border-t pt-8">
            <h3 className="text-lg font-semibold text-[#1d1d1f] mb-4 text-heading">
              关于 Murmur
            </h3>
            <div className="bg-[#f5f5f7] dark:bg-[#1c1c1e] p-4 rounded-lg">
              <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
                🎤 <strong>Murmur</strong> - 基于FunASR和AI的中文语音转文字应用
              </p>
              <p className="text-xs text-[#86868b]">
                • 高精度中文语音识别
                <br />
                • AI智能文本优化
                <br />
                • 实时语音处理
                <br />• 隐私保护设计
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
