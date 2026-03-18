module.exports = {
  testEnvironment: 'node',
  setupFiles: ['./__tests__/setup.js'],
  testPathIgnorePatterns: ['__tests__/setup.js', '__tests__/helpers.js'],
  testTimeout: 15000,
  verbose: true
};
