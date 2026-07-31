// Tests cover the PURE policy modules only (schema.js — validation and the
// day-clock payroll math). No jest-expo: react-native 0.86 pins an older
// @react-native/jest-preset than jest-expo 57 wants, and pure modules don't
// need the native preset anyway. Babel config lives INLINE here on purpose —
// a babel.config.js at the root would override Metro's implicit
// babel-preset-expo and break the app bundle.
module.exports = {
  testMatch: ["**/__tests__/**/*.test.js"],
  transform: {
    "^.+\\.js$": ["babel-jest", { presets: [["@babel/preset-env", { targets: { node: "current" } }]] }],
  },
  // Store tests exercise src/store.js, whose import chain touches native
  // modules. Map them to stubs — the logic under test is pure JS.
  moduleNameMapper: {
    "^react-native$": "<rootDir>/__tests__/mocks/react-native.js",
    "^@react-native-async-storage/async-storage$":
      "@react-native-async-storage/async-storage/jest/async-storage-mock",
  },
};
