#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(repoRoot, 'architecture.boundaries.json');
const ignoredDirectories = new Set(['.git', 'coverage', 'dist', 'node_modules']);

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function relativePath(filePath) {
  return toPosixPath(path.relative(repoRoot, filePath));
}

function isSourceFile(filePath) {
  const relative = relativePath(filePath);

  return (
    /\.(?:cjs|js|mjs|ts|tsx)$/.test(filePath) &&
    !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(filePath) &&
    !relative.includes('/dist/') &&
    !relative.includes('/node_modules/')
  );
}

async function collectSourceFiles(configuredPath) {
  const absolutePath = path.join(repoRoot, configuredPath);
  const stat = await fs.stat(absolutePath).catch(() => undefined);

  if (!stat) {
    return { files: [], missingPath: configuredPath };
  }

  if (stat.isFile()) {
    return { files: isSourceFile(absolutePath) ? [absolutePath] : [] };
  }

  if (!stat.isDirectory()) {
    return { files: [] };
  }

  const files = [];
  const entries = await fs.readdir(absolutePath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const childPath = path.join(absolutePath, entry.name);
    if (entry.isDirectory()) {
      const childResult = await collectSourceFiles(relativePath(childPath));
      files.push(...childResult.files);
      continue;
    }

    if (entry.isFile() && isSourceFile(childPath)) {
      files.push(childPath);
    }
  }

  return { files };
}

function maskSource(source, options = {}) {
  const maskStrings = options.maskStrings ?? true;
  let output = '';
  let state = 'code';
  let quote = '';
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (state === 'lineComment') {
      if (current === '\n') {
        output += '\n';
        state = 'code';
      } else {
        output += ' ';
      }
      continue;
    }

    if (state === 'blockComment') {
      if (current === '*' && next === '/') {
        output += '  ';
        index += 1;
        state = 'code';
      } else {
        output += current === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (state === 'string') {
      output += maskStrings && current !== '\n' ? ' ' : current;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (current === '\\') {
        escaped = true;
        continue;
      }

      if (current === quote) {
        state = 'code';
        quote = '';
      }
      continue;
    }

    if (current === '/' && next === '/') {
      output += '  ';
      index += 1;
      state = 'lineComment';
      continue;
    }

    if (current === '/' && next === '*') {
      output += '  ';
      index += 1;
      state = 'blockComment';
      continue;
    }

    if (current === "'" || current === '"' || current === '`') {
      output += maskStrings ? ' ' : current;
      state = 'string';
      quote = current;
      escaped = false;
      continue;
    }

    output += current;
  }

  return output;
}

function lineNumber(source, index) {
  let line = 1;

  for (let offset = 0; offset < index; offset += 1) {
    if (source[offset] === '\n') {
      line += 1;
    }
  }

  return line;
}

function extractImports(source) {
  const imports = [];
  const importSource = maskSource(source, { maskStrings: false });
  const importPatterns = [
    /\bimport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[^'";]+?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const importPattern of importPatterns) {
    let match = importPattern.exec(importSource);

    while (match) {
      imports.push({
        specifier: match[1],
        line: lineNumber(importSource, match.index),
      });
      match = importPattern.exec(importSource);
    }
  }

  return imports;
}

function findForbiddenImport(specifier, rules) {
  const forbiddenImports = rules.forbiddenImports ?? [];
  const forbiddenImportPrefixes = rules.forbiddenImportPrefixes ?? [];
  const normalizedSpecifier = specifier.startsWith('node:') ? specifier.slice(5) : specifier;

  if (forbiddenImports.includes(specifier) || forbiddenImports.includes(normalizedSpecifier)) {
    return specifier;
  }

  return forbiddenImportPrefixes.find((prefix) => specifier.startsWith(prefix));
}

function validateRuntimePattern(runtimePattern) {
  if (typeof runtimePattern?.name !== 'string' || runtimePattern.name.trim().length === 0) {
    return { error: 'Forbidden runtime pattern is missing a non-empty string name.' };
  }

  if (typeof runtimePattern?.pattern !== 'string' || runtimePattern.pattern.length === 0) {
    return {
      error: `Forbidden runtime pattern "${runtimePattern.name}" is missing a non-empty string pattern.`,
    };
  }

  try {
    return { expression: new RegExp(runtimePattern.pattern, 'g') };
  } catch (error) {
    return {
      error: `Forbidden runtime pattern "${runtimePattern.name}" is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

async function main() {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const deterministicLayer = config.layers?.deterministicDecision;
  const violations = [];

  if (!deterministicLayer) {
    violations.push({
      file: relativePath(configPath),
      line: 1,
      message: 'Missing layers.deterministicDecision in architecture boundary map.',
    });
  }

  const deterministicFiles = [];

  for (const configuredPath of deterministicLayer?.paths ?? []) {
    const result = await collectSourceFiles(configuredPath);

    if (result.missingPath) {
      violations.push({
        file: relativePath(configPath),
        line: 1,
        message: `Configured deterministic path does not exist: ${result.missingPath}`,
      });
      continue;
    }

    deterministicFiles.push(...result.files);
  }

  const uniqueFiles = [...new Set(deterministicFiles)].sort();
  const rules = deterministicLayer?.rules ?? {};

  for (const filePath of uniqueFiles) {
    const source = await fs.readFile(filePath, 'utf8');
    const file = relativePath(filePath);

    for (const importedModule of extractImports(source)) {
      const matchedRule = findForbiddenImport(importedModule.specifier, rules);

      if (matchedRule) {
        violations.push({
          file,
          line: importedModule.line,
          message: `Forbidden deterministic import "${importedModule.specifier}" matched "${matchedRule}".`,
        });
      }
    }

    const executableSource = maskSource(source);

    for (const runtimePattern of rules.forbiddenRuntimePatterns ?? []) {
      const validatedPattern = validateRuntimePattern(runtimePattern);
      if ('error' in validatedPattern) {
        violations.push({
          file: relativePath(configPath),
          line: 1,
          message: validatedPattern.error,
        });
        continue;
      }

      let match = validatedPattern.expression.exec(executableSource);

      while (match) {
        violations.push({
          file,
          line: lineNumber(executableSource, match.index),
          message: `Forbidden deterministic runtime access: ${runtimePattern.name}.`,
        });
        match = validatedPattern.expression.exec(executableSource);
      }
    }
  }

  if (uniqueFiles.length === 0) {
    violations.push({
      file: relativePath(configPath),
      line: 1,
      message: 'No deterministic decision source files were selected by the boundary map.',
    });
  }

  if (violations.length > 0) {
    console.error('Architecture boundary check failed:');

    for (const violation of violations) {
      console.error(`- ${violation.file}:${violation.line} ${violation.message}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log(
    `Architecture boundary check passed. Checked ${uniqueFiles.length} deterministic file(s).`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
