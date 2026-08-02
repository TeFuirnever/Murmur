import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "dist-main/",
      "dist-preload/",
      "node_modules/",
      "src/dist/",
      "src/node_modules/",
      "src/coverage/",
      ".venv/",
      "python/",
      ".omc/",
      "website/.astro/",
    ],
  },

  // TypeScript parser + recommended rules
  ...tseslint.configs.recommended,

  // Shared rules for all files
  {
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      // [20260726_Tier33_NoRequireImports] Tier 3.3 originally targeted ALL
      // require() in the codebase, but source files legitimately use lazy
      // `require("electron")` inside try/catch (see aiHandlers.ts:431,
      // clipboard.ts:108, etc.) — Electron imports at top level break unit
      // tests because electron is absent. Keeping the rule OFF globally;
      // enabling it test-files-only below.
      "@typescript-eslint/no-require-imports": "off",
      // [20260726_Tier33_NoRequireImports] END
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },

  // Node.js globals for main process and test files
  // [20260725_Autopilot_T1.2] main.js/preload.js → main.ts/preload.ts
  // after ADR-010 big-bang backend migration.
  {
    files: [
      "main.ts",
      "preload.ts",
      "tests/**/*.{js,ts}",
      "scripts/**/*.js",
      "src/helpers/**/*.{js,ts}",
      "src/utils/**/*.{js,ts}",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // [20260726_Tier33_TestRequireBan] Tier 3.3: ban require() in UNIT test
  // files only. Source files legitimately use lazy require("electron")
  // inside try/catch (Electron imports at top level break unit tests);
  // e2e tests (still .js, Tier 4.3 deferred) use require for Playwright
  // helpers. This narrow rule prevents future unit tests from re-
  // introducing require() patterns.
  {
    files: ["tests/unit/**/*.{js,ts,tsx}"],
    rules: {
      "@typescript-eslint/no-require-imports": "error",
    },
  },
  // [20260726_Tier33_TestRequireBan] END

  // React-specific rules for frontend files
  {
    files: ["src/**/*.{js,jsx,ts,tsx}", "!src/helpers/**", "!src/utils/**"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react/jsx-uses-vars": "error",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
);
