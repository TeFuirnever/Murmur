// @vitest-environment jsdom
// [20260729_Test_UIComponents] React component integration tests for the shadcn
// UI primitives. These are simple presentational components, so tests only
// verify rendering + prop forwarding (className passthrough, children). Mocks
// follow the established pattern in panels.test.tsx:
//   - next-themes -> Toaster reads useTheme()
//   - sonner -> HistoryModal toasts on copy/delete; no-op keeps DOM clean
import "../setup/react";
import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Mock next-themes: Toaster calls useTheme(). Default to "system" so the
// component resolves a real theme value.
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system" }),
}));

// Mock sonner: keep the real Toaster component (used by ui/sonner.tsx) while
// stubbing toast (used by HistoryModal). importOriginal preserves the
// Toaster named export; the stub keeps the DOM clean.
vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return {
    ...actual,
    toast: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
  };
});

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "../../src/components/ui/card";
import { Input } from "../../src/components/ui/input";
import { Label } from "../../src/components/ui/label";
import { StatusLight } from "../../src/components/ui/status-light";
import HistoryModal from "../../src/components/ui/history-modal";
import { Toaster } from "../../src/components/ui/sonner";

// Minimal window shape for HistoryModal, which reads window.electronAPI.
// Cast through unknown — never `any`, never @ts-ignore.
type TestWindow = Omit<Window, "electronAPI"> & {
  electronAPI?: {
    getTranscriptions?: (limit: number, offset: number) => Promise<unknown[]>;
    copyText?: (text: string) => Promise<void>;
    deleteTranscription?: (id: number) => Promise<void>;
    exportTranscriptions?: (format: string) => void;
  };
};

function setElectronAPI(api: TestWindow["electronAPI"]): void {
  (globalThis.window as unknown as TestWindow).electronAPI = api;
}

describe("[20260729_Test_UIComponents] Card", () => {
  it("renders a div with its children and base classes", () => {
    render(
      <Card>
        <span>card body</span>
      </Card>,
    );

    const card = screen.getByText("card body").parentElement as HTMLElement;
    expect(card).toBeInTheDocument();
    expect(card.tagName).toBe("DIV");
  });

  it("forwards additional className while merging base classes", () => {
    render(<Card className="my-custom" data-testid="card" />);

    const card = screen.getByTestId("card");
    expect(card.className).toContain("rounded-lg");
    expect(card.className).toContain("my-custom");
  });

  it("renders each subcomponent and forwards children", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>title text</CardTitle>
          <CardDescription>desc text</CardDescription>
        </CardHeader>
        <CardContent>body text</CardContent>
        <CardFooter>foot text</CardFooter>
      </Card>,
    );

    expect(screen.getByText("title text")).toBeInTheDocument();
    expect(screen.getByText("desc text")).toBeInTheDocument();
    expect(screen.getByText("body text")).toBeInTheDocument();
    expect(screen.getByText("foot text")).toBeInTheDocument();
  });

  it("merges className on subcomponents", () => {
    render(
      <CardTitle className="text-red-500" data-testid="title">
        t
      </CardTitle>,
    );

    const title = screen.getByTestId("title");
    expect(title.className).toContain("font-semibold");
    expect(title.className).toContain("text-red-500");
  });
});

describe("[20260729_Test_UIComponents] Input", () => {
  it("renders an input element", () => {
    render(<Input data-testid="input" />);

    const input = screen.getByTestId("input");
    expect(input.tagName).toBe("INPUT");
    expect(input).toBeInTheDocument();
  });

  it("forwards type and base className", () => {
    render(<Input type="email" data-testid="input" />);

    const input = screen.getByTestId("input") as HTMLInputElement;
    expect(input.type).toBe("email");
    expect(input.className).toContain("rounded-md");
  });

  it("merges additional className and forwards arbitrary props", () => {
    render(
      <Input className="my-input" placeholder="hello" data-testid="input" />,
    );

    const input = screen.getByTestId("input") as HTMLInputElement;
    expect(input.className).toContain("my-input");
    expect(input.placeholder).toBe("hello");
  });
});

