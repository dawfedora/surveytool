import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "sw.js",
      "shell-config.js",
      "version.json",
      "surveys/**"
    ]
  },

  js.configs.recommended,

  {
    files: ["app.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        CACHE_NAME: "readonly",
        APP_SHELL: "readonly"
      }
    }
  },

  {
    files: ["sw.js.in"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.serviceworker,
        CACHE_NAME: "readonly",
        APP_SHELL: "readonly"
      }
    }
  }
];
