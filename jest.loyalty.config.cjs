const base = require('./jest.config.cjs');
module.exports = {
  ...base, globalSetup: '<rootDir>/tests/loyalty.setup.ts',
  globalTeardown: '<rootDir>/tests/loyalty.teardown.ts', collectCoverage: false, watchman: false,
  testMatch: ['<rootDir>/src/routes/api/v1/loyalty.routes.test.ts', '<rootDir>/src/services/loyalty-wallet.integration.test.ts'],
};
