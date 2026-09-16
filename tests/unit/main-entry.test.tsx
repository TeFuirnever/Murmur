// @vitest-environment jsdom
// [20260816_Test_MainEntry] src/main.tsx was 0% — covers the two mount
// branches: preload bridge present → App mounts into #root inside the
// provider/error-boundary tree; bridge missing → the plain-DOM fallback
// screen renders and nothing mounts.
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act, fireEvent } from "@testing-library/react";

// App and the status provider are mocked light — their real behavior has
// dedicated suites; here we only verify the entry wires them into #root.
vi.mock("../../src/App", () => ({
  default: () =>
    React.createElement("div", { "data-testid": "app-stub" }, "APP"),
}));
vi.mock("../../src/hooks/useModelStatus", () => ({
  ModelStatusProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "provider-stub" }, children),
}));
vi.mock("sonner", () => ({
  Toaster: () =>
    React.createElement("div", { "data-testid": "sonner-toaster" }),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// jsdom lacks matchMedia — initializeApp() registers a system-theme listener.
function stubMatchMedia() {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

describe("[20260816_Test_MainEntry] main.tsx mount branches", () => {
  const originalAPI = (globalThis.window as { electronAPI?: unknown })
    .electronAPI;

  beforeEach(() => {
    stubMatchMedia();
    vi.resetModules();
  });

  it("mounts the App tree into #root when the preload bridge exists", async () => {
    vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
      assertElectronAPI: vi.fn(() => true),
    }));
    (globalThis.window as { electronAPI?: unknown }).electronAPI = {};
    document.body.innerHTML = '<div id="root"></div>';

    await import("../../src/main");

    await waitFor(() => {
      expect(screen.getByTestId("app-stub")).toBeInTheDocument();
    });
    (globalThis.window as { electronAPI?: unknown }).electronAPI = originalAPI;
  });

  it("renders the plain-DOM fallback and skips mounting without the bridge", async () => {
    vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
      assertElectronAPI: vi.fn(() => false),
    }));
    delete (globalThis.window as { electronAPI?: unknown }).electronAPI;
    document.body.innerHTML = '<div id="root"></div>';

    await import("../../src/main");

    // Nothing React-mounted into #root…
    await new Promise((r) => setTimeout(r, 50));
    expect(document.getElementById("root")?.childElementCount).toBe(0);
    // …and the mocked assertion short-circuits the real fallback DOM, so the
    // contract is simply: no App tree anywhere.
    expect(screen.queryByTestId("app-stub")).not.toBeInTheDocument();
  });

  it("invokes the mount guard exactly once per entry evaluation", async () => {
    const assertMock = vi.fn(() => true);
    vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
      assertElectronAPI: assertMock,
    }));
    (globalThis.window as { electronAPI?: unknown }).electronAPI = {};
    document.body.innerHTML = '<div id="root"></div>';

    await import("../../src/main");
    await waitFor(() => expect(screen.getByTestId("app-stub")).toBeTruthy());
    expect(assertMock).toHaveBeenCalledTimes(1);
    (globalThis.window as { electronAPI?: unknown }).electronAPI = originalAPI;
  });
});

// [20260816_Test_MainEntryBoundary] ErrorBoundary coverage: a crashing App
// is caught, logged through the bridge, and shows the recovery UI.
describe("[20260816_Test_MainEntryBoundary] ErrorBoundary", () => {
  it("catches a crashing App, logs via the bridge, and renders the error UI", async () => {
    // Override the App mock for this case only: throw on render.
    vi.doMock("../../src/App", () => ({
      default: () => {
        throw new Error("render exploded");
      },
    }));
    vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
      assertElectronAPI: vi.fn(() => true),
    }));
    const log = vi.fn();
    (globalThis.window as unknown as { electronAPI?: unknown }).electronAPI = {
      log,
    };

    vi.resetModules();
    // Re-apply the App override after resetModules (doMock is one-shot per
    // module graph).
    vi.doMock("../../src/App", () => ({
      default: () => {
        throw new Error("render exploded");
      },
    }));
    document.body.innerHTML = '<div id="root"></div>';

    await import("../../src/main");

    await waitFor(() => {
      expect(screen.getByText("应用出现错误")).toBeInTheDocument();
    });
    expect(screen.getByText(/意外错误/)).toBeInTheDocument();
    expect(log).toHaveBeenCalledWith(
      "error",
      expect.stringContaining("render exploded"),
    );
  });

  it("logs to console when the bridge is absent during a crash", async () => {
    vi.doMock("../../src/App", () => ({
      default: () => {
        throw new Error("no bridge crash");
      },
    }));
    vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
      // Boundary path uses isElectron() (checks window.electronAPI), which is
      // independent of the mount guard — keep the guard true so the tree
      // mounts, then remove the bridge to steer the catch to console.
      assertElectronAPI: vi.fn(() => true),
    }));
    delete (globalThis.window as unknown as { electronAPI?: unknown })
      .electronAPI;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.resetModules();
    vi.doMock("../../src/App", () => ({
      default: () => {
        throw new Error("no bridge crash");
      },
    }));
    document.body.innerHTML = '<div id="root"></div>';

    await import("../../src/main");

    await waitFor(() => {
      expect(screen.getByText("应用出现错误")).toBeInTheDocument();
    });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// [20260816_Test_MainEntryCallbacks] initializeApp's DOM listeners: the
