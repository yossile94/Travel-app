/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src', '<rootDir>/plugins'],
  setupFiles: [
    '<rootDir>/jest.setup.ts',
    // The package's exports don't expose its Jest setup, so it's referenced by path (npm workspaces hoist it to the root).
    '<rootDir>/../../node_modules/@react-native-google-signin/google-signin/jest/build/jest/setup.js',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/app/**'],
};
