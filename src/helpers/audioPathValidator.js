// [20260724_TS_Migration_AudioPathValidator] Re-export from .ts source of truth.
// This .js shim allows existing require() callers to work during the gradual
// backend TS migration (ADR-010). Once all consumers are .ts, this file
// can be deleted.
const { validateAudioPath } = require("./audioPathValidator.ts");
module.exports = { validateAudioPath };