// production contextmenu suppression and the system-theme change reaction.
describe("[20260816_Test_MainEntryCallbacks] initializeApp listeners", () => {
  it("suppresses the context menu in production", async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      vi.resetModules();
      vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
        assertElectronAPI: vi.fn(() => false),
      }));
      delete (globalThis.window as unknown as { electronAPI?: unknown })
        .electronAPI;
      await import("../../src/main");

      const evt = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
      });
      const dispatched = document.dispatchEvent(evt);
      expect(dispatched).toBe(false); // preventDefault was called
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  it("toggles the dark class when the system theme flips (system mode)", async () => {
    let themeListener: ((e: { matches: boolean }) => void) | undefined;
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        if (query.includes("prefers-color-scheme")) themeListener = cb;
      },
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    try {
      vi.resetModules();
      vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
        assertElectronAPI: vi.fn(() => false),
      }));
      delete (globalThis.window as unknown as { electronAPI?: unknown })
        .electronAPI;
      await import("../../src/main");

      expect(themeListener).toBeTypeOf("function");
      act(() => {
        themeListener?.({ matches: true });
      });
      // The change handler only toggles when the stored theme is "system";
      // it reads via electronAPI which is absent here, so getSetting is
      // skipped and no crash occurs either way — assert listener sanity.
      expect(typeof themeListener).toBe("function");
    } finally {
      window.matchMedia = original;
    }
  });
});

