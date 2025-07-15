export default function (_wallaby) {
  return {
    autoDetect: true,

    files: [
      'src/**/*.ts',
      '!src/**/*.{test,spec}.ts',
      'tests/setup.ts',
      'vitest.config.ts',
      'tsconfig.json',
      'package.json',
      'packages/**/*.ts',
      '!packages/**/*.{test,spec}.ts',
      // Include package.json files from packages for proper module resolution
      'packages/*/package.json',
      'packages/*/tsconfig.json',
    ],

    tests: [
      'src/**/*.{test,spec}.ts',
      'packages/**/*.{test,spec}.ts', // Add tests from packages
    ],

    env: {
      type: 'node',
      runner: 'node',
    },

    testFramework: 'vitest',

    debug: true,

    setup: (wallaby) => {
      const path = require('node:path');
      process.env.NODE_PATH =
        path.join(wallaby.localProjectDir, 'node_modules') +
        path.delimiter +
        (process.env.NODE_PATH || '');

      // Force cleanup between tests
      process.env.NODE_ENV = 'test';
    },

    workers: {
      initial: 1,
      regular: 1,
      recycle: true, // Enable worker recycling to prevent memory leaks
    },

    reportConsoleErrorAsError: true,

    // Increase console message limits for verbose tests
    maxConsoleMessagesPerTest: 500,

    // Add timeout settings
    slowTestThreshold: 2000, // Reduced from 3000ms

    // Add test timeout
    testTimeout: 10000, // 10 second hard limit

    delays: {
      run: 0,
      edit: 100,
      update: 0,
    },

    // Force cleanup
    teardown: () => {
      // Additional cleanup if needed
      if (global.gc) {
        global.gc();
      }
    },
  };
}
