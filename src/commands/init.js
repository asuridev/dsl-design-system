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
 * The correct Claude Code mechanism is the real interactive tool `AskUserQuestion`,
 * which pauses the turn and shows a selectable prompt. This function rewrites the
 * protocol so the agent MUST call `AskUserQuestion` (not emit a passive text block)
 * and wait for the designer's answer before continuing.
 *
 * NOTE: `AskUserQuestion` only pauses when the flow runs in the MAIN conversation
 * thread. Subagents (Agent/Task) cannot use it. That is why init generates these
 * orchestrators as slash commands (.claude/commands/), not subagents — see
 * agentToCommand() / copyAgentsAsCommands().
 *
 * Transformations applied (in order):
 *  1. tools: frontmatter — Copilot tool names → Claude Code names (incl. AskUserQuestion)
 *  2. Skill paths — .agents/skills/ → .claude/skills/
 *  3. "Cuándo usar `vscode_askQuestions`" section → "Cuándo pausar … con `AskUserQuestion`"
 *  4. "Usar **siempre** esta herramienta cuando" → imperative "llama a AskUserQuestion"
 *  5. "Cuándo usar texto directo (fallback)" section → "Formato de la llamada a AskUserQuestion"
 *  6. "Si `vscode_askQuestions` no está disponible…" conditional → unconditional tool call
 *  7. "en una sola llamada `vscode_askQuestions`" → single AskUserQuestion call
 *  8. All remaining inline `vscode_askQuestions` references → AskUserQuestion tool call
 *  9. The "⏸️ PAUSA …" text template header/footer → AskUserQuestion call instructions
 * 10. Option fields (recommended / allowFreeformInput) → AskUserQuestion semantics
 * 11. Invocation refs in generated docs: @design-* (Copilot) → /design-* (Claude Code)
 */