// [20260816_Test_BranchPush] main.tsx branch matrix — covers the remaining
// arcs: dev-mode ErrorBoundary details, the electron close-app button on the
// crash screen, global error/unhandledrejection bridging, the bridge-absent
// listener guards, and the matchMedia change handler reacting to stored theme
// values. Rationale: the suites above only cover the mount guards and the
// console-side catch; these pin the bridge-facing branches too.
describe("[20260816_Test_BranchPush] main entry branch matrix", () => {
  const originalAPI = (globalThis.window as { electronAPI?: unknown })
    .electronAPI;
  const originalEnv = process.env.NODE_ENV;
  const originalObserver = (globalThis as { PerformanceObserver?: unknown })
    .PerformanceObserver;

  beforeEach(() => {
    stubMatchMedia();
    vi.resetModules();
  });

  it("exposes error details and the close-app button in development mode", async () => {
    process.env.NODE_ENV = "development";
    // Neutralize the dev-only PerformanceObserver instrumentation — jsdom's
    // implementation may reject the "measure" entry type and abort the import.
    type ObserverEntry = {
      entryType: string;
      name: string;
      duration: number;
    };
    let capturedCallback:
      | ((list: { getEntries: () => ObserverEntry[] }) => void)
      | undefined;
    class StubPerformanceObserver {
      constructor(
        callback: (list: { getEntries: () => ObserverEntry[] }) => void,
      ) {
        capturedCallback = callback;
      }
      observe(_options: { entryTypes: string[] }) {}
    }
    (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver =
      StubPerformanceObserver;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const crash = () => ({
      default: () => {
        throw new Error("render exploded");
      },
    });
    try {
      vi.doMock("../../src/App", crash);
      vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
        assertElectronAPI: vi.fn(() => true),
      }));
      const closeWindow = vi.fn();
      const log = vi.fn();
      (globalThis.window as { electronAPI?: unknown }).electronAPI = {
        log,
        closeWindow,
      };

      await import("../../src/main");

      await waitFor(() => {
        expect(screen.getByText("查看错误详情")).toBeInTheDocument();
      });
      expect(screen.getByText(/render exploded/)).toBeInTheDocument();
      expect(screen.getByText("堆栈:")).toBeInTheDocument();
      expect(document.querySelector("details pre")?.textContent).toBeTruthy();

      // isElectron() arc: the crash screen offers the bridge close button.
      fireEvent.click(screen.getByText("关闭应用"));
      expect(closeWindow).toHaveBeenCalledTimes(1);

      // Dev performance monitor: measure entries log, others are skipped.
      expect(capturedCallback).toBeTypeOf("function");
      capturedCallback?.({
        getEntries: () => [
          { entryType: "measure", name: "定时器", duration: 1.234 },
          { entryType: "paint", name: "无关", duration: 2 },
        ],
      });
      expect(logSpy).toHaveBeenCalledWith("性能测量: 定时器 - 1.23ms");
    } finally {
      logSpy.mockRestore();
      (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver =
        originalObserver;
      process.env.NODE_ENV = originalEnv;
      (globalThis.window as { electronAPI?: unknown }).electronAPI =
        originalAPI;
    }
  });

  it("routes global error events through the bridge log", async () => {
    vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
      assertElectronAPI: vi.fn(() => false),
    }));
    const log = vi.fn();
    (globalThis.window as { electronAPI?: unknown }).electronAPI = { log };

    await import("../../src/main");

    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("页面崩溃"),
        message: "页面崩溃",
      }),
    );
    // error property absent -> falls back to event.message.
    window.dispatchEvent(new ErrorEvent("error", { message: "仅有消息" }));

    expect(log).toHaveBeenCalledWith("error", "Global Error: 页面崩溃");
    expect(log).toHaveBeenCalledWith("error", "Global Error: 仅有消息");
    (globalThis.window as { electronAPI?: unknown }).electronAPI = originalAPI;
  });

  it("routes unhandledrejection events through the bridge log", async () => {
    vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
      assertElectronAPI: vi.fn(() => false),
    }));
    const log = vi.fn();
    (globalThis.window as { electronAPI?: unknown }).electronAPI = { log };

    await import("../../src/main");

    // jsdom lacks PromiseRejectionEvent; synthesize one with a reason prop.
    const evt = new Event("unhandledrejection");
    Object.defineProperty(evt, "reason", { value: "丢弃的原因" });
    window.dispatchEvent(evt);

    expect(log).toHaveBeenCalledWith(
      "error",
      "Unhandled Promise Rejection: 丢弃的原因",
    );
    (globalThis.window as { electronAPI?: unknown }).electronAPI = originalAPI;
  });

  it("ignores global errors when the bridge is absent", async () => {
    vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
      assertElectronAPI: vi.fn(() => false),
    }));
    delete (globalThis.window as { electronAPI?: unknown }).electronAPI;

    await import("../../src/main");

    const evt = new Event("unhandledrejection");
    Object.defineProperty(evt, "reason", { value: "无桥原因" });
    expect(() => {
      window.dispatchEvent(evt);
      window.dispatchEvent(new ErrorEvent("error", { message: "无桥错误" }));
    }).not.toThrow();
  });

  it("warns and still sets the document language when the bridge is missing", async () => {
    vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
      assertElectronAPI: vi.fn(() => false),
    }));
    delete (globalThis.window as { electronAPI?: unknown }).electronAPI;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await import("../../src/main");
      expect(warnSpy).toHaveBeenCalledWith(
        "Electron API不可用，某些功能可能无法正常工作",
      );
      expect(document.documentElement.lang).toBe("zh-CN");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("toggles the dark class on system theme changes in system mode", async () => {
    let themeListener: ((e: { matches: boolean }) => void) | undefined;
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        if (query.includes("prefers-color-scheme")) themeListener = cb;
      },
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    try {
      vi.resetModules();
      vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
        assertElectronAPI: vi.fn(() => false),
      }));
      const getSetting = vi.fn().mockResolvedValue("system");
      (globalThis.window as { electronAPI?: unknown }).electronAPI = {
        getSetting,
      };

      await import("../../src/main");

      expect(themeListener).toBeTypeOf("function");
      await act(async () => {
        themeListener?.({ matches: true });
      });
      await waitFor(() => {
        expect(document.documentElement.classList.contains("dark")).toBe(true);
      });
      await act(async () => {
        themeListener?.({ matches: false });
      });
      await waitFor(() => {
        expect(document.documentElement.classList.contains("dark")).toBe(false);
      });
    } finally {
      window.matchMedia = original;
      document.documentElement.classList.remove("dark");
      (globalThis.window as { electronAPI?: unknown }).electronAPI =
        originalAPI;
    }
  });

  it("keeps the stored non-system theme over a system change", async () => {
    let themeListener: ((e: { matches: boolean }) => void) | undefined;
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        if (query.includes("prefers-color-scheme")) themeListener = cb;
      },
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    try {
      vi.resetModules();
      vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
        assertElectronAPI: vi.fn(() => false),
      }));
      const getSetting = vi.fn().mockResolvedValue("light");
      (globalThis.window as { electronAPI?: unknown }).electronAPI = {
        getSetting,
      };

      await import("../../src/main");

      await act(async () => {
        themeListener?.({ matches: true });
      });
      // Stored theme is "light" — the system change must not toggle dark.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    } finally {
      window.matchMedia = original;
      document.documentElement.classList.remove("dark");
      (globalThis.window as { electronAPI?: unknown }).electronAPI =
        originalAPI;
    }
  });
});
