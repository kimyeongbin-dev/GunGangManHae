// eslint.config.mjs — Next.js 권장 규칙(core-web-vitals + typescript) 사용.
// React Compiler 규칙(react-hooks/*)이 포함되어, 이펙트 내 동기 setState 등을 잡아낸다.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
