// [20260905_Feat_BloubFileLift] File-transcription state -> bot animation
// mapping (spec #224 ticket 4, decision #219). Pure function so the mapping
// is testable without mounting App.

import { describe, expect, it } from "vitest";
import { fileStateToBotState } from "../../src/lib/botFileState";

describe("fileStateToBotState", () => {
  it("maps selected to wide (attentive)", () => {
    expect(fileStateToBotState("selected")).toBe("wide");
  });

  it("maps transcribing to orbit (long-running work)", () => {
    expect(fileStateToBotState("transcribing")).toBe("orbit");
  });

  it("maps error to exclaim", () => {
    expect(fileStateToBotState("error")).toBe("exclaim");
  });

  it("returns null for idle, done and cancelled so App falls through", () => {
    // done is celebrated with the comet egg on the transition itself, not
    // held as a pose; cancelled/idle leave the bot at rest
    expect(fileStateToBotState("idle")).toBeNull();
    expect(fileStateToBotState("done")).toBeNull();
    expect(fileStateToBotState("cancelled")).toBeNull();
  });
});
