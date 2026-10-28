const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/**
 * Sprint 10 AC-8 (D8): the passport module never reaches the network. Its
 * files may not import Supabase, NetInfo or notifications, nor call fetch or
 * XMLHttpRequest. passportIsolation.test.js proves the rule fails.
 */
const passportIsolation = {
  files: ['src/features/passport/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          { name: '@/lib/supabase', message: 'The passport module never reaches the server (D8).' },
          {
            name: '@supabase/supabase-js',
            message: 'The passport module never reaches the server (D8).',
          },
          {
            name: '@react-native-community/netinfo',
            message: 'The passport module never uses the network (D8).',
          },
          {
            name: 'expo-notifications',
            message: 'Notifications live in features/passportAlerts (D8).',
          },
        ],
        patterns: [
          {
            group: ['**/lib/supabase', '**/supabase*'],
            message: 'The passport module never reaches the server (D8).',
          },
        ],
      },
    ],
    'no-restricted-globals': [
      'error',
      { name: 'fetch', message: 'The passport module never uses the network (D8).' },
      { name: 'XMLHttpRequest', message: 'The passport module never uses the network (D8).' },
      { name: 'WebSocket', message: 'The passport module never uses the network (D8).' },
    ],
  },
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', '.expo/*', 'coverage/*'],
  },
  {
    // Config plugins are plain CommonJS; their tests run under Jest.
    files: ['plugins/**/*.test.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
      },
    },
  },
  passportIsolation,
]);
