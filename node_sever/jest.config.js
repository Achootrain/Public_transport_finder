module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.js'],
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/app.js',
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov'],
};
