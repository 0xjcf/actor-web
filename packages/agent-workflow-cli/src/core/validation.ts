import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Logger } from '@actor-core/runtime';

const log = Logger.namespace('VALIDATION_SERVICE');

/**
 * Safely escape a file path for shell usage
 */
function escapeShellArg(arg: string): string {
  // Use JSON.stringify to properly escape quotes and special characters
  return JSON.stringify(arg);
}

export interface ValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  filesChecked: number;
}

export interface ValidationConfig {
  skipMarkdown: boolean;
  skipConfigs: boolean;
  skipCSS: boolean;
  skipLockFiles: boolean;
  customIgnores: string[];
}

export class ValidationService {
  private config: ValidationConfig;

  constructor(config: Partial<ValidationConfig> = {}) {
    this.config = {
      skipMarkdown: true,
      skipConfigs: true,
      skipCSS: true,
      skipLockFiles: true,
      customIgnores: [],
      ...config,
    };
  }

  /**
   * Filter files based on validation config (matches biome ignore patterns)
   */
  filterLintableFiles(files: string[]): string[] {
    return files.filter((file) => {
      if (!existsSync(file)) return false;

      // Skip files that match biome ignore patterns
      if (this.config.skipMarkdown && file.match(/\.md$/)) return false;
      if (this.config.skipConfigs && file.match(/docs\//)) return false;
      if (this.config.skipConfigs && file.match(/scripts\/.*\.sh$/)) return false;
      if (this.config.skipConfigs && file === '.gitignore') return false;
      if (
        this.config.skipLockFiles &&
        file.match(/(pnpm-lock\.yaml|yarn\.lock|package-lock\.json)$/)
      )
        return false;
      if (this.config.skipConfigs && file.match(/(package\.json|tsconfig\.json|biome\.json)$/))
        return false;
      if (this.config.skipCSS && file.match(/\.css$/)) return false;

      // Custom ignores
      for (const ignore of this.config.customIgnores) {
        if (file.includes(ignore)) return false;
      }

      return true;
    });
  }

  /**
   * Validate TypeScript files
   */
  async validateTypeScript(files: string[]): Promise<ValidationResult> {
    const tsFiles = files.filter((f) => f.match(/\.(ts|tsx)$/));

    if (tsFiles.length === 0) {
      return {
        success: true,
        errors: [],
        warnings: [],
        filesChecked: 0,
      };
    }

    try {
      // Run TypeScript check on specific files with proper escaping
      const escapedFiles = tsFiles.map((f) => escapeShellArg(f));
      const args = ['tsc', '--noEmit', ...escapedFiles];
      execSync(`pnpm ${args.join(' ')}`, { stdio: 'pipe' });

      return {
        success: true,
        errors: [],
        warnings: [],
        filesChecked: tsFiles.length,
      };
    } catch (error: unknown) {
      const errorOutput = error as { stdout?: Buffer | string; message?: string };
      const output = errorOutput.stdout?.toString() || errorOutput.message || 'Unknown error';

      // Since we're only checking specific files, no need to filter errors
      const errors = output
        .split('\n')
        .filter((line: string) => line.trim() && !line.startsWith('error TS'))
        .slice(0, 10); // Limit to first 10 errors

      return {
        success: false,
        errors: errors,
        warnings: [],
        filesChecked: tsFiles.length,
      };
    }
  }

  /**
   * Validate with Biome (only lintable files)
   */
  async validateBiome(files: string[]): Promise<ValidationResult> {
    const lintableFiles = this.filterLintableFiles(files);

    if (lintableFiles.length === 0) {
      return {
        success: true,
        errors: [],
        warnings: ['No files need biome linting (docs/configs ignored)'],
        filesChecked: 0,
      };
    }

    try {
      // Run biome check on specific files with proper escaping
      const escapedFiles = lintableFiles.map((f) => escapeShellArg(f));
      const args = ['biome', 'check', ...escapedFiles];
      execSync(`pnpm ${args.join(' ')}`, { stdio: 'pipe' });

      return {
        success: true,
        errors: [],
        warnings: [],
        filesChecked: lintableFiles.length,
      };
    } catch (_error: unknown) {
      const escapedFiles = lintableFiles.map((f) => escapeShellArg(f)).join(' ');
      return {
        success: false,
        errors: [`Linting errors found in ${lintableFiles.length} files`],
        warnings: [`Fix with: pnpm biome check ${escapedFiles} --write`],
        filesChecked: lintableFiles.length,
      };
    }
  }

  /**
   * Run full validation on changed files
   */
  async validateFiles(files: string[]): Promise<{
    typescript: ValidationResult;
    biome: ValidationResult;
    overall: boolean;
  }> {
    log.debug(`📁 Validating ${files.length} files changed by your branch...`);

    if (files.length <= 10) {
      log.debug('Changed files:');
      for (const file of files) {
        log.debug(`  - ${file}`);
      }
    } else {
      log.debug('Changed files:');
      for (const file of files.slice(0, 10)) {
        log.debug(`  - ${file}`);
      }
      log.debug(`  ... and ${files.length - 10} more`);
    }

    log.debug('');

    // TypeScript validation
    log.debug('  → TypeScript validation (your files only)...');
    const typescript = await this.validateTypeScript(files);

    if (typescript.success) {
      log.debug(`    ✅ TypeScript OK (${typescript.filesChecked} files)`);
    } else {
      log.debug(`    ❌ TypeScript errors in ${typescript.filesChecked} files:`);
      for (const error of typescript.errors) {
        log.debug(`      ${error}`);
      }
    }

    // Biome validation
    log.debug('  → Linting validation (your files only)...');
    const biome = await this.validateBiome(files);

    if (biome.success) {
      if (biome.warnings.length > 0) {
        log.debug(`    ✅ ${biome.warnings[0]}`);
      } else {
        log.debug(`    ✅ Linting OK (${biome.filesChecked} files)`);
      }
    } else {
      log.debug(`    ❌ ${biome.errors[0]}`);
      if (biome.warnings.length > 0) {
        log.debug(`    💡 ${biome.warnings[0]}`);
      }
    }

    const overall = typescript.success && biome.success;

    if (overall) {
      log.debug(`✅ All validations passed for your ${files.length} changed files!`);
    } else {
      log.debug('❌ Validation failed - please fix issues above');
    }

    return { typescript, biome, overall };
  }
}
