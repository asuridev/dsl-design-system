'use strict';

const assert = require('assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'dsl.js');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function runNode(args, options = {}) {
  const nodePath = path.join(ROOT, 'node_modules');
  return spawnSync(process.execPath, args, {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      NODE_PATH: process.env.NODE_PATH
        ? `${nodePath}${path.delimiter}${process.env.NODE_PATH}`
        : nodePath,
    },
    input: options.input || undefined,
  });
}

async function withTempProject(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsl-design-system-'));
  try {
    await fn(dir);
  } finally {
    await fs.remove(dir);
  }
}

async function writeYaml(filePath, content) {
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content.trimStart(), 'utf8');
}

async function writeValidArch(projectDir) {
  await writeYaml(path.join(projectDir, 'arch', 'system', 'system.yaml'), `
system:
  name: smoke-system
  description: Smoke fixture system.
  domainType: core
boundedContexts:
  - name: catalog
    type: core
    purpose: Manages catalog data.
    aggregates:
      - name: Product
        root: Product
        entities: []
externalSystems: []
integrations: []
infrastructure: {}
`);

  await writeYaml(path.join(projectDir, 'arch', 'catalog', 'catalog.yaml'), `
bc: catalog
type: core
description: Catalog BC.
domainEvents:
  published: []
  consumed: []
`);
}

async function writeAuthContextInvalidArch(projectDir) {
  await writeYaml(path.join(projectDir, 'arch', 'system', 'system.yaml'), `
system:
  name: invalid-system
  description: Invalid fixture system.
  domainType: core
boundedContexts:
  - name: catalog
    type: core
    purpose: Manages catalog data.
    aggregates:
      - name: Product
        root: Product
        entities: []
externalSystems: []
integrations: []
infrastructure: {}
`);

  await writeYaml(path.join(projectDir, 'arch', 'catalog', 'catalog.yaml'), `
bc: catalog
type: core
description: Catalog BC.
domainEvents:
  published:
    - name: ProductActivated
      payload:
        - name: actorId
          type: Uuid
          source: auth-context
          claim: sub
  consumed: []
`);
}

async function writeIncrementalArch(projectDir) {
  await writeYaml(path.join(projectDir, 'arch', 'system', 'system.yaml'), `
system:
  name: incremental-system
  description: Incremental fixture system.
  domainType: core
boundedContexts:
  - name: catalog
    type: core
    purpose: Manages catalog data.
    aggregates:
      - name: Product
        root: Product
        entities: []
  - name: payments
    type: supporting
    purpose: Captures payments.
    aggregates:
      - name: Payment
        root: Payment
        entities: []
externalSystems: []
integrations: []
infrastructure: {}
`);

  await writeYaml(path.join(projectDir, 'arch', 'catalog', 'catalog.yaml'), `
bc: catalog
type: core
description: Catalog BC.
domainEvents:
  published: []
  consumed:
    - name: PaymentCaptured
      sourceBc: payments
      payload:
        - name: paymentId
          type: Uuid
`);
}

async function writeHttpOperationMissingArch(projectDir) {
  await writeYaml(path.join(projectDir, 'arch', 'system', 'system.yaml'), `
system:
  name: http-invalid-system
  description: Invalid HTTP fixture system.
  domainType: core
boundedContexts:
  - name: catalog
    type: core
    purpose: Manages catalog data.
    aggregates:
      - name: Product
        root: Product
        entities: []
externalSystems: []
integrations: []
infrastructure: {}
`);

  await writeYaml(path.join(projectDir, 'arch', 'catalog', 'catalog.yaml'), `
bc: catalog
type: core
description: Catalog BC.
domainEvents:
  published: []
  consumed: []
useCases:
  - id: UC-CAT-001
    name: GetProduct
    type: query
    trigger:
      kind: http
      operationId: getProduct
    input: []
    returns: String
`);

  await writeYaml(path.join(projectDir, 'arch', 'catalog', 'catalog-open-api.yaml'), `
openapi: 3.0.3
info:
  title: Catalog API
  version: 1.0.0
paths:
  /products/{id}:
    get:
      operationId: findProduct
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: string
`);
}

