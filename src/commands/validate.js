'use strict';

const path = require('path');
const chalk = require('chalk');
const fs = require('fs-extra');
const { readSystemYaml, readBcYaml, readAsyncApiYaml, discoverBcNames } = require('../utils/arch-readers');
const { validateIntegrationCoherence, reportDiagnostics } = require('../utils/integration-validator');

/**
 * Builds a simple logger object compatible with reportDiagnostics.
 */
function buildLogger() {
  return {
    error: (msg) => console.error(chalk.red('  ✖ ' + msg)),
    warn:  (msg) => console.warn(chalk.yellow('  ⚠ ' + msg)),
    info:  (msg) => console.log(chalk.cyan('  ' + msg)),
  };
}

/**
 * Runs integration coherence validation on arch/ YAML artefacts.
 *
 * @param {object} options
 * @param {string|undefined} options.bc     — Limit to a single BC name
 * @param {boolean} options.strict          — Exit 1 when errors are found (default true)
 */
async function runValidate(options = {}) {
  const cwd = process.cwd();
  const archDir = path.join(cwd, 'arch');
  const logger = buildLogger();

  // Verify arch/ directory exists
  if (!fs.pathExistsSync(archDir)) {
    logger.error('arch/ directory not found. Run this command from the project root.');
    process.exit(1);
  }

  // Read system.yaml
  let system;
  try {
    system = readSystemYaml(cwd);
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }

  // Discover BC names
  let allBcNames = discoverBcNames(cwd);
  if (allBcNames.length === 0) {
    console.log(chalk.yellow('No bounded contexts found in arch/. Nothing to validate.'));
    return;
  }

  // Filter by --bc if provided
  const filterBc = options.bc ? options.bc.trim() : null;
  if (filterBc) {
    if (!allBcNames.includes(filterBc)) {
      logger.error(`BC "${filterBc}" not found in arch/. Available: ${allBcNames.join(', ')}`);
      process.exit(1);
    }
    allBcNames = [filterBc];
  }

  // Load BC yamls
  const bcYamls = [];
  for (const bcName of allBcNames) {
    try {
      bcYamls.push(readBcYaml(bcName, cwd));
    } catch (err) {
      logger.warn(`Skipping ${bcName}: ${err.message}`);
    }
  }

  if (bcYamls.length === 0) {
    console.log(chalk.yellow('No BC yamls could be loaded. Nothing to validate.'));
    return;
  }

  // Load AsyncAPI docs (optional per BC)
  const asyncApiByBc = new Map();
  for (const bcYaml of bcYamls) {
    const doc = readAsyncApiYaml(bcYaml.bc, cwd);
    if (doc) asyncApiByBc.set(bcYaml.bc, doc);
  }

  // Run validation
  const scope = filterBc ? `BC "${filterBc}"` : `${bcYamls.length} bounded context(s)`;
  console.log(chalk.blue(`\nValidating ${scope}...\n`));

  const diagnostics = validateIntegrationCoherence(system, bcYamls, archDir, asyncApiByBc);
  const { hasErrors, errors, warnings } = reportDiagnostics(diagnostics, logger);

  // Summary
  console.log('');
  if (!hasErrors && warnings === 0) {
    console.log(chalk.green('✔ All validations passed.'));
  } else if (!hasErrors) {
    console.log(chalk.yellow(`⚠ ${warnings} warning(s) found, no errors.`));
  } else {
    console.log(chalk.red(`✖ ${errors} error(s) and ${warnings} warning(s) found.`));
  }

  const strict = options.strict !== false;
  if (hasErrors && strict) {
    process.exit(1);
  }
}

/**
 * Registers the `validate` command on a Commander program.
 *
 * @param {import('commander').Command} program
 */
function registerValidate(program) {
  program
    .command('validate')
    .description('Validate integration coherence across arch/ YAML artefacts')
    .option('--bc <name>', 'Validate only the specified bounded context')
    .option('--no-strict', 'Do not exit with code 1 when errors are found')
    .action((opts) => {
      runValidate({ bc: opts.bc, strict: opts.strict }).catch((err) => {
        console.error(chalk.red(err.message));
        process.exit(1);
      });
    });
}

module.exports = { registerValidate };
