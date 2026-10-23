const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', '.expo/*', 'coverage/*'],
  },
  {
    // Config plugins are plain CommonJS; their tests run under Jest.
    files: ['plugins/**/*.test.js'],
    languageOptions: {
      globals: { describe: 'readonly', it: 'readonly', expect: 'readonly' },
    },
  },
]);
