// @vitest-environment jsdom
// [20260729_Test_SettingsPanel_EffectsLayer] React component integration tests
// for EffectsLayer. The component is the single gate for visual effects: it
// must render nothing when disabled, when WebGL is unavailable, or when the
// user prefers reduced motion, and must mount the Aurora layer only when all
// three conditions pass. We mock detectWebGL to control the supported flag,
// window.matchMedia to control reduced-motion, and the lazy-loaded Aurora so
// the real ogl/GL dependency never loads in jsdom.
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

// Mock detectWebGL: the detection result is controlled per-test via
// mockReturnValue. Default to supported=true so only the gate logic varies.
vi.mock("../../src/components/effects/detectWebGL", () => ({
  detectWebGL: vi.fn().mockReturnValue({ supported: true }),
}));

// Mock the lazy Aurora component: the real Aurora imports ogl and talks to
// GL, which jsdom cannot provide. Render a stable marker so the happy path can
// assert the layer actually mounts.
vi.mock("../../src/components/effects/Aurora", () => ({
  __esModule: true,
  default: ({ colorStops }: { colorStops: string[] }) => (
    <div data-testid="aurora-mock" data-stops={colorStops.join(",")} />
  ),
}));

import { EffectsLayer } from "../../src/components/effects/EffectsLayer";
import { detectWebGL } from "../../src/components/effects/detectWebGL";
import { AURORA_COLOR_STOPS } from "../../src/components/effects/aurora-theme";

// MatchMedia mock. jsdom does not implement matchMedia, so we provide a
// controllable MediaQueryList whose `matches` reflects the reduced-motion
// preference under test.
interface MatchMediaMock extends MediaQueryList {
  __setMatches(matches: boolean): void;
}

function installMatchMedia(initialMatches: boolean): MatchMediaMock {
  let listeners: ((e: MediaQueryListEvent) => void)[] = [];
  let matches = initialMatches;
  const mql: MatchMediaMock = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: (
      _type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      const fn = listener as (e: MediaQueryListEvent) => void;
      listeners.push(fn);
    },
    removeEventListener: (
      _type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      const fn = listener as (e: MediaQueryListEvent) => void;
      listeners = listeners.filter((l) => l !== fn);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
    __setMatches(next: boolean) {
      matches = next;
      Object.defineProperty(this, "matches", {
        value: next,
        configurable: true,
      });
      const event = { matches } as MediaQueryListEvent;
      for (const l of listeners) l(event);
    },
  };
  const win = window as unknown as {
    matchMedia: (q: string) => MediaQueryList;
  };
  win.matchMedia = () => mql;
  return mql;
}

describe("[20260729_Test_SettingsPanel_EffectsLayer] EffectsLayer", () => {
  let originalMatchMedia: ((query: string) => MediaQueryList) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset detectWebGL to the supported default between tests.
    vi.mocked(detectWebGL).mockReturnValue({ supported: true });
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    // Restore matchMedia if it was replaced.
    const win = window as unknown as {
      matchMedia: (q: string) => MediaQueryList;
    };
    if (originalMatchMedia) {
      win.matchMedia = originalMatchMedia;
    }
  });

  it("renders nothing when enabled is false", () => {
    installMatchMedia(false);
    const { container } = render(<EffectsLayer enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when enabled but WebGL is unsupported", () => {
    vi.mocked(detectWebGL).mockReturnValue({
      supported: false,
      reason: "software-renderer:swiftshader",
    });
    installMatchMedia(false);

    const { container } = render(<EffectsLayer enabled={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when enabled, WebGL supported, but prefers-reduced-motion is set", () => {
    installMatchMedia(true);

    const { container } = render(<EffectsLayer enabled={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the Aurora layer when enabled, WebGL supported, and no reduced-motion", async () => {
    installMatchMedia(false);

    const { queryByTestId, getByTestId } = render(
      <EffectsLayer enabled={true} />,
    );

    // The effect runs after mount (detectWebGL + matchMedia read in an
    // effect), so the marker appears asynchronously.
    await waitFor(() => expect(getByTestId("aurora-mock")).toBeInTheDocument());
    // verify nothing else leaked.
    expect(queryByTestId("aurora-mock")).not.toBeNull();
  });

  it("passes the brand colorStops to Aurora", async () => {
    installMatchMedia(false);

    const { getByTestId } = render(<EffectsLayer enabled={true} />);

    await waitFor(() => expect(getByTestId("aurora-mock")).toBeInTheDocument());
    const marker = getByTestId("aurora-mock");
    expect(marker.getAttribute("data-stops")).toBe(
      AURORA_COLOR_STOPS.join(","),
    );
  });

  it("does not probe WebGL while disabled", () => {
    installMatchMedia(false);
    vi.mocked(detectWebGL).mockClear();

    render(<EffectsLayer enabled={false} />);

    expect(detectWebGL).not.toHaveBeenCalled();
  });
});
