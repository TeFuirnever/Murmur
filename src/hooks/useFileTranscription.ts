import * as React from "react";

type TranscriptionState =
  | "idle"
  | "selected"
  | "transcribing"
  | "done"
  | "error"
  | "cancelled";

interface FileInfo {
  filePath: string;
  fileName: string;
  fileSize: number;
  extension?: string;
}

interface TranscriptionProgress {
  phase?: string;
  message?: string;
  processed_ms?: number;
  total_ms?: number;
}

interface TranscriptionResult {
  id?: number;
  text?: string;
  segments?: Array<{ start_ms: number; end_ms: number; text: string }>;
  duration?: number;
  success?: boolean;
  error?: string;
}

/**
 * 文件转录Hook
 * 管理音频文件选择、转录进度、结果等状态
 */
export function useFileTranscription() {
  const [state, setState] = React.useState<TranscriptionState>("idle");
  const [fileInfo, setFileInfo] = React.useState<FileInfo | null>(null);
  const [progress, setProgress] = React.useState<TranscriptionProgress | null>(
    null,
  );
  const [result, setResult] = React.useState<TranscriptionResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const progressCleanup = React.useRef<(() => void) | null>(null);

  const cleanupProgress = () => {
    if (progressCleanup.current) {
      progressCleanup.current();
      progressCleanup.current = null;
    }
  };

  React.useEffect(() => cleanupProgress, []);

  const selectFile = React.useCallback(async () => {
    if (!window.electronAPI || !window.electronAPI.importAudioFile) {
      setError("Electron API 不可用");
      setState("error");
      return;
    }

    try {
      const response = await window.electronAPI.importAudioFile();

      if (!response.success) {
        if (response.canceled) {
          return;
        }
        setError(response.error || "文件选择失败");
        setState("error");
        return;
      }

      setFileInfo({
        filePath: response.filePath!,
        fileName: response.fileName!,
        fileSize: response.fileSize!,
        extension: response.extension,
      });
      setState("selected");
      setError(null);
      setResult(null);
      setProgress(null);
    } catch (err) {
      setError(err.message || "选择文件时出错");
      setState("error");
    }
  }, []);

  const startTranscription = React.useCallback(async () => {
    if (!fileInfo) {
      setError("请先选择音频文件");
      setState("error");
      return;
    }

    setState("transcribing");
    setProgress(null);
    setError(null);
    setResult(null);

    try {
      if (!window.electronAPI?.transcribeFile) {
        setError("Electron API 不可用，请重启应用");
        setState("error");
        return;
      }
      if (
        window.electronAPI &&
        window.electronAPI.onFileTranscriptionProgress
      ) {
        const unsubscribe = window.electronAPI.onFileTranscriptionProgress(
          (data) => {
            setProgress(data);
          },
        );
        progressCleanup.current = unsubscribe;
      }

      const response = await window.electronAPI.transcribeFile(
        fileInfo.filePath,
        {},
      );

      cleanupProgress();

      if (response.success) {
        setResult(response);
        setState("done");
      } else {
        setError(response.error || "转录失败");
        setState("error");
      }
    } catch (err) {
      cleanupProgress();
      setError(err.message || "转录过程中出错");
      setState("error");
    }
  }, [fileInfo]);

  const cancelTranscription = React.useCallback(async () => {
    try {
      if (window.electronAPI && window.electronAPI.cancelFileTranscription) {
        await window.electronAPI.cancelFileTranscription();
      }
    } catch {
      // 即使取消请求失败，也切换到已取消状态
    }

    cleanupProgress();

    setState("cancelled");
    setProgress(null);
  }, []);

  const reset = React.useCallback(() => {
    cleanupProgress();
    setState("idle");
    setFileInfo(null);
    setProgress(null);
    setResult(null);
    setError(null);
  }, []);

  return {
    state,
    fileInfo,
    progress,
    result,
    error,
    selectFile,
    startTranscription,
    cancelTranscription,
    reset,
  };
}
