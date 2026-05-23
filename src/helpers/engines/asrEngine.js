const REQUIRED_METHODS = [
  "transcribeAudio",
  "transcribeFile",
  "cancelTranscription",
  "checkStatus",
  "shutdown",
];

function validateASREngine(engine) {
  if (!engine || typeof engine !== "object") return false;
  return REQUIRED_METHODS.every(
    (method) => typeof engine[method] === "function",
  );
}

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
