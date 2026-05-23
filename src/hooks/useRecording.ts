import * as React from "react";
import { useModelStatus } from "./useModelStatus";

export function determineProcessingMode(
  text: string,
): "optimize_long" | "optimize" {
  const textLength = text.trim().length;
  const wordCount = text.trim().split(/\s+/).length;
  if (textLength > 150 || wordCount > 30) {
    return "optimize_long";
  }
  return "optimize";
}

interface UseRecordingOptions {
  onTranscriptionComplete?: (text: string | Record<string, unknown>) => void;
  onAIOptimizationComplete?: (text: string | Record<string, unknown>) => void;
}

/**
 * 录音功能Hook
 * 提供录音、停止录音、音频处理等功能
 */
export const useRecording = ({
  onTranscriptionComplete,
  onAIOptimizationComplete,
}: UseRecordingOptions = {}) => {
  const [isRecording, setIsRecording] = React.useState(false);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [isOptimizing, setIsOptimizing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [audioData, setAudioData] = React.useState<Blob | null>(null);

  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);
  const cancelledRef = React.useRef(false);
  const optimizationTimeoutRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const processingRef = React.useRef({
    isProcessingAudio: false,
    lastProcessTime: 0,
  });

  const onTranscriptionCompleteRef = React.useRef<
    ((text: string | Record<string, unknown>) => void) | undefined
  >(undefined);
  const onAIOptimizationCompleteRef = React.useRef<
    ((text: string | Record<string, unknown>) => void) | undefined
  >(undefined);
  onTranscriptionCompleteRef.current = onTranscriptionComplete;
  onAIOptimizationCompleteRef.current = onAIOptimizationComplete;

  // 使用模型状态Hook
  const modelStatus = useModelStatus();

  // 开始录音
  const startRecording = React.useCallback(async () => {
    try {
      setError(null);
      cancelledRef.current = false;
      if (optimizationTimeoutRef.current) {
        clearTimeout(optimizationTimeoutRef.current);
        optimizationTimeoutRef.current = null;
      }

      // 检查FunASR是否就绪
      if (!modelStatus.isReady) {
        if (modelStatus.isLoading) {
          throw new Error("FunASR服务器正在启动中，请稍候...");
        } else if (modelStatus.error) {
          throw new Error("FunASR服务器未就绪，请检查配置");
        } else {
          throw new Error("正在准备FunASR服务器，请稍候...");
        }
      }

      // 检查浏览器支持
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("您的浏览器不支持录音功能");
      }

      // 请求麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      audioChunksRef.current = [];

      // 创建MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      mediaRecorderRef.current = mediaRecorder;

      // 设置事件处理器
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        setIsProcessing(true);

        try {
          // 创建音频Blob
          const audioBlob = new Blob(audioChunksRef.current, {
            type: "audio/webm;codecs=opus",
          });

          setAudioData(audioBlob);

          // 处理音频
          await processAudio(audioBlob);
        } catch (err) {
          setError(`音频处理失败: ${err.message}`);
        } finally {
          setIsProcessing(false);
        }
      };

      mediaRecorder.onerror = (event) => {
        setError(`录音错误: ${event.error?.message || "未知错误"}`);
        setIsRecording(false);
        setIsProcessing(false);
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
      };

      // 开始录音
      mediaRecorder.start(1000); // 每秒收集一次数据
      setIsRecording(true);
    } catch (err) {
      setError(`无法开始录音: ${err.message}`);
      setIsRecording(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelStatus.isReady, modelStatus.isLoading, modelStatus.error]);

  // 停止录音
  const stopRecording = React.useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();

      // 停止所有音频轨道
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    }
  }, [isRecording]);

  // 处理音频
  const processAudio = React.useCallback(async (audioBlob: Blob) => {
    processingRef.current.isProcessingAudio = true;

    try {
      const wavBlob = await convertToWav(audioBlob);

      if (window.electronAPI) {
        if (!wavBlob) throw new Error("音频格式转换失败");
        const arrayBuffer = await wavBlob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        const transcriptionResult =
          await window.electronAPI.transcribeAudio(arrayBuffer);

        if (transcriptionResult.success) {
          const raw_text = transcriptionResult.text || "";

          // 准备转录数据
          const transcriptionData: Record<string, unknown> = {
            raw_text: raw_text,
            text: raw_text,
            confidence: transcriptionResult.confidence || 0,
            language: transcriptionResult.language || "zh-CN",
            duration: transcriptionResult.duration || 0,
            file_size: uint8Array.length,
          };

          // 立即显示初步结果
          if (onTranscriptionCompleteRef.current) {
            onTranscriptionCompleteRef.current({
              ...transcriptionResult,
              enhanced_by_ai: false,
            });
          }

          // 异步处理AI优化和保存（只保存一次）
          setIsOptimizing(true);
          optimizationTimeoutRef.current = setTimeout(async () => {
            if (cancelledRef.current) return;
            try {
              // 从设置中读取是否启用AI优化
              const useAI = (await window.electronAPI.getSetting(
                "enable_ai_optimization",
                true,
              )) as boolean;

              const finalData: Record<string, unknown> = {
                ...transcriptionData,
              };

              if (useAI) {
                try {
                  if (window.electronAPI && window.electronAPI.log) {
                    window.electronAPI.log(
                      "info",
                      "开始AI文本优化:",
                      raw_text.substring(0, 50) + "...",
                    );
                  }

                  const mode = determineProcessingMode(raw_text);
                  const result = (await Promise.race([
                    window.electronAPI.processText(raw_text, mode),
                    new Promise((_, reject) =>
                      setTimeout(
                        () => reject(new Error("AI优化超时，已使用原文")),
                        30000,
                      ),
                    ),
                  ])) as import("../types/ipc").AIProcessResult;

                  if (result && result.success) {
                    const processed_text = result.text;
                    finalData.processed_text = processed_text;
                    // 如果AI优化后的文本与原始文本不同，则将优化后的文本作为主文本
                    if (
                      processed_text &&
                      processed_text.trim() !== raw_text.trim()
                    ) {
                      finalData.text = processed_text;
                    }
                    if (window.electronAPI && window.electronAPI.log) {
                      window.electronAPI.log(
                        "info",
                        "AI文本优化成功",
                        (processed_text ?? "").substring(0, 50) + "...",
                      );
                    }
                  } else {
                    if (window.electronAPI && window.electronAPI.log) {
                      window.electronAPI.log(
                        "error",
                        "AI文本优化失败:",
                        result,
                      );
                    }
                  }
                } catch (err) {
                  if (window.electronAPI && window.electronAPI.log) {
                    window.electronAPI.log(
                      "error",
                      "AI文本优化捕获到错误:",
                      err,
                    );
                  }
                }
              }

              // 保存转录数据（只保存一次）
              if (window.electronAPI) {
                if (window.electronAPI && window.electronAPI.log) {
                  window.electronAPI.log(
                    "info",
                    "准备保存转录数据:",
                    finalData,
                  );
                }
                const savedResult = await window.electronAPI.saveTranscription(
                  finalData as any,
                );
                if (window.electronAPI && window.electronAPI.log) {
                  window.electronAPI.log(
                    "info",
                    "转录数据保存成功:",
                    savedResult,
                  );
                }

                // 通知UI更新并触发复制操作
                if (
                  useAI &&
                  finalData.processed_text &&
                  finalData.processed_text !== raw_text
                ) {
                  // 有AI优化结果时
                  const enhancedResult = {
                    ...transcriptionResult,
                    text: finalData.processed_text,
                    processed_text: finalData.processed_text,
                    enhanced_by_ai: true,
                  };
                  if (onAIOptimizationCompleteRef.current) {
                    onAIOptimizationCompleteRef.current(enhancedResult);
                  }
                } else {
                  // 没有AI优化或AI优化失败时，使用原始文本
                  const finalResult = {
                    ...transcriptionResult,
                    text: raw_text,
                    enhanced_by_ai: false,
                  };
                  if (onAIOptimizationCompleteRef.current) {
                    onAIOptimizationCompleteRef.current(finalResult);
                  }
                }
              }
            } catch (err) {
              if (window.electronAPI && window.electronAPI.log) {
                window.electronAPI.log("error", "处理和保存转录时出错:", err);
              }
              setError("转录处理失败: " + (err.message || "未知错误"));
            } finally {
              setIsOptimizing(false);
            }
          }, 100);

          return { ...transcriptionResult, enhanced_by_ai: false };
        } else {
          throw new Error(transcriptionResult.error || "语音识别失败");
        }
      } else {
        // Web环境模拟
        const mockResult = {
          success: true,
          text: "模拟识别结果。",
          confidence: 0.95,
          duration: 3.5,
        };
        if (onTranscriptionCompleteRef.current)
          onTranscriptionCompleteRef.current(mockResult);
        return mockResult;
      }
    } catch (err) {
      throw new Error(`音频处理失败: ${err.message}`);
    } finally {
      processingRef.current.isProcessingAudio = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 转换音频格式为WAV
  const convertToWav = React.useCallback(
    async (audioBlob: Blob): Promise<Blob | null> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = async () => {
          let audioContext = null;
          try {
            const arrayBuffer = reader.result as ArrayBuffer;

            audioContext = new (
              window.AudioContext || (window as any).webkitAudioContext
            )({
              sampleRate: 16000,
            });

            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            const wavBuffer = audioBufferToWav(audioBuffer);
            const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });

            resolve(wavBlob);
          } catch (err) {
            reject(new Error(`音频格式转换失败: ${err.message}`));
          } finally {
            if (audioContext) audioContext.close();
          }
        };

        reader.onerror = () => {
          reject(new Error("读取音频文件失败"));
        };

        reader.readAsArrayBuffer(audioBlob);
      });
    },
    [],
  );

  // AudioBuffer转WAV格式
  const audioBufferToWav = (audioBuffer: AudioBuffer) => {
    const length = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;
    const numberOfChannels = audioBuffer.numberOfChannels;
    const bytesPerSample = 2;
    const blockAlign = numberOfChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const bufferSize = 44 + dataSize;

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // WAV文件头
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, bufferSize - 8, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    // 音频数据
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = Math.max(
          -1,
          Math.min(1, audioBuffer.getChannelData(channel)[i]),
        );
        view.setInt16(offset, sample * 0x7fff, true);
        offset += 2;
      }
    }

    return buffer;
  };

  // 取消录音
  const cancelRecording = React.useCallback(() => {
    cancelledRef.current = true;
    if (optimizationTimeoutRef.current) {
      clearTimeout(optimizationTimeoutRef.current);
      optimizationTimeoutRef.current = null;
    }

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setIsRecording(false);
    setIsProcessing(false);
    setError(null);
    audioChunksRef.current = [];
  }, []);

  // 获取录音权限状态
  const checkPermissions = React.useCallback(async () => {
    try {
      const result = await navigator.permissions.query({ name: "microphone" });
      return result.state; // 'granted', 'denied', 'prompt'
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log("warn", "无法检查麦克风权限:", err);
      }
      return "unknown";
    }
  }, []);

  return {
    isRecording,
    isProcessing,
    isOptimizing,
    error,
    audioData,
    startRecording,
    stopRecording,
    cancelRecording,
    checkPermissions,
  };
};