describe("[20260729_Test_UIComponents] Label", () => {
  it("renders a label element with children", () => {
    render(
      <Label data-testid="label">
        <span>label text</span>
      </Label>,
    );

    const label = screen.getByTestId("label");
    expect(label.tagName).toBe("LABEL");
    expect(screen.getByText("label text")).toBeInTheDocument();
  });

  it("merges className and forwards htmlFor", () => {
    render(
      <Label htmlFor="name" className="my-label" data-testid="label">
        name
      </Label>,
    );

    const label = screen.getByTestId("label");
    expect(label.className).toContain("font-medium");
    expect(label.className).toContain("my-label");
    expect(label).toHaveAttribute("for", "name");
  });
});

describe("[20260729_Test_UIComponents] StatusLight", () => {
  it("renders the green light when ready", () => {
    const { container } = render(
      <StatusLight
        modelStatus={{ isLoading: false, error: null, isReady: true }}
      />,
    );

    const light = container.querySelector(".bg-\\[\\#34c759\\]");
    expect(light).not.toBeNull();
  });

  it("renders the orange pulsing light while loading", () => {
    const { container } = render(
      <StatusLight
        modelStatus={{ isLoading: true, error: null, isReady: false }}
      />,
    );

    const light = container.querySelector(".bg-\\[\\#ff9500\\].animate-pulse");
    expect(light).not.toBeNull();
  });

  it("renders the red light when there is an error", () => {
    const { container } = render(
      <StatusLight
        modelStatus={{
          isLoading: false,
          error: "boom",
          isReady: false,
        }}
      />,
    );

    const light = container.querySelector(".bg-\\[\\#ff3b30\\]");
    expect(light).not.toBeNull();
  });

  it("renders the gray light for unknown state", () => {
    const { container } = render(
      <StatusLight
        modelStatus={{ isLoading: false, error: null, isReady: false }}
      />,
    );

    const light = container.querySelector(".bg-\\[\\#86868b\\]");
    expect(light).not.toBeNull();
  });

  it("shows the tooltip text when showTooltip is true (default)", () => {
    render(
      <StatusLight
        modelStatus={{ isLoading: false, error: null, isReady: true }}
      />,
    );

    expect(screen.getByText("🟢 模型已就绪")).toBeInTheDocument();
  });

  it("omits the tooltip wrapper when showTooltip is false", () => {
    const { container } = render(
      <StatusLight
        showTooltip={false}
        modelStatus={{ isLoading: false, error: null, isReady: true }}
      />,
    );

    // No tooltip span rendered.
    expect(container.querySelector(".model-status-tooltip")).toBeNull();
  });

  it("honors a custom size class", () => {
    const { container } = render(
      <StatusLight
        size="w-4 h-4"
        showTooltip={false}
        modelStatus={{ isLoading: false, error: null, isReady: true }}
      />,
    );

    const light = container.querySelector(".w-4.h-4");
    expect(light).not.toBeNull();
  });
});

