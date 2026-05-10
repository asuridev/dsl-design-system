'use strict';

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Reads arch/system/system.yaml relative to the given cwd.
 * Returns the parsed document or throws if not found.
 *
 * @param {string} cwd - Absolute path to the project root (where arch/ lives)
 * @returns {object}
 */
function readSystemYaml(cwd) {
  const filePath = path.join(cwd, 'arch', 'system', 'system.yaml');
  if (!fs.pathExistsSync(filePath)) {
    throw new Error(`system.yaml not found at ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return yaml.load(raw) || {};
}

/**
 * Reads arch/{bcName}/{bcName}.yaml relative to the given cwd.
 * Returns { bc: bcName, ...parsed } or throws if not found.
 *
 * @param {string} bcName
 * @param {string} cwd
 * @returns {object}
 */
function readBcYaml(bcName, cwd) {
  const filePath = path.join(cwd, 'arch', bcName, `${bcName}.yaml`);
  if (!fs.pathExistsSync(filePath)) {
    throw new Error(`BC yaml not found at ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const doc = yaml.load(raw) || {};
  return { bc: bcName, ...doc };
}

/**
 * Reads arch/{bcName}/{bcName}-async-api.yaml relative to the given cwd.
 * Returns the parsed document or null if the file does not exist.
 *
 * @param {string} bcName
 * @param {string} cwd
 * @returns {object|null}
 */
function readAsyncApiYaml(bcName, cwd) {
  const filePath = path.join(cwd, 'arch', bcName, `${bcName}-async-api.yaml`);
  if (!fs.pathExistsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  return yaml.load(raw) || null;
}

/**
 * Discovers BC names by scanning subdirectories of arch/ (excluding "system").
 * A directory is treated as a BC if it contains a file matching {dirName}.yaml.
 *
 * @param {string} cwd
 * @returns {string[]}
 */
function discoverBcNames(cwd) {
  const archDir = path.join(cwd, 'arch');
  if (!fs.pathExistsSync(archDir)) return [];

  const EXCLUDED = new Set(['system', 'review']);
  const entries = fs.readdirSync(archDir, { withFileTypes: true });
  const names = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (EXCLUDED.has(entry.name)) continue;
    const bcFile = path.join(archDir, entry.name, `${entry.name}.yaml`);
    if (fs.pathExistsSync(bcFile)) {
      names.push(entry.name);
    }
  }

  return names.sort();
}

module.exports = { readSystemYaml, readBcYaml, readAsyncApiYaml, discoverBcNames };
