'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');

// Source files assembled into tools/dsl-validate/. By default `src` is relative to
// this repo's src/. Entries with `fromContract: true` are sourced from the shared
// @dsl/contract package instead (GAP-1: single source of truth for the contract
// validators). The deployed tool stays self-contained: these files are still
// copied (not linked) into tools/dsl-validate/src/utils/, where their relative
// requires (./naming, ./openapi-contract) resolve.
const DSL_VALIDATE_SOURCES = [
  { src: ['commands', 'validate.js'],             dest: ['src', 'commands', 'validate.js'] },
  { src: ['utils', 'arch-readers.js'],            dest: ['src', 'utils', 'arch-readers.js'] },
  { src: ['utils', 'canonical-types.js'],         dest: ['src', 'utils', 'canonical-types.js'] },
  { src: ['utils', 'bc-yaml-validator.js'],       dest: ['src', 'utils', 'bc-yaml-validator.js'] },
  { src: ['integration-validator.js'],            dest: ['src', 'utils', 'integration-validator.js'], fromContract: true },
  { src: ['utils', 'naming.js'],                  dest: ['src', 'utils', 'naming.js'] },
  { src: ['openapi-contract.js'],                 dest: ['src', 'utils', 'openapi-contract.js'], fromContract: true },
  { src: ['openapi-usecase-validator.js'],        dest: ['src', 'utils', 'openapi-usecase-validator.js'], fromContract: true },
];

// Entry-point orchestrators authored as skills under src/skills/<name>/SKILL.md. They are
// routed differently from the DDD process skills: each becomes a Claude Code skill AND a
// Copilot @agent (see installOrchestrators / installDddSkills). Everything else in
// src/skills/ is a DDD process skill.
const ORCHESTRATORS = ['design-system', 'design-bounded-context'];

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
 * thread. Subagents (Agent/Task) cannot use it. The orchestrators must therefore run
 * in the main thread. A Claude Code SKILL satisfies this exactly like a slash command
 * (both execute in the main conversation), and skills are the mechanism Claude Code
 * recommends — so init installs these orchestrators as skills (.claude/skills/), not
 * subagents — see orchestratorToClaudeSkill() / installOrchestrators(). Read-only analysis
 * WITHOUT human-in-the-loop may run as subagents (.claude/agents/) — see copyWorkersAsSubagents().
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
 * Transforms an orchestrator skill SOURCE (src/skills/<name>/SKILL.md, authored in the
 * Copilot-canonical style) into the Claude Code SKILL body.
 *
 * Why a skill and not a subagent: these flows are human-in-the-loop and must pause to
 * ask the designer for decisions. AskUserQuestion is NOT available inside subagents
 * (Agent/Task) — they run autonomously and cannot block for user input. A skill runs
 * in the MAIN conversation thread, where AskUserQuestion pauses reliably, and skills are
 * the entry-point mechanism Claude Code recommends.
 *
 * Frontmatter is normalized source → Claude skill:
 *   - keep `name:` and `description:`  (skills require both; name drives /skill invocation
 *                                       and description drives model auto-invocation)
 *   - drop `tools:` and `argument-hint:` (carried by the source only to derive the Copilot
 *                                         @agent; not part of the SKILL.md frontmatter schema)
 * The designer's request arrives as the Skill tool's argument — a one-line note records
 * this in the body instead of the command-only $ARGUMENTS token.
 */
function orchestratorToClaudeSkill(content) {
  // Body + frontmatter-value rewrites (paths, askQuestions → AskUserQuestion, @ → /).
  content = applyClaudeCodeTransforms(content);

  // Drop `tools:` (already rewritten to a Claude tool array by transform 1) and
  // `argument-hint:` — neither belongs in a SKILL.md frontmatter.
  content = content.replace(/^tools:\s*\[[^\]]*\]\s*\r?\n/m, '');
  content = content.replace(/^argument-hint:.*\r?\n/m, '');

  // Record where the designer's request comes from (the Skill tool argument), in
  // place of the slash-command-only $ARGUMENTS injection.
  content = content.replace(
    /^(---\r?\n[\s\S]*?\r?\n---\r?\n)/,
    '$1\n> **Contexto del diseñador:** llega como argumento de esta skill (la petición que disparó la invocación).\n',
  );

  return content;
}

