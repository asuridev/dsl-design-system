#!/usr/bin/env node

'use strict';

const { Command } = require('commander');
const chalk = require('chalk');
const packageJson = require('../package.json');
const { registerInit } = require('../src/commands/init');

const program = new Command();

program
  .name('dsl')
  .description(chalk.blue('CLI for DSL Design System'))
  .version(packageJson.version, '-v, --version', 'Output the current version');

registerInit(program);

// Show help when no command is provided
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse(process.argv);
