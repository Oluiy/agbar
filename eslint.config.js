// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Lint for defects, not style: formatting is Prettier's job (.prettierrc.json). Type-aware
 * rules are on because the bugs worth catching here are the ones tsc accepts - a promise
 * nobody awaits, an `async` callback handed to something that ignores its result.
 */
export default tseslint.config(
  // scripts/ sits outside tsconfig's rootDir ("src"), so type-aware linting cannot see it.
  { ignores: ["dist/**", "node_modules/**", "test-fixtures/**", "corpus/**", "**/__snapshots__/**", "scripts/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // An unused name is nearly always a leftover. A leading underscore marks the rare
      // deliberate one (an Express error handler's unused `_next`).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // The two rules that justify type-aware linting at all.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // `any` is allowed only where something genuinely cannot be typed; say why in a comment.
      "@typescript-eslint/no-explicit-any": "error",
      // A template's `${...}` inside generated-code strings is not a type error.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true, allowBoolean: true }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Off on purpose: StackAdapter.generate/promptAddons and Checker.run are async by
      // *contract*, so an implementation with nothing to await must still be `async`.
      "@typescript-eslint/require-await": "off",
      // A style nudge (`select<X>()` instead of `select() as X`), not a defect: warn only.
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
    },
  },
  {
    // Templates are strings of *generated* code, where an escaped backtick or `\${` is
    // often required by the surrounding template literal and cannot be judged line by line.
    files: ["src/stacks/**/templates/**", "src/stacks/**/templates.ts", "src/stacks/**/layout.ts"],
    rules: { "no-useless-escape": "off" },
  },
  {
    // Tests read JSON they just generated (JSON.parse -> any), and may lean on non-null
    // assertions and unbound methods more freely.
    files: ["**/*.test.ts", "src/testing/**"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // Several tests strip ANSI escape codes; the control character is the whole point.
      "no-control-regex": "off",
    },
  },
);
