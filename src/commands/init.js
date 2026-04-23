'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');

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

      // 2. Copy skills → .agents/skills/
      const srcSkills = path.join(__dirname, '../skills');
      const destSkills = path.join(cwd, '.agents', 'skills');
      await copyIfConfirmed(srcSkills, destSkills, '.agents/skills');

      // 3. Copy agents → .github/agents/
      const srcAgents = path.join(__dirname, '../agents');
      const destAgents = path.join(cwd, '.github', 'agents');
      await copyIfConfirmed(srcAgents, destAgents, '.github/agents');

      console.log(chalk.green('\nDone! DSL design system initialized.'));
    });
}

module.exports = { registerInit };
