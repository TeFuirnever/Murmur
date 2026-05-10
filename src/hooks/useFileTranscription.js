import { useState, useCallback, useRef, useEffect } from "react";

/**
 * 文件转录Hook
 * 管理音频文件选择、转录进度、结果等状态
 */
export function useFileTranscription() {
  const [state, setState] = useState("idle"); // idle | selected | transcribing | done | error | cancelled
  const [fileInfo, setFileInfo] = useState(null);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const progressCleanup = useRef(null);

  const cleanupProgress = () => {
    if (progressCleanup.current) {
      progressCleanup.current();
      progressCleanup.current = null;
    }
  };

  useEffect(() => cleanupProgress, []);

  const selectFile = useCallback(async () => {
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
        filePath: response.filePath,
        fileName: response.fileName,
        fileSize: response.fileSize,
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

  const startTranscription = useCallback(async () => {
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

  const cancelTranscription = useCallback(async () => {
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

  const reset = useCallback(() => {
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
