// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "server/drizzle/**", "web/src/ui/**", "**/*.config.*", "server/build.mjs", ".claude/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off", // TypeScript handles this
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // shared/ is pure: no I/O, no clock, no env (CLAUDE.md invariant 4)
    files: ["shared/src/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", "process", "fetch", "window", "document"],
      "no-restricted-syntax": [
        "error",
        { selector: "MemberExpression[object.name='Date'][property.name='now']", message: "Inject 'today' instead of reading the clock in shared/." },
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "Inject 'today' instead of reading the clock in shared/." },
      ],
    },
  },
);
