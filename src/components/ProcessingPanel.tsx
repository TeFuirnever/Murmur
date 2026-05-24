import * as React from "react";
import { Button } from "./ui/button";
import { LoadingDots } from "./ui/loading-dots";
import { cn } from "../lib/utils";
import type { AIMode } from "../types/ipc";

interface ProcessingPanelProps {
  modes: AIMode[];
  currentMode: string;
  onModeChange: (mode: string) => void;
  onApply: () => void;
  isProcessing: boolean;
  error: string | null;
  onDismissError: () => void;
}

export default function ProcessingPanel({
  modes,
  currentMode,
  onModeChange,
  onApply,
  isProcessing,
  error,
  onDismissError,
}: ProcessingPanelProps) {
  const selected = modes.find((m) => m.name === currentMode);

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">AI 处理</h3>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={currentMode}
          onChange={(e) => onModeChange(e.target.value)}
          disabled={isProcessing}
          className={cn(
            "flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          aria-label="选择 AI 处理模式"
        >
          {modes.map((m) => (
            <option key={m.name} value={m.name}>
              {m.label}
            </option>
          ))}
        </select>

        <Button
          onClick={onApply}
          disabled={isProcessing}
          size="sm"
          aria-label="应用 AI 处理"
        >
          {isProcessing ? (
            <>
              <LoadingDots />
              处理中
            </>
          ) : (
            "应用"
          )}
        </Button>
      </div>

      {selected?.description && (
        <p className="text-xs text-muted-foreground">{selected.description}</p>
      )}

      {error && (
        <div
          className="flex items-start justify-between rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <span>{error}</span>
          <button
            onClick={onDismissError}
            className="ml-2 shrink-0 text-destructive hover:text-destructive/80"
            aria-label="关闭错误提示"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
