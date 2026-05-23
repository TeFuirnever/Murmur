import { describe, it, expect } from "vitest";
const C = require("../../src/helpers/ipc-contracts");

describe("ipc-contracts", () => {
  it("exports all domain objects", () => {
    expect(C.ENVIRONMENT).toBeDefined();
    expect(C.PYTHON).toBeDefined();
    expect(C.FUNASR).toBeDefined();
    expect(C.MODELS).toBeDefined();
    expect(C.TRANSCRIPTION).toBeDefined();
    expect(C.AI).toBeDefined();
    expect(C.SETTINGS).toBeDefined();
    expect(C.WINDOW).toBeDefined();
    expect(C.HOTKEY).toBeDefined();
    expect(C.CLIPBOARD).toBeDefined();
    expect(C.SYSTEM).toBeDefined();
    expect(C.EVENTS).toBeDefined();
  });

  it("every channel name is a non-empty string", () => {
    for (const [domain, channels] of Object.entries(C)) {
      for (const [key, value] of Object.entries(channels)) {
        expect(typeof value, `${domain}.${key}`).toBe("string");
        expect(
          value.length,
          `${domain}.${key} should not be empty`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("has no duplicate channel names across all domains", () => {
    const allValues = [];
    for (const channels of Object.values(C)) {
      for (const value of Object.values(channels)) {
        allValues.push(value);
      }
    }
    const unique = new Set(allValues);
    expect(unique.size).toBe(allValues.length);
  });

  it("WINDOW domain has all expected channels", () => {
    expect(C.WINDOW.HIDE).toBe("hide-window");
    expect(C.WINDOW.SHOW).toBe("show-window");
    expect(C.WINDOW.CLOSE).toBe("close-window");
    expect(C.WINDOW.SET_TOP).toBe("set-always-on-top");
  });

  it("TRANSCRIPTION domain has all expected channels", () => {
    expect(C.TRANSCRIPTION.AUDIO).toBe("transcribe-audio");
    expect(C.TRANSCRIPTION.SAVE).toBe("save-transcription");
    expect(C.TRANSCRIPTION.GET_ALL).toBe("get-transcriptions");
    expect(C.TRANSCRIPTION.DELETE).toBe("delete-transcription");
    expect(C.TRANSCRIPTION.CLEAR).toBe("clear-all-transcriptions");
  });

  it("EVENTS domain has all expected channels", () => {
    expect(C.EVENTS.TOGGLE_DICTATION).toBe("toggle-dictation");
    expect(C.EVENTS.HOTKEY_TRIGGERED).toBe("hotkey-triggered");
    expect(C.EVENTS.F2_DOUBLE_CLICK).toBe("f2-double-click");
    expect(C.EVENTS.MODEL_DOWNLOAD_PROGRESS).toBe("model-download-progress");
    expect(C.EVENTS.FILE_TRANSCRIPTION_PROGRESS).toBe(
      "file-transcription-progress",
    );
  });

  it("SETTINGS domain has all expected channels", () => {
    expect(C.SETTINGS.GET).toBe("get-setting");
    expect(C.SETTINGS.SET).toBe("set-setting");
    expect(C.SETTINGS.GET_ALL).toBe("get-all-settings");
    expect(C.SETTINGS.RESET).toBe("reset-settings");
  });

  it("AI domain has process and check-status channels", () => {
    expect(C.AI.PROCESS).toBe("process-text");
    expect(C.AI.CHECK_STATUS).toBe("check-ai-status");
  });
});
