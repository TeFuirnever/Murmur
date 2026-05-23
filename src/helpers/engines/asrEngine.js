/**
 * @typedef {Object} ASREngine
 * @property {(audioData: ArrayBuffer|Blob, options?: Record<string, unknown>) => Promise<import("../../types/ipc").FileTranscriptionResult>} transcribeAudio
 * @property {(audioPath: string, options?: Record<string, unknown>) => Promise<import("../../types/ipc").FileTranscriptionResult>} transcribeFile
 * @property {() => Promise<{success: boolean}>} cancelTranscription
 * @property {() => Promise<import("../../types/ipc").FunASRStatusResult>} checkStatus
 * @property {() => Promise<void>} shutdown
 */

/**
 * @typedef {Object} ASREngineRegistry
 * @property {(name: string, engine: ASREngine) => boolean} register
 * @property {(name: string) => ASREngine | undefined} get
 * @property {() => string[]} list
 * @property {(name: string) => boolean} setDefault
 * @property {() => string | undefined} getDefault
 * @property {(name: string) => boolean} setActive
 * @property {() => ASREngine | undefined} getActive
 */

/** @type {string[]} */
const REQUIRED_METHODS = [
  "transcribeAudio",
  "transcribeFile",
  "cancelTranscription",
  "checkStatus",
  "shutdown",
];

/**
 * @param {unknown} engine
 * @returns {engine is ASREngine}
 */
function validateASREngine(engine) {
  if (!engine || typeof engine !== "object") return false;
  return REQUIRED_METHODS.every(
    (method) => typeof engine[method] === "function",
  );
}

/**
 * @returns {ASREngineRegistry}
 */
function createASREngineRegistry() {
  const engines = new Map();
  let defaultName;
  let activeName;

  return {
    register(name, engine) {
      if (!validateASREngine(engine)) return false;
      engines.set(name, engine);
      if (engines.size === 1 && !defaultName) {
        defaultName = name;
        activeName = name;
      }
      return true;
    },

    get(name) {
      return engines.get(name);
    },

    list() {
      return Array.from(engines.keys());
    },

    setDefault(name) {
      if (!engines.has(name)) return false;
      defaultName = name;
      return true;
    },

    getDefault() {
      return defaultName;
    },

    setActive(name) {
      if (!engines.has(name)) return false;
      activeName = name;
      return true;
    },

    getActive() {
      const name = activeName || defaultName;
      return name ? engines.get(name) : undefined;
    },
  };
}

module.exports = { validateASREngine, createASREngineRegistry };
