// [20260820_T14_Hotwords] Ticket #183 (spec #177 T14): hotword input
// sanitization shared by BOTH boundaries (settings save + transcription
// injection) — UI limits alone cannot stop a corrupted DB or a renderer
// bug from feeding garbage to the model (spec adversarial review MJ-6).
// The joined-with-spaces format is what the T13 spike proved effective:
// generate(hotword="张晗玥 刘翀").

/** Maximum number of hotword entries. */
export const MAX_HOTWORD_LINES = 200;
/** Maximum characters per hotword entry. */
export const MAX_HOTWORD_LINE_CHARS = 32;
/** Maximum total characters of the joined hotword string. */
export const MAX_HOTWORD_TOTAL_CHARS = 4096;

// C0/C1 control characters (0x00-0x1F except \n, 0x7F-0x9F) — never
// meaningful in a hotword and able to corrupt the JSON line protocol.
// \n is the line separator and must survive until the split below.
const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;
// Lone UTF-16 surrogates — crash Python's stdout UTF-8 encoder on Windows.
const LONE_SURROGATES =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Coerce arbitrary input into a safe, joined hotword string.
 * Returns "" for empty/invalid input — callers must OMIT the hotword
 * field entirely in that case (byte-identical to pre-hotword behavior).
 *
 * [T14 review MAJOR-4] All slicing is CODE-POINT based (Array.from) and a
 * final lone-surrogate strip runs after the total cap: UTF-16-unit slicing
 * can split a surrogate pair at a cap boundary — manufacturing the very
 * crash input (lone surrogate → Python stdout UTF-8 encode failure) this
 * module exists to prevent.
 */
export function sanitizeHotwordInput(input: unknown): string {
  if (typeof input !== "string") return "";
  const cleaned = input.replace(CONTROL_CHARS, "").replace(LONE_SURROGATES, "");
  const lines = cleaned
    .split("\n")
    .map((line) =>
      Array.from(line.trim()).slice(0, MAX_HOTWORD_LINE_CHARS).join(""),
    )
    .filter((line) => line.length > 0)
    .slice(0, MAX_HOTWORD_LINES);
  const joined = Array.from(lines.join(" "))
    .slice(0, MAX_HOTWORD_TOTAL_CHARS)
    .join("");
  // Final strip: the total cap itself can still split a pair.
  return joined.replace(LONE_SURROGATES, "").trimEnd();
}
// [20260820_T14_Hotwords] END
