// Trip dates are local calendar days (sprint 2 design 4.1): tests run in
// Israel's time zone everywhere, CI (UTC) included, so the conversions are
// checked where midnight is not midnight UTC.
process.env.TZ = 'Asia/Jerusalem';

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src', '<rootDir>/plugins'],
  setupFiles: [
    '<rootDir>/jest.setup.ts',
    // The package's exports don't expose its Jest setup, so it's referenced by path (npm workspaces hoist it to the root).
    '<rootDir>/../../node_modules/@react-native-google-signin/google-signin/jest/build/jest/setup.js',
  ],
  // Bundled data assets (the city list) are files for expo-asset, not modules.
  moduleNameMapper: { '[.]dat$': '<rootDir>/jest.assetMock.js' },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/app/**'],
};
