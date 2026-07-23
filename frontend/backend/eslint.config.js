const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["node_modules/**", "uploads/**", ".model-cache/**"] },
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: js.configs.recommended.rules,
  },
];
