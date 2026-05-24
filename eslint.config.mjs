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
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },

  // Node.js globals for main process and test files
  {
    files: [
      "main.js",
      "preload.js",
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
