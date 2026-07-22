import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Electron shell is a self-contained package with its own toolchain.
    "desktop/**",
  ]),
  {
    // Rule tuning carried over from the source app. Deliberate, narrow
    // choices — not a blanket disable:
    //  - no-unescaped-entities: purely cosmetic (apostrophes in copy).
    //  - no-img-element: <img> is used intentionally for blob/object URLs and
    //    presigned S3 assets where next/image's optimizer doesn't apply.
    //  - the React Compiler hook lints are surfaced as warnings for the
    //    ported components rather than hard-failing.
    rules: {
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]);

export default eslintConfig;
