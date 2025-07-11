import path from 'node:path';
import chalk from 'chalk';
import { createGitActor } from '../actors/git-actor.js';

export async function commitEnhancedCommand(customMessage?: string) {
  console.log(chalk.blue('🎭 Enhanced Commit (Actor-Based)'));
  console.log(chalk.blue('========================================='));

  // Navigate to repository root (two levels up from CLI package)
  const repoRoot = path.resolve(process.cwd(), '../..');
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    if (customMessage) {
      console.log(chalk.blue('📝 Using provided commit message...'));

      // Use custom message with conventional format
      gitActor.send({ type: 'COMMIT_WITH_CONVENTION', customMessage });

      // Wait for completion (simplified polling for CLI)
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const snapshot = gitActor.getSnapshot();
      if (snapshot.context.lastCommitMessage) {
        console.log(chalk.green('✅ Committed with custom message:'));
        console.log(chalk.gray(snapshot.context.lastCommitMessage));
      }
    } else {
      console.log(chalk.blue('🧠 Generating smart commit message...'));

      // Generate commit message first
      gitActor.send({ type: 'GENERATE_COMMIT_MESSAGE' });

      // Wait for generation
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const snapshot = gitActor.getSnapshot();
      if (snapshot.context.lastCommitMessage) {
        console.log(chalk.yellow('📝 Generated commit message:'));
        console.log(chalk.gray(snapshot.context.lastCommitMessage));
        console.log();

        // Ask for confirmation
        const readline = await import('node:readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const useMessage = await new Promise<string>((resolve) => {
          rl.question('Use this commit message? (Y/n): ', (answer) => {
            rl.close();
            resolve(answer);
          });
        });

        if (useMessage.toLowerCase() === 'n') {
          console.log(chalk.yellow('❌ Commit cancelled'));
          return;
        }

        // Commit with generated message
        gitActor.send({ type: 'COMMIT_WITH_CONVENTION' });

        // Wait for completion
        await new Promise((resolve) => setTimeout(resolve, 1000));

        console.log(chalk.green('✅ Committed successfully!'));
      } else {
        console.log(chalk.red('❌ Failed to generate commit message'));
      }
    }
  } catch (error) {
    console.error(chalk.red('❌ Enhanced commit failed:'), error);
    process.exit(1);
  } finally {
    gitActor.stop();
  }
}

export async function generateCommitMessageCommand() {
  console.log(chalk.blue('🧠 Generate Commit Message (Actor-Based)'));
  console.log(chalk.blue('=========================================='));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    console.log(chalk.blue('🔍 Analyzing changes...'));
    gitActor.send({ type: 'GENERATE_COMMIT_MESSAGE' });

    // Wait for generation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const snapshot = gitActor.getSnapshot();
    if (snapshot.context.lastCommitMessage) {
      console.log(chalk.green('✅ Generated commit message:'));
      console.log();
      console.log(snapshot.context.lastCommitMessage);
      console.log();

      if (snapshot.context.commitConfig) {
        console.log(chalk.blue('📊 Analysis:'));
        console.log(chalk.gray(`  Type: ${snapshot.context.commitConfig.type}`));
        console.log(chalk.gray(`  Scope: ${snapshot.context.commitConfig.scope}`));
        console.log(chalk.gray(`  Category: ${snapshot.context.commitConfig.workCategory}`));
      }
    } else {
      console.log(chalk.red('❌ Failed to generate commit message'));
    }
  } catch (error) {
    console.error(chalk.red('❌ Message generation failed:'), error);
  } finally {
    gitActor.stop();
  }
}

export async function validateDatesCommand(files?: string[]) {
  console.log(chalk.blue('📅 Validate Dates (Actor-Based)'));
  console.log(chalk.blue('================================='));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    // Default to common documentation files if none provided
    const filesToCheck = files || ['docs/README.md', 'docs/agent-updates.md', 'src/**/*.ts'];

    console.log(chalk.blue(`🔍 Checking ${filesToCheck.length} files for date issues...`));
    gitActor.send({ type: 'VALIDATE_DATES', filePaths: filesToCheck });

    // Wait for validation
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const snapshot = gitActor.getSnapshot();
    if (snapshot.context.dateIssues) {
      if (snapshot.context.dateIssues.length === 0) {
        console.log(chalk.green('✅ No date issues found!'));
      } else {
        console.log(chalk.yellow(`⚠️  Found ${snapshot.context.dateIssues.length} date issues:`));

        for (const issue of snapshot.context.dateIssues) {
          console.log(chalk.red(`  ${issue.file}:${issue.line}`));
          console.log(chalk.gray(`    Date: ${issue.date} (${issue.issue})`));
          console.log(chalk.gray(`    Context: ${issue.context}`));
        }
      }
    } else {
      console.log(chalk.red('❌ Date validation failed'));
    }
  } catch (error) {
    console.error(chalk.red('❌ Date validation failed:'), error);
  } finally {
    gitActor.stop();
  }
}