function applyClaudeCodeTransforms(content) {
  // 1. Rewrite tools frontmatter. Matches any tools: [...] line that contains at
  //    least one Copilot-specific tool so the rule fires even when vscode/askQuestions
  //    is absent in future agent files. AskUserQuestion is included because every
  //    human-in-the-loop flow needs the interactive pause tool.
  content = content.replace(
    /^tools:\s*\[.*(?:vscode\/\w+|(?<!\w)read(?!\w)|(?<!\w)search(?!\w)|(?<!\w)execute(?!\w)).*\]$/m,
    'tools: [Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion]',
  );

  // 2. Rewrite skill paths so .claude/agents/ files do not depend on .agents/skills/.
  content = content.replace(/\.agents\/skills\//g, '.claude/skills/');

  // 3. Rename the "Cuándo usar vscode_askQuestions" section to name the real
  //    Claude Code tool and describe the SITUATION (when to pause).
  content = content.replace(
    /### Cuándo usar `vscode_askQuestions`/g,
    '### Cuándo pausar obligatoriamente con la herramienta `AskUserQuestion`',
  );

  // 4. Replace "Usar **siempre** esta herramienta cuando..." with an imperative
  //    instruction to call AskUserQuestion. "esta herramienta" had no referent in
  //    Claude Code; naming the tool explicitly makes the rule actionable.
  content = content.replace(
    /Usar \*\*siempre\*\* esta herramienta cuando la decisión cumpla alguna de estas condiciones:/g,
    '**Llama siempre a la herramienta `AskUserQuestion`** y espera la respuesta del diseñador antes de continuar cuando la decisión cumpla alguna de estas condiciones:',
  );

  // 5. Rename "Cuándo usar texto directo (fallback)" — the "(fallback)" label
  //    made models treat it as optional. The block actually describes the FIELDS
  //    of the AskUserQuestion call, so rename it accordingly.
  content = content.replace(
    /### Cuándo usar texto directo \(fallback\)/g,
    '### Formato de la llamada a `AskUserQuestion`',
  );

  // 6. Replace the conditional availability sentence (spans two lines) with an
  //    unconditional instruction to build and issue the AskUserQuestion call.
  content = content.replace(
    /Si `vscode_askQuestions` no está disponible en el contexto actual, usar este formato\r?\nde texto directo\./g,
    'Construye una llamada a la herramienta `AskUserQuestion` con los campos descritos abajo. Detén el flujo y espera la respuesta del diseñador antes de continuar.',
  );

  // 7. Fix the "en una sola llamada `vscode_askQuestions`" call syntax → a single
  //    AskUserQuestion call grouping all the questions.
  content = content.replace(
    /en una sola llamada `vscode_askQuestions`/g,
    'en una sola llamada a la herramienta `AskUserQuestion` (agrupar todas las preguntas)',
  );

  // 8. Replace all remaining inline references, including combined suffix variants:
  //      `vscode_askQuestions` (o en texto directo)
  //      `vscode_askQuestions` (o pregunta en texto si no está disponible)
  //      `vscode_askQuestions` (o en texto directo) (o pregunta en texto...)
  //      bare `vscode_askQuestions`
  content = content.replace(
    /`vscode_askQuestions`(?:\s*\(o (?:en texto directo|pregunta en texto si no está disponible)\))*/g,
    'la herramienta `AskUserQuestion` (pausa el turno y espera la respuesta del diseñador)',
  );

  // 9. The agent files contain a literal "⏸️ PAUSA" text template. Rewrite its
  //    header and footer so the model issues an AskUserQuestion call instead of
  //    printing the template as passive text (which never pauses).
  content = content.replace(
    /⏸️ PAUSA — DECISIÓN REQUERIDA DEL DISEÑADOR/g,
    'Llama a la herramienta `AskUserQuestion` con estos campos (NO escribas esto como texto):',
  );
  content = content.replace(
    /Por favor responde con la letra de tu elección o escribe tu preferencia\./g,
    'Invoca `AskUserQuestion` ahora y espera la selección del diseñador antes de continuar.',
  );

  // 10. Map the vscode_askQuestions option fields to AskUserQuestion semantics.
  //
  //     (a) `recommended: true` — in the VS Code widget it highlights one option.
  //         AskUserQuestion conveys a recommendation by placing the option first and
  //         adding "(Recomendado)" to its label. Convert the field into that
  //         instruction so the recommendation survives WITHOUT becoming an
  //         auto-decision (the model must still ask). Preserves indentation.
  content = content.replace(
    /^([ \t]*)recommended: true\r?\n/gm,
    '$1# AskUserQuestion: coloca esta opción primero y añade "(Recomendado)" a su label — NO la apliques sin preguntar\n',
  );
  //
  //     (b) "(recomendado para datos monetarios)" baked into a label pushes the
  //         model to decide unilaterally. The recommendation is conveyed by 10a.
  content = content.replace(/ \(recomendado para datos monetarios\)/g, '');
  //
  //     (c) After every "allowFreeformInput: false" template block (closing ``` of
  //         the format template), inject the mandatory instruction to actually call
  //         AskUserQuestion and wait. \r? handles CRLF (Windows) and LF (Unix).
  content = content.replace(
    /allowFreeformInput: false\r?\n```/g,
    'allowFreeformInput: false\n```\n\n> ⚠️ **Claude Code — obligatorio:** llama a la herramienta `AskUserQuestion` usando estos `header` / `question` / `options` y **espera** la respuesta del diseñador. La herramienta siempre ofrece "Other" para texto libre. No existe opción por defecto: no apliques ninguna integración sin confirmación explícita.',
  );

  // 11. Invocation references in generated docs: the @agent syntax is Copilot's.
  //     In Claude Code these orchestrators are slash commands, so rewrite to /command.
  //     The longer name is replaced first to avoid a partial @design-system match.
  content = content.replace(/@design-bounded-context/g, '/design-bounded-context');
  content = content.replace(/@design-system/g, '/design-system');

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
 * Converts an orchestrator agent file (src/agents/*.agent.md) into a Claude Code
 * slash command body.
 *
 * Why a command and not a subagent: these flows are human-in-the-loop and must
 * pause to ask the designer for decisions. AskUserQuestion is NOT available inside
 * subagents (Agent/Task) — they run autonomously and cannot block for user input.
 * Slash commands run in the MAIN conversation thread, where AskUserQuestion pauses
 * reliably in both the terminal and the IDE.
 *
 * Frontmatter is rewritten agent → command:
 *   - drop `name:`        (the command name comes from the file name)
 *   - `tools: [...]`     → `allowed-tools: ...` (already includes AskUserQuestion)
 *   - keep `description:` and `argument-hint:`
 * The designer's argument is injected right after the frontmatter via $ARGUMENTS.
 */
function agentToCommand(content) {
  // Body + frontmatter-value rewrites (paths, askQuestions → AskUserQuestion, @ → /).
  content = applyClaudeCodeTransforms(content);

  // Drop the `name:` frontmatter line (command name derives from the file name).
  content = content.replace(/^name:.*\r?\n/m, '');

  // tools: [A, B, C] → allowed-tools: A, B, C
  content = content.replace(/^tools:\s*\[([^\]]*)\]\s*$/m, 'allowed-tools: $1');

  // Inject the designer's request right after the closing frontmatter delimiter.
  content = content.replace(
    /^(---\r?\n[\s\S]*?\r?\n---\r?\n)/,
    '$1\n> **Petición del diseñador:** $ARGUMENTS\n',
  );

  return content;
}

/**
 * Reads each orchestrator agent file in srcDir and writes it to destDir as a Claude
 * Code slash command (design-system.agent.md → design-system.md), so it runs in the
 * main thread where AskUserQuestion can pause. See agentToCommand() for the rationale.
 */
async function copyAgentsAsCommands(srcDir, destDir, label) {
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
    const stat = await fs.stat(srcFile);
    if (stat.isDirectory()) continue;

    // design-system.agent.md → design-system.md (slash command /design-system)
    const commandFile = file.replace(/\.agent\.md$/, '.md');
    const destFile = path.join(destDir, commandFile);
    let content = await fs.readFile(srcFile, 'utf8');
    content = agentToCommand(content);
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

      // 3. Copy agents → .github/agents/ (GitHub Copilot, plain copy, @-invoked)
      const srcAgents = path.join(__dirname, '../agents');
      const destAgents = path.join(cwd, '.github', 'agents');
      await copyIfConfirmed(srcAgents, destAgents, '.github/agents');

      // 3b. Generate orchestrators as Claude Code slash commands → .claude/commands/.
      //     They run in the MAIN thread (not as subagents) so AskUserQuestion can
      //     pause for designer decisions. Invoked as /design-system, /design-bounded-context.
      const destCommandsClaude = path.join(cwd, '.claude', 'commands');
      await copyAgentsAsCommands(srcAgents, destCommandsClaude, '.claude/commands');

      // 4. Scaffold tools/dsl-validate/
      await scaffoldDslValidate(cwd);

      console.log(chalk.green('\nDone! DSL design system initialized.'));
    });
}

module.exports = { registerInit };