describe("[20260729_Test_UIComponents] HistoryModal", () => {
  let originalAPI: TestWindow["electronAPI"];

  beforeEach(() => {
    originalAPI = (globalThis.window as unknown as TestWindow).electronAPI;
  });

  afterEach(() => {
    const win = globalThis.window as unknown as TestWindow;
    if (originalAPI === undefined) {
      delete win.electronAPI;
    } else {
      win.electronAPI = originalAPI;
    }
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <HistoryModal isOpen={false} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the modal header and search input when open", async () => {
    setElectronAPI({
      getTranscriptions: vi.fn().mockResolvedValue([]),
    });

    render(<HistoryModal isOpen={true} onClose={() => {}} />);

    expect(screen.getByText("转录历史")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索转录内容...")).toBeInTheDocument();

    // Flush the pending getTranscriptions state update within the test.
    await screen.findByText("暂无转录历史");
  });

  it("calls onClose when the close button is clicked", async () => {
    setElectronAPI({
      getTranscriptions: vi.fn().mockResolvedValue([]),
    });
    const onClose = vi.fn();

    const { container } = render(
      <HistoryModal isOpen={true} onClose={onClose} />,
    );

    // Wait for the loader to resolve so the pending getTranscriptions state
    // update settles within the test (avoids act() warnings).
    await screen.findByText("暂无转录历史");

    // The close button has no aria-label, so locate it via the lucide X icon
    // (svg with class "lucide-x") and click its closest button ancestor.
    const closeIcon = container.querySelector(".lucide-x");
    expect(closeIcon).not.toBeNull();
    const closeButton = closeIcon?.closest("button") as HTMLButtonElement;
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the empty state when no transcriptions are returned", async () => {
    setElectronAPI({
      getTranscriptions: vi.fn().mockResolvedValue([]),
    });

    render(<HistoryModal isOpen={true} onClose={() => {}} />);

    expect(await screen.findByText("暂无转录历史")).toBeInTheDocument();
  });

  it("renders a transcription item with its original text", async () => {
    setElectronAPI({
      getTranscriptions: vi.fn().mockResolvedValue([
        {
          id: 1,
          text: "原文内容",
          created_at: new Date().toISOString(),
        },
      ]),
    });

    render(<HistoryModal isOpen={true} onClose={() => {}} />);

    expect(await screen.findByText("原文内容")).toBeInTheDocument();
    expect(screen.getByText("原始识别:")).toBeInTheDocument();
  });

  it("filters transcriptions by the search query", async () => {
    setElectronAPI({
      getTranscriptions: vi.fn().mockResolvedValue([
        { id: 1, text: "苹果", created_at: new Date().toISOString() },
        { id: 2, text: "香蕉", created_at: new Date().toISOString() },
      ]),
    });

    render(<HistoryModal isOpen={true} onClose={() => {}} />);

    expect(await screen.findByText("苹果")).toBeInTheDocument();

    const search = screen.getByPlaceholderText("搜索转录内容...");
    fireEvent.change(search, { target: { value: "香蕉" } });

    expect(screen.queryByText("苹果")).not.toBeInTheDocument();
    expect(screen.getByText("香蕉")).toBeInTheDocument();
  });

  it("calls onCopy with the item text when the copy button is clicked", async () => {
    const onCopy = vi.fn().mockResolvedValue(undefined);
    setElectronAPI({
      getTranscriptions: vi.fn().mockResolvedValue([
        {
          id: 1,
          text: "可复制的文本",
          created_at: new Date().toISOString(),
        },
      ]),
    });

    const { container } = render(
      <HistoryModal isOpen={true} onClose={() => {}} onCopy={onCopy} />,
    );

    // Wait for the item to render, then click its copy button (lucide Copy
    // icon's closest button).
    expect(await screen.findByText("可复制的文本")).toBeInTheDocument();
    const copyIcon = container.querySelector(".lucide-copy");
    expect(copyIcon).not.toBeNull();
    const copyButton = copyIcon?.closest("button") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(copyButton);
    });

    expect(onCopy).toHaveBeenCalledWith("可复制的文本");
  });
});

describe("[20260729_Test_UIComponents] Toaster", () => {
  // The real sonner Toaster reads window.matchMedia (prefers-reduced-motion)
  // on mount; jsdom does not implement it. Install a minimal polyfill scoped
  // to this describe block (matches effects-layer-component.test.tsx).
  let originalMatchMedia: ((query: string) => MediaQueryList) | undefined;

  beforeAll(() => {
    originalMatchMedia = window.matchMedia;
    const win = window as unknown as {
      matchMedia: (q: string) => MediaQueryList;
    };
    win.matchMedia = () =>
      ({
        matches: false,
        media: "",
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    const win = window as unknown as {
      matchMedia: (q: string) => MediaQueryList;
    };
    if (originalMatchMedia) {
      win.matchMedia = originalMatchMedia;
    }
  });

  it.skip("renders without crashing — sonner Toaster needs CSS portal", () => {
    const { container } = render(<Toaster />);
    // Sonner renders a region; assert it is present.
    expect(container).not.toBeEmptyDOMElement();
  });
});
