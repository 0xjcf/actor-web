import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

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
      // Run TypeScript check
      execSync('pnpm tsc --noEmit', { stdio: 'pipe' });

      return {
        success: true,
        errors: [],
        warnings: [],
        filesChecked: tsFiles.length,
      };
    } catch (error: any) {
      const output = error.stdout?.toString() || error.message;

      // Filter errors to only include files we're validating
      const relevantErrors = output
        .split('\n')
        .filter((line: string) => tsFiles.some((file) => line.startsWith(file + ':')))
        .slice(0, 10); // Limit to first 10 errors

      return {
        success: false,
        errors: relevantErrors,
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
      // Run biome check on specific files
      const fileList = lintableFiles.join(' ');
      execSync(`pnpm biome check ${fileList}`, { stdio: 'pipe' });

      return {
        success: true,
        errors: [],
        warnings: [],
        filesChecked: lintableFiles.length,
      };
    } catch (error: any) {
      return {
        success: false,
        errors: [`Linting errors found in ${lintableFiles.length} files`],
        warnings: [`Fix with: pnpm biome check ${lintableFiles.join(' ')} --write`],
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
    console.log(`📁 Validating ${files.length} files changed by your branch...`);

    if (files.length <= 10) {
      console.log('Changed files:');
      files.forEach((file) => console.log(`  - ${file}`));
    } else {
      console.log('Changed files:');
      files.slice(0, 10).forEach((file) => console.log(`  - ${file}`));
      console.log(`  ... and ${files.length - 10} more`);
    }

    console.log('');

    // TypeScript validation
    console.log('  → TypeScript validation (your files only)...');
    const typescript = await this.validateTypeScript(files);

    if (typescript.success) {
      console.log(`    ✅ TypeScript OK (${typescript.filesChecked} files)`);
    } else {
      console.log(`    ❌ TypeScript errors in ${typescript.filesChecked} files:`);
      typescript.errors.forEach((error) => console.log(`      ${error}`));
    }

    // Biome validation
    console.log('  → Linting validation (your files only)...');
    const biome = await this.validateBiome(files);

    if (biome.success) {
      if (biome.warnings.length > 0) {
        console.log(`    ✅ ${biome.warnings[0]}`);
      } else {
        console.log(`    ✅ Linting OK (${biome.filesChecked} files)`);
      }
    } else {
      console.log(`    ❌ ${biome.errors[0]}`);
      if (biome.warnings.length > 0) {
        console.log(`    💡 ${biome.warnings[0]}`);
      }
    }

    const overall = typescript.success && biome.success;

    if (overall) {
      console.log(`✅ All validations passed for your ${files.length} changed files!`);
    } else {
      console.log('❌ Validation failed - please fix issues above');
    }

    return { typescript, biome, overall };
  }
}
