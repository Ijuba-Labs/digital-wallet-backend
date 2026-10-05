const base = require('./jest.config.cjs');
module.exports = {
  ...base, globalSetup: undefined, globalTeardown: undefined,
  collectCoverage: false, watchman: false,
  testMatch: ['<rootDir>/src/services/loyalty-validation.test.ts', '<rootDir>/src/routes/api/v1/loyalty-contract.test.ts'],
};