async function writeHttpMissingRefArch(projectDir) {
  await writeYaml(path.join(projectDir, 'arch', 'system', 'system.yaml'), `
system:
  name: http-ref-invalid-system
  description: Invalid HTTP schema fixture system.
  domainType: core
boundedContexts:
  - name: catalog
    type: core
    purpose: Manages catalog data.
    aggregates:
      - name: Product
        root: Product
        entities: []
externalSystems: []
integrations: []
infrastructure: {}
`);

  await writeYaml(path.join(projectDir, 'arch', 'catalog', 'catalog.yaml'), `
bc: catalog
type: core
description: Catalog BC.
domainEvents:
  published: []
  consumed: []
useCases:
  - id: UC-CAT-001
    name: GetProduct
    type: query
    trigger:
      kind: http
      operationId: getProduct
    input: []
    returns: Product
`);

  await writeYaml(path.join(projectDir, 'arch', 'catalog', 'catalog-open-api.yaml'), `
openapi: 3.0.3
info:
  title: Catalog API
  version: 1.0.0
paths:
  /products/{id}:
    get:
      operationId: getProduct
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProductResponse'
components:
  schemas: {}
`);
}

async function writeTacticalInvalidArch(projectDir, bcYaml) {
  await writeYaml(path.join(projectDir, 'arch', 'system', 'system.yaml'), `
system:
  name: tactical-invalid-system
  description: Invalid tactical fixture system.
  domainType: core
boundedContexts:
  - name: catalog
    type: core
    purpose: Manages catalog data.
    aggregates:
      - name: Product
        root: Product
        entities: []
externalSystems: []
integrations: []
infrastructure: {}
`);

  await writeYaml(path.join(projectDir, 'arch', 'catalog', 'catalog.yaml'), bcYaml);
}

async function assertTacticalValidationFails(bcYaml, expectedCode) {
  await withTempProject(async (projectDir) => {
    assert.strictEqual(runNode([CLI, 'init'], { cwd: projectDir }).status, 0);
    await writeTacticalInvalidArch(projectDir, bcYaml);

    const validateCli = path.join(projectDir, 'tools', 'dsl-validate', 'bin', 'dsl.js');
    const result = runNode([validateCli, 'validate'], { cwd: projectDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notStrictEqual(result.status, 0, output);
    assert.match(output, new RegExp(expectedCode));
  });
}

test('dsl init scaffolds design assets and validator', async () => {
  await withTempProject(async (projectDir) => {
    const result = runNode([CLI, 'init'], { cwd: projectDir });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const expectedPaths = [
      'arch',
      path.join('.agents', 'skills'),
      path.join('.github', 'agents'),
      path.join('tools', 'dsl-validate', 'bin', 'dsl.js'),
      path.join('tools', 'dsl-validate', 'src', 'utils', 'integration-validator.js'),
      path.join('tools', 'dsl-validate', 'src', 'utils', 'canonical-types.js'),
      path.join('tools', 'dsl-validate', 'src', 'utils', 'bc-yaml-validator.js'),
      path.join('tools', 'dsl-validate', 'src', 'utils', 'openapi-contract.js'),
      path.join('tools', 'dsl-validate', 'src', 'utils', 'openapi-usecase-validator.js'),
      path.join('tools', 'package.json'),
    ];

    for (const rel of expectedPaths) {
      assert.ok(await fs.pathExists(path.join(projectDir, rel)), `Expected ${rel} to exist`);
    }
  });
});

test('copied dsl-validate rejects unsupported useCase keys before generation', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
domainEvents:
  published: []
  consumed: []
useCases:
  - id: UC-CAT-001
    name: GetProduct
    type: query
    triger:
      kind: http
`, 'BC-012');
});

test('copied dsl-validate rejects useCase inputs without source', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
domainEvents:
  published: []
  consumed: []
useCases:
  - id: UC-CAT-001
    name: GetProduct
    type: query
    input:
      - name: id
        type: Uuid
    returns: String
`, 'BC-021');
});

test('copied dsl-validate rejects command methods missing from aggregate domainMethods', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
    domainMethods: []
domainEvents:
  published: []
  consumed: []
useCases:
  - id: UC-CAT-001
    name: ActivateProduct
    type: command
    aggregate: Product
    method: activate
`, 'BC-103');
});

test('copied dsl-validate rejects HTTP query use cases without returns', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
domainEvents:
  published: []
  consumed: []
useCases:
  - id: UC-CAT-001
    name: GetProduct
    type: query
    trigger:
      kind: http
      operationId: getProduct
`, 'BC-105');
});

