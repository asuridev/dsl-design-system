#!/usr/bin/env node

'use strict';

const { Command } = require('commander');
const chalk = require('chalk');
const { registerValidate } = require('../src/commands/validate');

const program = new Command();

program
  .name('dsl')
  .description(chalk.blue('DSL validate — coherence checker for arch/ artefacts'))
  .version('0.1.0', '-v, --version', 'Output the current version');

registerValidate(program);

// Show help when no command is provided
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse(process.argv);
