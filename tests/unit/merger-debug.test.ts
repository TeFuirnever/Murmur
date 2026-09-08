import { describe, it } from "vitest";
import { createSseMerger } from "../../src/helpers/polish-stream";
describe("dbg", () => {
  it("dbg", () => {
    const part1 = 'data: {"choices":[{"delta":{"content":"' + "你";
    const part2 = '好"}}]' + String.fromCharCode(125, 10, 10);
    const joined = part1 + part2;
    console.log(
      "joined bytes:",
      Buffer.byteLength(joined),
      JSON.stringify(joined),
    );
    try {
      const o = JSON.parse(joined.slice(6));
      console.log("parsed ok:", o.choices[0].delta.content);
    } catch (e) {
      console.log("PARSE FAIL:", (e as Error).message.slice(0, 80));
    }
    const now = () => 1_000_000;
    const deltas: string[] = [];
    const m = createSseMerger({ now, onDelta: (t) => deltas.push(t) });
    m.push(part1);
    m.push(part2);
    m.flush();
    console.log("merger deltas:", JSON.stringify(deltas));
  });
});
