const { runCommand, TIMEOUTS } = require("../../src/utils/process");

describe("process utils", () => {
  describe("TIMEOUTS", () => {
    it("has expected timeout values", () => {
      expect(TIMEOUTS.QUICK_CHECK).toBe(5000);
      expect(TIMEOUTS.PIP_UPGRADE).toBe(60000);
      expect(TIMEOUTS.INSTALL).toBe(300000);
      expect(TIMEOUTS.DOWNLOAD).toBe(600000);
    });
  });

  describe("runCommand", () => {
    it("resolves with output and code 0 on success", async () => {
      const result = await runCommand("echo", ["hello"]);
      expect(result.code).toBe(0);
      expect(result.output).toContain("hello");
    });

    it("rejects with error on non-zero exit code", async () => {
      await expect(
        runCommand("node", ["-e", "process.exit(1)"]),
      ).rejects.toThrow("Command failed with code 1");
    });

    it("rejects with error when command does not exist", async () => {
      await expect(
        runCommand("nonexistent_command_xyz_12345", []),
      ).rejects.toThrow();
    });

    it("rejects on timeout", async () => {
      await expect(
        runCommand("node", ["-e", "setTimeout(()=>{}, 10000)"], {
          timeout: 100,
        }),
      ).rejects.toThrow("timed out");
    });

    it("accepts cwd option", async () => {
      const result = await runCommand("pwd", [], { cwd: "/tmp" });
      expect(result.code).toBe(0);
      expect(result.output).toContain("tmp");
    });
  });
});
