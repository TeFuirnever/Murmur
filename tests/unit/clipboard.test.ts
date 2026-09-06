// [20260906_Test_ClipboardBehavior] Spec #266 T08 (#285): behavior tests for
// the clipboard manager's paste pipeline — the manager itself previously had
// zero coverage (only the IPC handler layer was tested; research doc G5).
// Mocks electron.clipboard + child_process.spawn and asserts external
// behavior: original-clipboard save/restore, the per-platform paste command
// arms (osascript / PowerShell+SendKeys / xdotool), the 3s timeout with its
// no-double-settle guard, the macOS accessibility-permission gate, and
// copyText.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

type FakeProc = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

const mockClipboard = vi.hoisted(() => ({
  readText: vi.fn<() => string>(() => "ORIGINAL"),
  writeText: vi.fn<(text: string) => void>(),
}));

vi.mock("electron", () => ({ clipboard: mockClipboard }));

const spawned: FakeProc[] = [];
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({ spawn: spawnMock }));

import ClipboardManager from "../../src/helpers/clipboard";

const ORIG_PLATFORM = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
    writable: true,
  });
}

function makeFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  spawned.push(proc);
  return proc;
}

describe("[20260906_Test_ClipboardBehavior] ClipboardManager", () => {
  let manager: ClipboardManager;

  beforeEach(() => {
    vi.clearAllMocks();
    spawned.length = 0;
    mockClipboard.readText.mockReturnValue("ORIGINAL");
    setPlatform("darwin");
    manager = new ClipboardManager(null);
    // Every spawn hands back a driver FakeProc the test can emit on.
    spawnMock.mockImplementation(() => makeFakeProc());
    vi.useFakeTimers();
  });

  afterEach(() => {
    setPlatform(ORIG_PLATFORM);
    vi.useRealTimers();
  });

  it("copies the new text to the clipboard before pasting", async () => {
    setPlatform("win32");
    const promise = manager.pasteText("你好世界");
    const proc = spawned[0]!;

    expect(mockClipboard.readText).toHaveBeenCalled();
    expect(mockClipboard.writeText).toHaveBeenCalledWith("你好世界");
    expect(spawnMock).toHaveBeenCalledWith(
      "powershell",
      [
        "-Command",
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")',
      ],
      { windowsHide: true },
    );

    proc.emit("close", 0);
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    // original clipboard content restored after the paste settles
    expect(mockClipboard.writeText).toHaveBeenLastCalledWith("ORIGINAL");
  });

  it("mac arm spawns osascript Cmd+V through the accessibility gate", async () => {
    const promise = manager.pasteText("hello");

    // first spawn = accessibility probe; grant permission
    expect(spawned[0]).toBeDefined();
    spawned[0]!.emit("close", 0);
    await vi.advanceTimersByTimeAsync(100);

    expect(spawned[1]).toBeDefined();
    expect(spawnMock).toHaveBeenLastCalledWith("osascript", [
      "-e",
      'tell application "System Events" to keystroke "v" using command down',
    ]);
    spawned[1]!.emit("close", 0);
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });

  it("mac arm without accessibility permission rejects with guidance", async () => {
    const outcome = manager.pasteText("hello").then(
      () => "resolved" as const,
      (err: Error) => `rejected: ${err.message}`,
    );
    spawned[0]!.emit("close", 1); // probe fails

    await vi.advanceTimersByTimeAsync(0);
    const result = await outcome;
    expect(result).toContain("rejected");
    expect(result).toContain("需要辅助功能权限");
    // the only follow-up spawn is the accessibility dialog, never a paste
    expect(spawned).toHaveLength(2);
    expect(spawnMock).toHaveBeenLastCalledWith("osascript", [
      "-e",
      expect.stringContaining("display dialog"),
    ]);
    expect(mockClipboard.writeText).toHaveBeenLastCalledWith("hello");
  });

  it("mac arm rejects with the exit code when keystroke fails", async () => {
    const promise = manager.pasteText("hello");
    spawned[0]!.emit("close", 0); // permission granted
    await vi.advanceTimersByTimeAsync(100);
    spawned[1]!.emit("close", 1); // keystroke failed

    await expect(promise).rejects.toThrow("粘贴失败 (代码 1)");
  });

  it("win arm timeout kills the process, rejects, and never double-settles", async () => {
    setPlatform("win32");
    const promise = manager.pasteText("hello");
    const proc = spawned[0]!;

    const guarded = promise
      .then(() => "resolved")
      .catch((err: Error) => `rejected: ${err.message}`);
    await vi.advanceTimersByTimeAsync(3000);

    expect(proc.kill).toHaveBeenCalled();
    const first = await guarded;
    expect(first).toContain("Windows 粘贴操作超时");

    // a late close event must not produce a second settlement
    proc.emit("close", 0);
    await vi.advanceTimersByTimeAsync(100);
    expect(mockClipboard.writeText).not.toHaveBeenLastCalledWith("ORIGINAL");
  });

  it("posix arm (linux) pastes via xdotool", async () => {
    setPlatform("linux");
    const promise = manager.pasteText("hello");
    const proc = spawned[0]!;

    expect(spawnMock).toHaveBeenCalledWith("xdotool", ["key", "ctrl+v"]);
    proc.emit("close", 0);
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });

  it("checkAccessibilityPermissions spawns the probe on darwin only", async () => {
    const darwinPromise = manager.checkAccessibilityPermissions();
    spawned[spawned.length - 1]!.emit("close", 0);
    await expect(darwinPromise).resolves.toBe(true);
    expect(spawned.length).toBeGreaterThan(0);

    spawned.length = 0;
    setPlatform("win32");
    await expect(manager.checkAccessibilityPermissions()).resolves.toBe(true);
    expect(spawned).toHaveLength(0); // no osascript probe off darwin
  });

  it("copyText writes the clipboard and reports success", async () => {
    await expect(manager.copyText("copied")).resolves.toEqual({
      success: true,
    });
    expect(mockClipboard.writeText).toHaveBeenCalledWith("copied");
  });
});
