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

/**
 * Applies all Claude Code-specific rewrites to a markdown file's content.
 * Safe to call on both agent files and skill files.
 *
 * Root problem being solved: the source files were written for VS Code Copilot
 * where vscode_askQuestions is a real interactive tool. In Claude Code that tool
 * does not exist. A naive name substitution leaves broken semantics that cause
 * agents to skip user interaction entirely:
 *
 *   - "Usar **siempre** esta herramienta" → the model finds no tool and skips.
 *   - "(fallback)" label → marks the text format as secondary/optional.
 *   - "en una sola llamada vscode_askQuestions" → broken grammar after substitution,
 *     the model ignores the sentence.
 *
 * This function applies targeted rewrites so the protocol becomes imperative
 * in Claude Code: the agent MUST stop the flow and wait for user input.
 *
 * Transformations applied (in order):
 *  1. tools: frontmatter — Copilot tool names → Claude Code names
 *  2. Skill paths — .agents/skills/ → .claude/skills/
 *  3. "Cuándo usar `vscode_askQuestions`" section → "Cuándo pausar obligatoriamente"
 *  4. "Usar **siempre** esta herramienta cuando" → imperative pause instruction
 *  5. "Cuándo usar texto directo (fallback)" section → "(única vía en Claude Code)"
 *  6. "Si `vscode_askQuestions` no está disponible…" conditional → unconditional
 *  7. "en una sola llamada `vscode_askQuestions`" call syntax → grouping instruction
 *  8. All remaining inline `vscode_askQuestions` references → ⏸️ PAUSA marker
 */
function applyClaudeCodeTransforms(content) {
  // 1. Rewrite tools frontmatter. Matches any tools: [...] line that contains at
  //    least one Copilot-specific tool so the rule fires even when vscode/askQuestions
  //    is absent in future agent files.
  content = content.replace(
    /^tools:\s*\[.*(?:vscode\/\w+|(?<!\w)read(?!\w)|(?<!\w)search(?!\w)|(?<!\w)execute(?!\w)).*\]$/m,
    'tools: [Read, Write, Edit, Grep, Glob, Bash]',
  );

  // 2. Rewrite skill paths so .claude/agents/ files do not depend on .agents/skills/.
  content = content.replace(/\.agents\/skills\//g, '.claude/skills/');

  // 3. Rename the "Cuándo usar vscode_askQuestions" section to describe the
  //    SITUATION (when to pause) rather than a tool that doesn't exist.
  content = content.replace(
    /### Cuándo usar `vscode_askQuestions`/g,
    '### Cuándo pausar obligatoriamente para decisión del diseñador',
  );

  // 4. Replace "Usar **siempre** esta herramienta cuando..." with imperative pause
  //    language. "esta herramienta" has no referent in Claude Code; the model
  //    reads the section as not applicable and skips it entirely.
  content = content.replace(
    /Usar \*\*siempre\*\* esta herramienta cuando la decisión cumpla alguna de estas condiciones:/g,
    '**Pausar el flujo siempre** y esperar respuesta del diseñador cuando la decisión cumpla alguna de estas condiciones:',
  );

  // 5. Rename "Cuándo usar texto directo (fallback)" — the "(fallback)" label
  //    causes models to treat the text format as optional. It is the ONLY mechanism
  //    in Claude Code and must not be labelled as a secondary option.
  content = content.replace(
    /### Cuándo usar texto directo \(fallback\)/g,
    '### Formato ⏸️ PAUSA — único mecanismo en Claude Code',
  );

  // 6. Replace the conditional availability sentence (spans two lines). The
  //    condition is always true in Claude Code so make it unconditional and
  //    add an explicit "must stop" instruction.
  content = content.replace(
    /Si `vscode_askQuestions` no está disponible en el contexto actual, usar este formato\r?\nde texto directo\./g,
    'Usar siempre este formato. Detener el flujo y esperar respuesta antes de continuar.',
  );

  // 7. Fix the "en una sola llamada `vscode_askQuestions`" call syntax. After a
  //    plain name substitution this becomes grammatically broken ("en una sola
  //    llamada el protocolo"), which models ignore. Replace with grouping semantics.
  content = content.replace(
    /en una sola llamada `vscode_askQuestions`/g,
    'en un único bloque ⏸️ PAUSA (agrupar todas las preguntas)',
  );

  // 8. Replace all remaining inline references, including combined suffix variants:
  //      `vscode_askQuestions` (o en texto directo)
  //      `vscode_askQuestions` (o pregunta en texto si no está disponible)
  //      `vscode_askQuestions` (o en texto directo) (o pregunta en texto...)
  //      bare `vscode_askQuestions`
  //    The ⏸️ marker and "detener el flujo" wording signal to the model that it
  //    must stop and wait, not merely "present information".
  content = content.replace(
    /`vscode_askQuestions`(?:\s*\(o (?:en texto directo|pregunta en texto si no está disponible)\))*/g,
    'el formato ⏸️ PAUSA (detener el flujo y esperar respuesta del diseñador)',
  );

  return content;
}

/**
 * Recursively copies srcDir → destDir, applying applyClaudeCodeTransforms to
 * every .md file and doing a plain copy for all other file types.
 */
async function copyDirTransformed(srcDir, destDir) {
  await fs.ensureDir(destDir);
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirTransformed(srcPath, destPath);
    } else if (entry.name.endsWith('.md')) {
      let content = await fs.readFile(srcPath, 'utf8');
      content = applyClaudeCodeTransforms(content);
      await fs.writeFile(destPath, content, 'utf8');
    } else {
      await fs.copy(srcPath, destPath, { overwrite: true });
    }
  }
}