/**
 * Installs the entry-point orchestrator skills for BOTH runtimes from their source
 * (src/skills/<name>/SKILL.md):
 *   - Claude Code: .claude/skills/<name>/SKILL.md  (orchestratorToClaudeSkill — main-thread
 *     skill, AskUserQuestion available).
 *   - Copilot:     .github/agents/<name>.agent.md  (verbatim — the source is already
 *     Copilot-canonical: keeps vscode_askQuestions, @-refs, tools, argument-hint).
 *
 * `names` is the ORCHESTRATORS list; each must exist as src/skills/<name>/SKILL.md.
 */
async function installOrchestrators(srcSkills, cwd, names, label) {
  const claudeDirs = names.map((n) => path.join(cwd, '.claude', 'skills', n));
  const anyExists = (await Promise.all(claudeDirs.map((d) => fs.pathExists(d)))).some(Boolean);
  if (anyExists) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `${chalk.yellow(label)} already exist. Overwrite?`,
        default: false,
      },
    ]);
    if (!overwrite) {
      console.log(chalk.yellow(`  SKIP  ${label}`));
      return;
    }
  }

  const spinner = ora(`Copying ${label}...`).start();
  for (const name of names) {
    const srcFile = path.join(srcSkills, name, 'SKILL.md');
    const content = await fs.readFile(srcFile, 'utf8');

    // Claude Code skill (transformed, main thread).
    const claudeFile = path.join(cwd, '.claude', 'skills', name, 'SKILL.md');
    await fs.ensureDir(path.dirname(claudeFile));
    await fs.writeFile(claudeFile, orchestratorToClaudeSkill(content), 'utf8');

    // Copilot @agent (verbatim from the Copilot-canonical source).
    const copilotFile = path.join(cwd, '.github', 'agents', `${name}.agent.md`);
    await fs.ensureDir(path.dirname(copilotFile));
    await fs.writeFile(copilotFile, content, 'utf8');
  }

  spinner.succeed(chalk.green(`  OK    ${label}`));
}

/**
 * Copies the DDD skills tree to destDir, applying applyClaudeCodeTransforms to every .md
 * file so that vscode_askQuestions references are cleaned up before the skills land in
 * .claude/skills/. Top-level subdirectories named in `skip` (the orchestrators) are not
 * copied here — they are routed separately by installOrchestrators.
 */
async function copySkillsTransformed(srcDir, destDir, label, skip = []) {
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
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && skip.includes(entry.name)) continue;
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirTransformed(src, dest);
    } else if (entry.name.endsWith('.md')) {
      await fs.writeFile(dest, applyClaudeCodeTransforms(await fs.readFile(src, 'utf8')), 'utf8');
    } else {
      await fs.copy(src, dest, { overwrite: true });
    }
  }
  spinner.succeed(chalk.green(`  OK    ${label}`));
}

/**
 * Copies the read-only worker subagent definitions (src/agents/*.md) to .claude/agents/,
 * where Claude Code subagents live. Unlike the orchestrators (which are skills), the workers
 * do NOT need the main thread: they perform read-only analysis and never call AskUserQuestion,
 * so running as subagents (Agent/Task) is correct and unlocks parallel fan-out. They are
 * authored directly for Claude Code (no vscode_askQuestions to rewrite) and copied verbatim.
 *
 * Copilot has no programmatic agent spawn, so no worker files are emitted for it — the
 * @design-system agent keeps performing this analysis inline (status quo).
 */
async function copyWorkersAsSubagents(srcDir, destDir, label) {
  if (!(await fs.pathExists(srcDir))) return;
  const files = (await fs.readdir(srcDir)).filter((f) => f.endsWith('.md'));
  if (files.length === 0) return;

  const destFiles = files.map((f) => path.join(destDir, f));
  const anyExists = (await Promise.all(destFiles.map((d) => fs.pathExists(d)))).some(Boolean);
  if (anyExists) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `${chalk.yellow(label)} already exist. Overwrite?`,
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
  for (const file of files) {
    await fs.copy(path.join(srcDir, file), path.join(destDir, file), { overwrite: true });
  }
  spinner.succeed(chalk.green(`  OK    ${label}`));
}

