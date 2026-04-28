import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unicorn from "eslint-plugin-unicorn";
import vitest from "@vitest/eslint-plugin";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "**/dist/**",
      "dist/**",
      "packages/core/dist/**",
      "apps/web/dist/**",
      "apps/landing/dist/**",
      "apps/desktop/dist/**",
      "apps/desktop/src-tauri/target/**",
      "packages/app/public/docs/**",
      "test/papers/**",
      "test-results/**",
      "apps/*/test-results/**",
      "apps/web/profiling/traces/**",
      "examples/**",
      "prototypes/**",
      "tikz-dev/**",
      "pgf-docs/**",
      "pgf-src/**",
      "tauri-docs/**",
      "vitest.config.ts"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      unicorn
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/await-thenable": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/no-duplicate-type-constituents": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "@typescript-eslint/no-redundant-type-constituents": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": "warn",
      "@typescript-eslint/no-unsafe-unary-minus": "warn",
      "@typescript-eslint/unbound-method": "warn",
      "no-constant-condition": "warn",
      "no-empty": ["warn", { allowEmptyCatch: false }],
      "no-fallthrough": "error",
      "no-useless-assignment": "warn",
      "no-useless-escape": "warn",
      "prefer-const": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": "off"
    }
  },
  {
    files: ["test/**", "apps/web/e2e/**", "apps/web/profiling/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off"
    }
  },
  {
    files: ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-unary-minus": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/no-duplicate-type-constituents": "error",
      "@typescript-eslint/no-redundant-type-constituents": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/unbound-method": "error",
      "unicorn/catch-error-name": "error",
      "unicorn/no-new-array": "error",
      "unicorn/no-useless-fallback-in-spread": "error",
      "unicorn/no-useless-promise-resolve-reject": "error",
      "unicorn/no-useless-spread": "error",
      "unicorn/no-useless-undefined": "error",
      "unicorn/prefer-dom-node-remove": "error",
      "unicorn/prefer-includes": "error",
      "unicorn/prefer-number-properties": "error"
    }
  },
  {
    files: ["test/**/*.{ts,tsx}"],
    plugins: {
      vitest
    },
    rules: {
      "vitest/no-focused-tests": "error",
      "vitest/no-disabled-tests": "warn",
      "vitest/no-identical-title": "warn",
      "vitest/no-commented-out-tests": "warn",
      "vitest/no-conditional-tests": "warn"
    }
  },
  {
    files: [
      "packages/app/src/ui/CanvasPanel.tsx",
      "packages/app/src/ui/canvas-panel/**/*.{ts,tsx}",
      "packages/app/src/ui/inspector-panel/**/*.{ts,tsx}"
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-unsafe-unary-minus": "error",
      "no-useless-assignment": "error",
      "react-hooks/exhaustive-deps": "error"
    }
  }
);
