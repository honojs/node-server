module.exports = {
  testMatch: ['**/test/**/*.+(ts)', '**/src/**/(*.)+(test).+(ts)'],
  transform: {
    '^.+\\.(ts)$': 'ts-jest',
  },
  testEnvironment: 'node',
}
