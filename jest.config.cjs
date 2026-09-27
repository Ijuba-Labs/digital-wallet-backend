/** @type {import('jest').Config} */

process.env = Object.assign(process.env, {
  DISABLE_LOGGER: "true",
});

module.exports = {
  verbose: true,
  testEnvironment: "node",

  transform: {
    "^.+\\.(t|j)sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: {
            syntax: "typescript",
            dynamicImport: true,
          },
          target: "es2022",
        },
        module: {
          type: "es6",
        },
      },
    ],
  },

  extensionsToTreatAsEsm: [".ts"],

  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },

  testMatch: [
    "**/*.test.ts",
    "**/*.spec.ts",
  ],

  collectCoverage: true,

  coverageReporters: [
    "text",
    "lcov",
    "json-summary"
  ],

  globalSetup: "<rootDir>/tests/setup.ts",
  globalTeardown: "<rootDir>/tests/teardown.ts",

  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",

    "!src/**/*.d.ts",
    "!src/**/index.ts"
  ],

  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/tests/"
  ]
};
