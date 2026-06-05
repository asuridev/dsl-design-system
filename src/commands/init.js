'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');

// Source files (relative to this repo) that are assembled into tools/dsl-validate/
const DSL_VALIDATE_SOURCES = [
  { src: ['commands', 'validate.js'],             dest: ['src', 'commands', 'validate.js'] },
  { src: ['utils', 'arch-readers.js'],            dest: ['src', 'utils', 'arch-readers.js'] },
  { src: ['utils', 'canonical-types.js'],         dest: ['src', 'utils', 'canonical-types.js'] },
  { src: ['utils', 'bc-yaml-validator.js'],       dest: ['src', 'utils', 'bc-yaml-validator.js'] },
  { src: ['utils', 'integration-validator.js'],   dest: ['src', 'utils', 'integration-validator.js'] },
  { src: ['utils', 'naming.js'],                  dest: ['src', 'utils', 'naming.js'] },
  { src: ['utils', 'openapi-contract.js'],        dest: ['src', 'utils', 'openapi-contract.js'] },
  { src: ['utils', 'openapi-usecase-validator.js'], dest: ['src', 'utils', 'openapi-usecase-validator.js'] },
];

async function copyIfConfirmed(srcDir, destDir, label) {
  const exists = await fs.pathExists(destDir);

  if (exists) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `${chalk.yellow(label)} already exists. Overwrite?`,
        default: false,
      },
    ]);

    if (!overwrite) {
      console.log(chalk.yellow(`  SKIP  ${label}`));
      return;
    }
  }

  const spinner = ora(`Copying ${label}...`).start();
  await fs.copy(srcDir, destDir, { overwrite: true });
  spinner.succeed(chalk.green(`  OK    ${label}`));
}

/**
 * Assembles tools/dsl-validate/ in the user's workspace by combining:
 *   - src/templates/dsl-validate/  → bin/ + package.json (entry point)
 *   - src/commands/validate.js     → src/commands/validate.js
 *   - src/utils/*.js               → src/utils/*.js
 *
 * The validate logic is not duplicated: it lives in src/ and is copied at init time.
 * tools/package.json (workspace root) is created only when it does not exist.
 */
async function scaffoldDslValidate(cwd) {
  const destRoot = path.join(cwd, 'tools', 'dsl-validate');
  const exists = await fs.pathExists(destRoot);

  if (exists) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `${chalk.yellow('tools/dsl-validate')} already exists. Overwrite?`,
        default: false,
      },
    ]);
    if (!overwrite) {
      console.log(chalk.yellow('  SKIP  tools/dsl-validate'));
      return;
    }
  }

  const spinner = ora('Scaffolding tools/dsl-validate/...').start();

  // 1. Copy template (bin/dsl.js + package.json)
  const templateDir = path.join(__dirname, '../templates/dsl-validate');
  await fs.copy(templateDir, destRoot, { overwrite: true });

  // 2. Copy validate logic files from src/
  const srcRoot = path.join(__dirname, '..');
  for (const { src, dest } of DSL_VALIDATE_SOURCES) {
    const srcFile  = path.join(srcRoot, ...src);
    const destFile = path.join(destRoot, ...dest);
    await fs.ensureDir(path.dirname(destFile));
    await fs.copy(srcFile, destFile, { overwrite: true });
  }

  spinner.succeed(chalk.green('  OK    tools/dsl-validate/'));

  // 3. Create tools/package.json only if it does not exist (never overwrite)
  const toolsPkgPath = path.join(cwd, 'tools', 'package.json');
  if (!(await fs.pathExists(toolsPkgPath))) {
    await fs.writeJson(
      toolsPkgPath,
      { private: true, workspaces: ['dsl-validate'] },
      { spaces: 2 },
    );
    console.log(chalk.green('  OK    tools/package.json'));
  }
}

function registerInit(program) {
  program
    .command('init')
    .description('Initialize DSL design system structure in the current project')
    .action(async () => {
      const cwd = process.cwd();

      // 1. Create arch/ directory
      const archDir = path.join(cwd, 'arch');
      const archSpinner = ora('Creating arch/...').start();
      await fs.ensureDir(archDir);
      archSpinner.succeed(chalk.green('  OK    arch/'));

      // 2. Copy skills → .agents/skills/ (VSCode / GitHub Copilot)
      const srcSkills = path.join(__dirname, '../skills');
      const destSkills = path.join(cwd, '.agents', 'skills');
      await copyIfConfirmed(srcSkills, destSkills, '.agents/skills');

      // 2b. Copy skills → .claude/skills/ (Claude Code CLI)
      const destSkillsClaude = path.join(cwd, '.claude', 'skills');
      await copyIfConfirmed(srcSkills, destSkillsClaude, '.claude/skills');

      // 3. Copy agents → .github/agents/ (GitHub Copilot)
      const srcAgents = path.join(__dirname, '../agents');
      const destAgents = path.join(cwd, '.github', 'agents');
      await copyIfConfirmed(srcAgents, destAgents, '.github/agents');

      // 3b. Copy agents → .claude/agents/ (Claude Code CLI)
      const destAgentsClaude = path.join(cwd, '.claude', 'agents');
      await copyIfConfirmed(srcAgents, destAgentsClaude, '.claude/agents');

      // 4. Scaffold tools/dsl-validate/
      await scaffoldDslValidate(cwd);

      console.log(chalk.green('\nDone! DSL design system initialized.'));
    });
}

module.exports = { registerInit };
