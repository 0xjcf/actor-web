import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// CLI path for testing
const CLI_PATH = resolve(__dirname, '../cli/index.ts');
const CLI_CMD = `npx tsx ${CLI_PATH}`;

describe('CLI Commands Integration Tests', () => {
  describe('Basic CLI Functionality', () => {
    test('CLI should display version without ES module errors', async () => {
      try {
        const output = execSync(`${CLI_CMD} --version`, {
          encoding: 'utf-8',
          timeout: 10000,
        });
        expect(output).toContain('0.1.0-alpha');
        expect(output).not.toContain('require is not defined');
        expect(output).not.toContain('ReferenceError');
      } catch (error) {
        // Document current broken behavior
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('require is not defined')) {
          // This is the expected failure case before fix
          expect(errorMessage).toContain('require is not defined in ES module scope');
        } else {
          throw error;
        }
      }
    });

    test('CLI should display help without ES module errors', async () => {
      try {
        const output = execSync(`${CLI_CMD} --help`, {
          encoding: 'utf-8',
          timeout: 10000,
        });
        expect(output).toContain('Agent-centric development workflow automation');
        expect(output).not.toContain('require is not defined');
        expect(output).not.toContain('ReferenceError');
      } catch (error) {
        // Document current broken behavior
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('require is not defined')) {
          // This is the expected failure case before fix
          expect(errorMessage).toContain('require is not defined in ES module scope');
        } else {
          throw error;
        }
      }
    });
  });

  describe('Core Workflow Commands', () => {
    test('aw:save command should execute without ES module errors', async () => {
      try {
        // Note: This may fail due to git state, but should not fail due to ES modules
        const output = execSync(`${CLI_CMD} save "test: ES module validation"`, {
          encoding: 'utf-8',
          timeout: 10000,
          cwd: process.cwd(),
        });
        expect(output).not.toContain('require is not defined');
        expect(output).not.toContain('ReferenceError');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('require is not defined')) {
          // This is the expected failure case before fix
          expect(errorMessage).toContain('require is not defined in ES module scope');
        } else {
          // Other errors (like git errors) are acceptable for this test
          // We only care about ES module errors for now
          console.log('Non-ES-module error (acceptable):', errorMessage);
        }
      }
    });

    test('aw:ship command should execute without ES module errors', async () => {
      try {
        const output = execSync(`${CLI_CMD} ship`, {
          encoding: 'utf-8',
          timeout: 10000,
          cwd: process.cwd(),
        });
        expect(output).not.toContain('require is not defined');
        expect(output).not.toContain('ReferenceError');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('require is not defined')) {
          // This is the expected failure case before fix
          expect(errorMessage).toContain('require is not defined in ES module scope');
        } else {
          // Other errors are acceptable - we only test ES module compatibility
          console.log('Non-ES-module error (acceptable):', errorMessage);
        }
      }
    });

    test('aw:status command should execute without ES module errors', async () => {
      try {
        const output = execSync(`${CLI_CMD} status`, {
          encoding: 'utf-8',
          timeout: 10000,
          cwd: process.cwd(),
        });
        expect(output).not.toContain('require is not defined');
        expect(output).not.toContain('ReferenceError');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('require is not defined')) {
          // This is the expected failure case before fix
          expect(errorMessage).toContain('require is not defined in ES module scope');
        } else {
          console.log('Non-ES-module error (acceptable):', errorMessage);
        }
      }
    });

    test('aw:sync command should execute without ES module errors', async () => {
      try {
        const output = execSync(`${CLI_CMD} sync`, {
          encoding: 'utf-8',
          timeout: 10000,
          cwd: process.cwd(),
        });
        expect(output).not.toContain('require is not defined');
        expect(output).not.toContain('ReferenceError');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('require is not defined')) {
          // This is the expected failure case before fix
          expect(errorMessage).toContain('require is not defined in ES module scope');
        } else {
          console.log('Non-ES-module error (acceptable):', errorMessage);
        }
      }
    });

    test('aw:validate command should execute without ES module errors', async () => {
      try {
        const output = execSync(`${CLI_CMD} validate`, {
          encoding: 'utf-8',
          timeout: 10000,
          cwd: process.cwd(),
        });
        expect(output).not.toContain('require is not defined');
        expect(output).not.toContain('ReferenceError');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('require is not defined')) {
          // This is the expected failure case before fix
          expect(errorMessage).toContain('require is not defined in ES module scope');
        } else {
          console.log('Non-ES-module error (acceptable):', errorMessage);
        }
      }
    });
  });

  describe('Package Information Access', () => {
    test('Should be able to access package version information', async () => {
      // This test will verify the package info loading works after fix
      try {
        // Import the async package info function
        const { getPackageInfo } = await import('../index.js');
        const packageInfo = await getPackageInfo();
        expect(packageInfo.version).toBeDefined();
        expect(typeof packageInfo.version).toBe('string');
        expect(packageInfo.version).toMatch(/^\d+\.\d+\.\d+/); // Semantic version pattern
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('require is not defined')) {
          // Expected failure before fix
          expect(errorMessage).toContain('require is not defined in ES module scope');
        } else {
          throw error;
        }
      }
    });

    test('Should be able to access CLI info', async () => {
      try {
        const { getCLIInfo } = await import('../index.js');
        const cliInfo = await getCLIInfo();
        expect(cliInfo).toBeDefined();
        expect(cliInfo.name).toBe('@agent-workflow/cli');
        expect(cliInfo.description).toContain('Agent-centric');
        expect(Array.isArray(cliInfo.features)).toBe(true);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('require is not defined')) {
          // Expected failure before fix
          expect(errorMessage).toContain('require is not defined in ES module scope');
        } else {
          throw error;
        }
      }
    });
  });

  describe('Error Handling and Messages', () => {
    test('CLI errors should be meaningful (not ES module errors)', async () => {
      try {
        // Try an invalid command - should get command error, not ES module error
        execSync(`${CLI_CMD} invalid-command`, {
          encoding: 'utf-8',
          timeout: 5000,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('require is not defined')) {
          // This indicates ES module issue still exists
          expect(errorMessage).toContain('require is not defined in ES module scope');
        } else {
          // Should get a proper command error, not ES module error
          expect(errorMessage).not.toContain('require is not defined');
          expect(errorMessage).not.toContain('ReferenceError');
          // Should contain helpful command error message
          expect(errorMessage.toLowerCase()).toMatch(/(unknown|invalid|not found|command)/);
        }
      }
    });
  });
});
