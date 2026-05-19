import { useState, useCallback } from "react";

/**
 * 文本处理Hook
 * 使用可配置的AI模型进行文本处理
 */
export const useTextProcessing = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);

  // 根据文本长度自动选择处理模式
  const determineProcessingMode = useCallback((text, userMode = "auto") => {
    if (userMode !== "auto") {
      return userMode;
    }

    const textLength = text.trim().length;
    const wordCount = text.trim().split(/\s+/).length;

    // 长文本阈值：超过150字符或30个词
    if (textLength > 150 || wordCount > 30) {
      return "optimize_long";
    } else {
      return "optimize";
    }
  }, []);

  // 处理并保存转录的函数
  const handleTranscription = useCallback(
    async (transcriptionData, useAI) => {
      const { raw_text } = transcriptionData;

      if (!raw_text || raw_text.trim().length === 0) {
        setError("转录文本内容不能为空");
        return null;
      }

      setIsProcessing(true);
      setError(null);

      let processed_text = null;
      let finalData = { ...transcriptionData, text: raw_text };

      if (useAI) {
        try {
          const actualMode = determineProcessingMode(raw_text, "auto");
          if (window.electronAPI && window.electronAPI.log) {
            window.electronAPI.log("info", "开始AI文本优化:", {
              text: raw_text.substring(0, 50) + "...",
              mode: actualMode,
            });
          }

          const result = await window.electronAPI.processText(
            raw_text,
            actualMode,
          );

          if (result && result.success) {
            processed_text = result.text;
            finalData.processed_text = processed_text;
            // 如果AI优化后的文本与原始文本不同，则将优化后的文本作为主文本
            if (processed_text && processed_text.trim() !== raw_text.trim()) {
              finalData.text = processed_text;
            }
            if (window.electronAPI && window.electronAPI.log) {
              window.electronAPI.log("info", "AI文本优化成功", {
                processed_text: processed_text.substring(0, 50) + "...",
              });
            }
          } else {
            if (window.electronAPI && window.electronAPI.log) {
              window.electronAPI.log("error", "AI文本优化失败:", result);
            }
            setError(result?.error || "AI文本优化失败");
          }
        } catch (err) {
          const errorMessage = err.message || "AI处理过程中发生未知错误";
          setError(errorMessage);
          if (window.electronAPI && window.electronAPI.log) {
            window.electronAPI.log("error", "AI文本优化捕获到错误:", err);
          }
        }
      }

      try {
        if (window.electronAPI) {
          if (window.electronAPI && window.electronAPI.log) {
            window.electronAPI.log("info", "准备保存转录数据:", finalData);
          }
          const savedResult =
            await window.electronAPI.saveTranscription(finalData);
          if (window.electronAPI && window.electronAPI.log) {
            window.electronAPI.log("info", "转录数据保存成功:", savedResult);
          }
          return { ...finalData, id: savedResult.lastInsertRowid };
        }
      } catch (err) {
        const errorMessage = err.message || "保存转录数据时发生未知错误";
        setError(errorMessage);
        if (window.electronAPI && window.electronAPI.log) {
          window.electronAPI.log("error", "保存转录数据失败:", err);
        }
        return null;
      } finally {
        setIsProcessing(false);
      }
    },
    [determineProcessingMode],
  );

  return {
    handleTranscription,
    isProcessing,
    error,
  };
};
