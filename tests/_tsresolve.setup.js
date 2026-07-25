// [20260724_TS_BigBang_Resolver] Three-part monkey-patch so that bare
// require("../../src/helpers/X") in .js test files works after the .js twins
// are deleted in the big-bang migration.
//
// PART 1 — register .ts loader: vitest transforms .ts files loaded via ESM
// `import`, but native require() in .js test files bypasses Vite's transform
// pipeline. Node's CJS loader has no Module._extensions['.ts'] handler, so
// require("./foo.ts") throws ERR_UNKNOWN_FILE_EXTENSION. This registers a
// .ts extension handler that transforms the source to CJS via esbuild (which
// is already a project dependency). The transform strips TypeScript types
// and converts ESM `import`/`export default` to CJS `require`/`exports.default`.
// We also handle the .ts → .js resolution in Module._resolveFilename (PART 2).
//
// PART 2 — resolve .ts for extensionless require: vitest's resolve.extensions
// only applies to ESM `import`, NOT to require() inside .js test files (which
// uses Node's native resolver). Node's native resolver tries .js/.json/.node
// but NOT .ts, so once .js twins are deleted every require("../../src/...")
// in a .js test returns MODULE_NOT_FOUND. This patch intercepts
// Module._resolveFilename: for relative paths without an extension, it first
// tries appending ".ts".
//
// PART 3 — unwrap default export: .ts source files use `export default Class`
// (ESM). esbuild's CJS transform compiles this to { __esModule: true, default:
// Class }, so `const X = require("./foo"); new X()` throws "X is not a
// constructor" because require() returns the wrapper, not the class. Tests
// were written against the old CJS `module.exports = Class` shape and do
// `new require()()`. This patch intercepts Module._load: when a module has
// the ESM-default shape ({__esModule, default} with default as the ONLY
// export), it returns mod.default directly so `new require()()` works.
// Modules with named exports (default + extra keys) are NOT unwrapped, so
// `require("./foo").namedFn` and `const { fn } = require("./foo")` still work
// — those modules expose named functions as static class methods or
// top-level named exports.
//
// Why not touch tests instead? The spec said "don't touch tests", but Phase
// 3's comments claiming "vite-intercepted require for .ts compatibility"
// were aspirational — empirically, plain require() in .js test files is
// native Node. This single config-level patch fixes all test files without
// editing them.
import Module from "module";
import path from "path";
import fs from "fs";
import esbuild from "esbuild";

// [20260724_TS_BigBang_Resolver] PART 1: register a .ts extension handler so
// native require() can load .ts files. esbuild transforms TS → CJS, stripping
// types and converting ESM syntax. This is the same transform the build uses.
if (!Module._extensions[".ts"]) {
  const tsCompilerOptions = {
    format: "cjs",
    target: "es2020",
    platform: "node",
    sourcemap: "inline",
    loader: "ts",
    // Keep import.meta / __dirname working in CJS
    banner: "",
  };
  Module._extensions[".ts"] = function (module, filename) {
    const source = fs.readFileSync(filename, "utf8");
    let compiled;
    try {
      compiled = esbuild.transformSync(source, {
        ...tsCompilerOptions,
        sourcefile: filename,
      }).code;
    } catch (err) {
      // Re-throw with filename context for easier debugging
      err.message = `tsrequire transform failed for ${filename}: ${err.message}`;
      throw err;
    }
    module._compile(compiled, filename);
  };
}

// [20260724_TS_BigBang_Resolver] PART 2: resolve .ts for extensionless require
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (
    parent &&
    typeof request === "string" &&
    request.startsWith(".") &&
    !path.extname(request)
  ) {
    try {
      return origResolveFilename.call(
        this,
        request + ".ts",
        parent,
        isMain,
        options,
      );
    } catch (_) {
      // .ts not found — fall through to default resolution (.js, .json, etc.)
    }
  }
  return origResolveFilename.call(this, request, parent, isMain, options);
};

// [20260724_TS_BigBang_Resolver] PART 3: unwrap {__esModule, default} → default
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const result = origLoad.call(this, request, parent, isMain);
  if (
    result &&
    typeof result === "object" &&
    result.__esModule === true &&
    "default" in result
  ) {
    const keys = Object.keys(result).filter((k) => k !== "__esModule");
    // Only unwrap when `default` is the sole meaningful export (class/function
    // modules). Named-export modules keep their object shape.
    if (keys.length === 1 && keys[0] === "default") {
      return result.default;
    }
  }
  return result;
};
// [20260724_TS_BigBang_Resolver] END
