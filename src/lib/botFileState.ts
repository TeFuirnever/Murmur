// [20260905_Feat_BloubFileLift] File-transcription state -> bot animation
// mapping (spec #224 ticket 4, decision #219): selected -> wide,
// transcribing -> orbit, error -> exclaim; done is celebrated with the comet
// egg on the transition itself (App effect), and idle/cancelled fall through
// to the rest pose. Pure so the mapping is testable without mounting App.

import type { StateId } from "../bot/states";
import type { TranscriptionState } from "../hooks/useFileTranscription";

export function fileStateToBotState(state: TranscriptionState): StateId | null {
  switch (state) {
    case "selected":
      return "wide";
    case "transcribing":
      return "orbit";
    case "error":
      return "exclaim";
    default:
      return null;
  }
}