/**
 * Copies agent files to destDir, applying applyClaudeCodeTransforms to each file.
 * Agents live at the top level of srcDir (no subdirectories to recurse into).
 */
async function copyAgentsTransformed(srcDir, destDir, label) {
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
  await fs.ensureDir(destDir);

  const files = await fs.readdir(srcDir);
  for (const file of files) {
    const srcFile = path.join(srcDir, file);
    const destFile = path.join(destDir, file);
    const stat = await fs.stat(srcFile);
    if (stat.isDirectory()) {
      await fs.copy(srcFile, destFile, { overwrite: true });
      continue;
    }
    let content = await fs.readFile(srcFile, 'utf8');
    content = applyClaudeCodeTransforms(content);
    await fs.writeFile(destFile, content, 'utf8');
  }

  spinner.succeed(chalk.green(`  OK    ${label}`));
}

/**
 * Copies the skills directory tree to destDir, applying applyClaudeCodeTransforms
 * to every .md file so that vscode_askQuestions references are cleaned up before
 * the skills land in .claude/skills/.
 */
async function copySkillsTransformed(srcDir, destDir, label) {
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
  await copyDirTransformed(srcDir, destDir);
  spinner.succeed(chalk.green(`  OK    ${label}`));
}

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

      // 2. Copy skills → .agents/skills/ (VSCode / GitHub Copilot, plain copy)
      const srcSkills = path.join(__dirname, '../skills');
      const destSkills = path.join(cwd, '.agents', 'skills');
      await copyIfConfirmed(srcSkills, destSkills, '.agents/skills');

      // 2b. Copy skills → .claude/skills/ (Claude Code CLI, vscode_askQuestions removed)
      const destSkillsClaude = path.join(cwd, '.claude', 'skills');
      await copySkillsTransformed(srcSkills, destSkillsClaude, '.claude/skills');

      // 3. Copy agents → .github/agents/ (GitHub Copilot, plain copy)
      const srcAgents = path.join(__dirname, '../agents');
      const destAgents = path.join(cwd, '.github', 'agents');
      await copyIfConfirmed(srcAgents, destAgents, '.github/agents');

      // 3b. Copy agents → .claude/agents/ (Claude Code CLI, fully transformed)
      const destAgentsClaude = path.join(cwd, '.claude', 'agents');
      await copyAgentsTransformed(srcAgents, destAgentsClaude, '.claude/agents');

      // 4. Scaffold tools/dsl-validate/
      await scaffoldDslValidate(cwd);

      console.log(chalk.green('\nDone! DSL design system initialized.'));
    });
}

module.exports = { registerInit };
