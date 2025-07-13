module.exports = {
  testMatch: ['**/test/**/*.+(ts)', '**/src/**/(*.)+(test).+(ts)'],
  modulePathIgnorePatterns: ["test/setup.ts", "test/app.ts"],
  transform: {
    '^.+\\.(ts)$': 'ts-jest',
  },
  testEnvironment: 'node',
  setupFiles: ["<rootDir>/test/setup.ts"],
}
