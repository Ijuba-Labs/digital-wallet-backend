const base = require('./jest.config.cjs');
module.exports = {
  ...base,
  globalSetup: undefined,
  globalTeardown: undefined,
  collectCoverage: false,
  watchman: false,
  testMatch: [
    '<rootDir>/src/services/recipient.service.test.ts',
    '<rootDir>/src/routes/api/v1/recipient.routes.test.ts',
  ],
};
