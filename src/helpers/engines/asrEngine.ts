// [20260724_TS_BigBang_AsrEngine] Migrated from .js to .ts (ADR-010).
// `module.exports = { validateASREngine, createASREngineRegistry }` (named
// object) became named exports. JSDoc @typedef became TS interfaces.
import type {
  FileTranscriptionResult,
  FunASRStatusResult,
} from "../../types/ipc";

/** ASR engine interface — pluggable transcription backend. */
export interface ASREngine {
  transcribeAudio(
    audioData: ArrayBuffer | Blob,
    options?: Record<string, unknown>,
  ): Promise<FileTranscriptionResult>;
  transcribeFile(
    audioPath: string,
    options?: Record<string, unknown>,
  ): Promise<FileTranscriptionResult>;
  cancelTranscription(): Promise<{ success: boolean }>;
  checkStatus(): Promise<FunASRStatusResult>;
  shutdown(): Promise<void>;
}

/** Registry for managing multiple ASR engines. */
export interface ASREngineRegistry {
  register(name: string, engine: ASREngine): boolean;
  get(name: string): ASREngine | undefined;
  list(): string[];
  setDefault(name: string): boolean;
  getDefault(): string | undefined;
  setActive(name: string): boolean;
  getActive(): ASREngine | undefined;
}

const REQUIRED_METHODS: readonly string[] = [
  "transcribeAudio",
  "transcribeFile",
  "cancelTranscription",
  "checkStatus",
  "shutdown",
];

function validateASREngine(engine: unknown): engine is ASREngine {
  if (!engine || typeof engine !== "object") return false;
  const obj = engine as Record<string, unknown>;
  return REQUIRED_METHODS.every((method) => typeof obj[method] === "function");
}

function createASREngineRegistry(): ASREngineRegistry {
  const engines = new Map<string, ASREngine>();
  let defaultName: string | undefined;
  let activeName: string | undefined;

  return {
    register(name: string, engine: ASREngine): boolean {
      if (!validateASREngine(engine)) return false;
      engines.set(name, engine);
      if (engines.size === 1 && !defaultName) {
        defaultName = name;
        activeName = name;
      }
      return true;
    },

    get(name: string): ASREngine | undefined {
      return engines.get(name);
    },

    list(): string[] {
      return Array.from(engines.keys());
    },

    setDefault(name: string): boolean {
      if (!engines.has(name)) return false;
      defaultName = name;
      return true;
    },

    getDefault(): string | undefined {
      return defaultName;
    },

    setActive(name: string): boolean {
      if (!engines.has(name)) return false;
      activeName = name;
      return true;
    },

    getActive(): ASREngine | undefined {
      const name = activeName || defaultName;
      return name ? engines.get(name) : undefined;
    },
  };
}

export { validateASREngine, createASREngineRegistry };
// [20260724_TS_BigBang_AsrEngine] END
