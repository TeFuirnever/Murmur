import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";
import { Toaster } from "./components/ui/sonner";
import { assertElectronAPI } from "./bootstrap/assertElectronAPI.js";
import { ModelStatusProvider } from "./hooks/useModelStatus";

// 检查是否在Electron环境中
const isElectron = () => {
  return typeof window !== "undefined" && window.electronAPI;
};

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

// 错误边界组件
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(_error: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({
      error: error,
      errorInfo: errorInfo,
    });

    // 在Electron环境中记录错误
    if (isElectron()) {
      window.electronAPI.log("error", `React Error: ${error.message}`);
    } else {
      console.error("React Error:", error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full">
            <div className="flex items-center mb-4">
              <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center mr-3">
                <span className="text-white text-sm">!</span>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">
                应用出现错误
              </h2>
            </div>

            <p className="text-gray-600 mb-4">
              Murmur 遇到了一个意外错误。请尝试重启应用。
            </p>

            {process.env.NODE_ENV === "development" && (
              <details className="mb-4">
                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                  查看错误详情
                </summary>
                <div className="mt-2 p-3 bg-gray-100 rounded text-xs font-mono text-gray-700 overflow-auto max-h-32">
                  <div className="mb-2">
                    <strong>错误:</strong>{" "}
                    {this.state.error && this.state.error.toString()}
                  </div>
                  <div>
                    <strong>堆栈:</strong>
                    <pre className="whitespace-pre-wrap">
                      {this.state.errorInfo?.componentStack}
                    </pre>
                  </div>
                </div>
              </details>
            )}

            <div className="flex space-x-3">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              >
                重新加载
              </button>

              {isElectron() && (
                <button
                  onClick={() => window.electronAPI.closeWindow()}
                  className="flex-1 bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  关闭应用
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// 应用初始化
function initializeApp() {
  // 检查Electron API是否可用
  if (!isElectron()) {
    console.warn("Electron API不可用，某些功能可能无法正常工作");
  }

  // 设置全局错误处理
  window.addEventListener("error", (event) => {
    if (isElectron()) {
      window.electronAPI.log(
        "error",
        `Global Error: ${event.error?.message || event.message}`,
      );
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (isElectron()) {
      window.electronAPI.log(
        "error",
        `Unhandled Promise Rejection: ${event.reason}`,
      );
    }
  });

  // 防止默认的拖拽行为
  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  // 防止右键菜单（生产环境）
  if (process.env.NODE_ENV === "production") {
    document.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });
  }

  // 设置中文语言环境
  document.documentElement.lang = "zh-CN";

  // 主题：优先使用用户保存的设置，否则跟随系统
  const applyTheme = (theme: string) => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)",
      ).matches;
      root.classList.toggle("dark", prefersDark);
    }
  };

  // 立即应用系统主题，防止闪烁
  applyTheme("system");

  // 再用用户保存的偏好覆盖
  if (window.electronAPI?.getSetting) {
    window.electronAPI.getSetting("theme", "system").then((theme: unknown) => applyTheme(theme as string));
  }

  // 监听系统主题变化（仅 system 模式下生效）
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      if (window.electronAPI?.getSetting) {
        window.electronAPI.getSetting("theme", "system").then((theme) => {
          if (theme === "system") {
            document.documentElement.classList.toggle("dark", e.matches);
          }
        });
      }
    });
}

// 初始化应用
initializeApp();

// 在挂载前断言 preload 已就绪；若失败则渲染纯 DOM 错误屏并停止
if (!assertElectronAPI()) {
  // 已渲染 fallback，直接退出，不再 createRoot
} else {
  // 渲染应用
  const root = ReactDOM.createRoot(document.getElementById("root")!);

  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <ModelStatusProvider>
          <App />
          <Toaster />
        </ModelStatusProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );

  // 开发环境下的热重载支持
  if (process.env.NODE_ENV === "development") {
    if ((import.meta as any).hot) {
      (import.meta as any).hot.accept("./App", (newModule: any) => {
        if (newModule) {
          const NextApp = newModule.default;
          root.render(
            <React.StrictMode>
              <ErrorBoundary>
                <ModelStatusProvider>
                  <NextApp />
                </ModelStatusProvider>
              </ErrorBoundary>
            </React.StrictMode>,
          );
        }
      });
    }
  }

  // 性能监控（开发环境）
  if (process.env.NODE_ENV === "development") {
    // 监控渲染性能
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === "measure") {
          console.log(
            `性能测量: ${entry.name} - ${entry.duration.toFixed(2)}ms`,
          );
        }
      }
    });

    observer.observe({ entryTypes: ["measure"] });

    // 监控内存使用
    if ((performance as any).memory) {
      setInterval(() => {
        const memory = (performance as any).memory;
        console.log(
          `内存使用: ${(memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB / ${(memory.totalJSHeapSize / 1024 / 1024).toFixed(2)}MB`,
        );
      }, 30000); // 每30秒检查一次
    }
  }
} // end assertElectronAPI guard