test('copied dsl-validate rejects uniqueness constraintName without field', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: sku
        type: String
    domainRules:
      - id: PRD-RULE-001
        type: uniqueness
        errorCode: PRODUCT_SKU_EXISTS
        constraintName: uk_product_sku
errors:
  - code: PRODUCT_SKU_EXISTS
    httpStatus: 409
domainEvents:
  published: []
  consumed: []
`, 'BC-067');
});

test('copied dsl-validate rejects projections that embed aggregates', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
projections:
  - name: ProductSummary
    properties:
      - name: product
        type: Product
domainEvents:
  published: []
  consumed: []
`, 'BC-083');
});

test('copied dsl-validate rejects query use cases without repository queryMethods', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
repositories:
  - aggregate: Product
    methods: []
useCases:
  - id: UC-CAT-001
    name: SearchProducts
    type: query
    aggregate: Product
    returns: ProductSummary
domainEvents:
  published: []
  consumed: []
`, 'BC-164');
});

test('copied dsl-validate passes a minimal valid arch', async () => {
  await withTempProject(async (projectDir) => {
    assert.strictEqual(runNode([CLI, 'init'], { cwd: projectDir }).status, 0);
    await writeValidArch(projectDir);

    const validateCli = path.join(projectDir, 'tools', 'dsl-validate', 'bin', 'dsl.js');
    const result = runNode([validateCli, 'validate'], { cwd: projectDir });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /All validations passed/);
  });
});

test('copied dsl-validate rejects auth-context in published event payload', async () => {
  await withTempProject(async (projectDir) => {
    assert.strictEqual(runNode([CLI, 'init'], { cwd: projectDir }).status, 0);
    await writeAuthContextInvalidArch(projectDir);

    const validateCli = path.join(projectDir, 'tools', 'dsl-validate', 'bin', 'dsl.js');
    const result = runNode([validateCli, 'validate'], { cwd: projectDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notStrictEqual(result.status, 0, output);
    assert.match(output, /INT-025/);
  });
});

test('incremental undeveloped BC consumers are warnings, not strict failures', async () => {
  await withTempProject(async (projectDir) => {
    assert.strictEqual(runNode([CLI, 'init'], { cwd: projectDir }).status, 0);
    await writeIncrementalArch(projectDir);

    const validateCli = path.join(projectDir, 'tools', 'dsl-validate', 'bin', 'dsl.js');
    const result = runNode([validateCli, 'validate'], { cwd: projectDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.strictEqual(result.status, 0, output);
    assert.match(output, /INT-007/);
    assert.match(output, /warning\(s\) found, no errors/);
    assert.doesNotMatch(output, /error\(s\)/);
  });
});

test('copied dsl-validate rejects missing OpenAPI operationId before generation', async () => {
  await withTempProject(async (projectDir) => {
    assert.strictEqual(runNode([CLI, 'init'], { cwd: projectDir }).status, 0);
    await writeHttpOperationMissingArch(projectDir);

    const validateCli = path.join(projectDir, 'tools', 'dsl-validate', 'bin', 'dsl.js');
    const result = runNode([validateCli, 'validate'], { cwd: projectDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notStrictEqual(result.status, 0, output);
    assert.match(output, /HTTP-001/);
  });
});

test('copied dsl-validate rejects missing OpenAPI component refs before generation', async () => {
  await withTempProject(async (projectDir) => {
    assert.strictEqual(runNode([CLI, 'init'], { cwd: projectDir }).status, 0);
    await writeHttpMissingRefArch(projectDir);

    const validateCli = path.join(projectDir, 'tools', 'dsl-validate', 'bin', 'dsl.js');
    const result = runNode([validateCli, 'validate'], { cwd: projectDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notStrictEqual(result.status, 0, output);
    assert.match(output, /HTTP-008/);
  });
});

test('published event payload docs do not whitelist auth-context', async () => {
  const files = [
    path.join(ROOT, 'README.md'),
    path.join(ROOT, 'src', 'skills', 'ddd-step2-tactical-design', 'references', 'bc-yaml-guide.md'),
  ];
  const forbidden = [
    /source: auth-context, claim/,
    /`auth-context`\s*\|\s*`claim`/,
    /constant`\s*·\s*`auth-context`\s*·\s*`derived`/,
  ];

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${file} still contains forbidden auth-context guidance`);
    }
  }
});

(async () => {
  let passed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
      console.log(`✓ ${name}`);
    } catch (err) {
      console.error(`✖ ${name}`);
      console.error(err && err.stack ? err.stack : err);
      process.exitCode = 1;
      break;
    }
  }

  console.log(`\n${passed}/${tests.length} tests passed`);
})();