async function copyIfConfirmed(srcDir, destDir, label, filter) {
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
  await fs.copy(srcDir, destDir, filter ? { overwrite: true, filter } : { overwrite: true });
  spinner.succeed(chalk.green(`  OK    ${label}`));
}

/**
 * Returns an fs.copy filter that skips top-level subdirectories of `rootDir` whose name
 * is in `skip`. Used to keep the orchestrator skills out of the DDD-skills copies (they
 * are routed separately by installOrchestrators).
 */
function skipTopLevelDirs(rootDir, skip) {
  return (src) => {
    const rel = path.relative(rootDir, src);
    if (!rel) return true; // the root itself
    const top = rel.split(path.sep)[0];
    return !skip.includes(top);
  };
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

  // 2. Copy validate logic files. Repo files come from src/; contract validators
  //    come from the @dsl/contract package (single source of truth).
  const srcRoot = path.join(__dirname, '..');
  const contractSrc = path.dirname(require.resolve('@dsl/contract')); // .../dsl-contract/src
  for (const { src, dest, fromContract } of DSL_VALIDATE_SOURCES) {
    const srcFile  = fromContract ? path.join(contractSrc, ...src) : path.join(srcRoot, ...src);
    const destFile = path.join(destRoot, ...dest);
    await fs.ensureDir(path.dirname(destFile));
    await fs.copy(srcFile, destFile, { overwrite: true });
  }

  // 2b. The repo's validate.js imports the validators from '@dsl/contract', which
  //     does not exist inside the deployed, self-contained tool. Rewrite that import
  //     to the local relative requires (the files were copied into ../utils/ above).
  const deployedValidate = path.join(destRoot, 'src', 'commands', 'validate.js');
  let validateSrc = await fs.readFile(deployedValidate, 'utf8');
  validateSrc = validateSrc.replace(
    /const \{ validateIntegrationCoherence, reportDiagnostics, validateOpenApiUseCases \} = require\('@dsl\/contract'\);/,
    "const { validateIntegrationCoherence, reportDiagnostics } = require('../utils/integration-validator');\n"
    + "const { validateOpenApiUseCases } = require('../utils/openapi-usecase-validator');"
  );
  await fs.writeFile(deployedValidate, validateSrc);

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
      // 2. Copy DDD process skills (everything in src/skills except the orchestrators) to
      //    both runtimes: Copilot .agents/skills/ (verbatim) and Claude .claude/skills/
      //    (vscode_askQuestions rewritten). Orchestrators are skipped here and routed in 3.
      const srcSkills = path.join(__dirname, '../skills');
      const destSkills = path.join(cwd, '.agents', 'skills');
      await copyIfConfirmed(srcSkills, destSkills, '.agents/skills', skipTopLevelDirs(srcSkills, ORCHESTRATORS));

      // 2b. Copy DDD skills → .claude/skills/ (Claude Code CLI, vscode_askQuestions removed)
      const destSkillsClaude = path.join(cwd, '.claude', 'skills');
      await copySkillsTransformed(srcSkills, destSkillsClaude, '.claude/skills', ORCHESTRATORS);

      // 3. Install the entry-point orchestrator skills for both runtimes from their source
      //    (src/skills/<name>/SKILL.md): Claude skill (.claude/skills, main thread so
      //    AskUserQuestion can pause) + Copilot @agent (.github/agents). Invoked as
      //    /design-system, /design-bounded-context (Claude) or @design-system (Copilot).
      await installOrchestrators(srcSkills, cwd, ORCHESTRATORS, 'orchestrators (skill + @agent)');

      // 3b. Generate read-only workers as Claude Code subagents → .claude/agents/.
      //     They never call AskUserQuestion (read-only analysis), so subagents are correct
      //     and enable parallel fan-out. Copilot gets none (no programmatic spawn).
      const srcAgents = path.join(__dirname, '../agents');
      const destAgentsClaude = path.join(cwd, '.claude', 'agents');
      await copyWorkersAsSubagents(srcAgents, destAgentsClaude, '.claude/agents (workers)');

      // 4. Scaffold tools/dsl-validate/
      await scaffoldDslValidate(cwd);

      console.log(chalk.green('\nDone! DSL design system initialized.'));
    });
}

module.exports = { registerInit };
