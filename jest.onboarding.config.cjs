const base = require('./jest.config.cjs');
module.exports = {
  ...base,
  globalSetup: undefined,
  globalTeardown: undefined,
  collectCoverage: false,
  watchman: false,
  testMatch: [
    '<rootDir>/src/config/onboarding.test.ts',
    '<rootDir>/src/services/onboarding.service.test.ts',
    '<rootDir>/src/routes/api/v1/onboarding.routes.test.ts',
  ],
};
