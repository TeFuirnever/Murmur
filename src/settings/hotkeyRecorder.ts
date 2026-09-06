// [20260905_Fix_246_HotkeySettingsUi] Pure helpers for the hotkey recorder in
// the settings window (issue #246: the settings entry the failure toast
// pointed at did not exist). Keep this module free of React/Electron imports
// so the accelerator mapping stays unit-testable in isolation.

/** Historical default recording hotkey (single renderer-side source). */
export const DEFAULT_HOTKEY = "CommandOrControl+Shift+Space";

/**
 * Map a keydown event to an Electron globalShortcut accelerator.
 *
 * Returns null when the press cannot become an accelerator — Escape (the
 * recorder's cancel key), modifier-only presses, and non-modifier keys
 * without any modifier. Bare F-keys are valid single-part accelerators.
 */
export function buildAccelerator(event: KeyboardEvent): string | null {
  if (event.key === "Escape") {
    return null;
  }

  const parts: string[] = [];
  // CommandOrControl maps to Cmd on macOS and Ctrl elsewhere, so the
  // recorder accepts either modifier and normalizes to the portable token.
  if (event.metaKey || event.ctrlKey) {
    parts.push("CommandOrControl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }

  const mainKey = acceleratorMainKey(event);
  if (mainKey === null) {
    return null;
  }
  parts.push(mainKey);

  // A bare F-key is a valid accelerator; anything else needs a modifier.
  if (parts.length === 1 && !/^F\d+$/.test(mainKey)) {
    return null;
  }
  return parts.join("+");
}

function acceleratorMainKey(event: KeyboardEvent): string | null {
  // Modifier keys themselves never terminate a recording.
  if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) {
    return null;
  }
  if (/^F\d+$/.test(event.key)) {
    return event.key;
  }
  if (event.code.startsWith("Key") && /^Key[A-Z]$/.test(event.code)) {
    return event.code.slice(3);
  }
  if (/^Digit\d$/.test(event.code)) {
    return event.code.slice(5);
  }
  const arrowByCode: Record<string, string> = {
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  };
  if (event.code in arrowByCode) {
    return arrowByCode[event.code] ?? null;
  }
  if (event.key === " " || event.code === "Space") {
    return "Space";
  }
  return null;
}

/** Platform probe for display purposes (⌘ vs Ctrl), Electron-free. */
function isMacLike(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const uaData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  return (
    uaData?.platform?.startsWith("mac") ?? /mac/i.test(navigator.userAgent)
  );
}

/**
 * Human-facing display form. CommandOrControl resolves to ⌘ on macOS and
 * Ctrl elsewhere (matching the main window's formatter); Space is rendered
 * via the caller-supplied localized label so this pure module stays i18n-free.
 */
export function formatAccelerator(
  accelerator: string,
  spaceLabel = "Space",
): string {
  return accelerator
    .replace("CommandOrControl", isMacLike() ? "⌘" : "Ctrl")
    .replace("Shift", "⇧")
    .replace("Alt", "⌥")
    .replace("Space", spaceLabel)
    .split("+")
    .join(" + ");
}
