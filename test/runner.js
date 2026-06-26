'use strict';

const assert = require('assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'dsl.js');
const CANASTA_EXAMPLE = path.join(ROOT, 'examples', 'canasta-familiar');

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

async function copyCanastaExample(projectDir) {
  await fs.copy(CANASTA_EXAMPLE, projectDir, { overwrite: true });
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

async function writeArchWithDiagram(projectDir) {
  await writeValidArch(projectDir);
  await fs.ensureDir(path.join(projectDir, 'arch', 'catalog', 'diagrams'));
  await fs.writeFile(path.join(projectDir, 'arch', 'catalog', 'diagrams', 'catalog-diagram.mmd'), `
flowchart LR
  A[Create Product] --> B[Activate Product]
`.trimStart(), 'utf8');
}

async function writeArchWithIntegrations(projectDir) {
  await writeYaml(path.join(projectDir, 'arch', 'system', 'system.yaml'), `
system:
  name: integrations-system
  description: Integrations fixture system.
  domainType: core
boundedContexts:
  - name: catalog
    type: core
    purpose: Manages catalog data.
    aggregates:
      - name: Product
        root: Product
        entities: []
  - name: orders
    type: core
    purpose: Manages orders.
    aggregates:
      - name: Order
        root: Order
        entities: []
externalSystems: []
integrations:
  - from: orders
    to: catalog
    pattern: customer-supplier
    channel: http
    contracts:
      - validateProductsAndPrices
    notes: Mandatory HTTP for monetary snapshot to prevent OWASP A04 fraud.
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

  await writeYaml(path.join(projectDir, 'arch', 'orders', 'orders.yaml'), `
bc: orders
type: core
description: Orders BC.
domainEvents:
  published: []
  consumed: []
integrations:
  outbound:
    - name: catalog
      type: internalBc
      pattern: customerSupplier
      protocol: http
      description: Reads authoritative prices at checkout.
      operations:
        - name: validateProductsAndPrices
          triggersOn: UC-ORD-001
  inbound:
    - name: billing
      type: internalBc
      pattern: customerSupplier
      protocol: http
      operations:
        - name: notifyOrderShipped
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

// Positive-direction assertion: the validator output must NOT contain the given
// pattern (used to prove a former false positive no longer fires).
async function assertTacticalValidationOmits(bcYaml, pattern) {
  await withTempProject(async (projectDir) => {
    assert.strictEqual(runNode([CLI, 'init'], { cwd: projectDir }).status, 0);
    await writeTacticalInvalidArch(projectDir, bcYaml);

    const validateCli = path.join(projectDir, 'tools', 'dsl-validate', 'bin', 'dsl.js');
    const result = runNode([validateCli, 'validate'], { cwd: projectDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.doesNotMatch(output, pattern, output);
  });
}

// Writes a system.yaml with a parameterised infrastructure.objectStorage block (plus catalog
// and orders BCs) and a catalog.yaml, then runs the copied validator. Returns { status, output }.
async function runStorageValidation(projectDir, objectStorageYaml, bcYaml) {
  await writeYaml(path.join(projectDir, 'arch', 'system', 'system.yaml'), `
system:
  name: storage-system
  description: Object storage fixture system.
  domainType: core
boundedContexts:
  - name: catalog
    type: core
    purpose: Manages catalog data.
    aggregates:
      - name: Product
        root: Product
        entities: []
  - name: orders
    type: core
    purpose: Manages orders.
    aggregates:
      - name: Order
        root: Order
        entities: []
externalSystems: []
integrations: []
infrastructure:
  objectStorage:
${objectStorageYaml}
`);
  await writeYaml(path.join(projectDir, 'arch', 'catalog', 'catalog.yaml'), bcYaml);

  const validateCli = path.join(projectDir, 'tools', 'dsl-validate', 'bin', 'dsl.js');
  const result = runNode([validateCli, 'validate', '--bc', 'catalog'], { cwd: projectDir });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

const STORAGE_UPLOAD_BC = `
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
    domainMethods:
      - name: attachImage
        signature: "attachImage(image: StoredObject): void"
        returns: void
useCases:
  - id: UC-CAT-001
    name: UploadImage
    type: command
    actor: system
    aggregate: Product
    method: attachImage
    trigger:
      kind: event
      consumes: SomethingHappened
    input:
      - name: image
        type: File
        required: true
        source: multipart
        partName: image
    storageCalls:
      - store: %STORE%
        operation: %OP%
    implementation: scaffold
domainEvents:
  published: []
  consumed:
    - name: SomethingHappened
      sourceBc: orders
      listenerRequired: false
`;

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

test('dsl init generates Claude Code orchestrators as main-thread slash commands', async () => {
  await withTempProject(async (projectDir) => {
    const result = runNode([CLI, 'init'], { cwd: projectDir });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    // Orchestrators land in .claude/commands/ (main thread, AskUserQuestion can pause),
    // NOT in .claude/agents/ (subagents cannot use AskUserQuestion).
    const commandPath = path.join(projectDir, '.claude', 'commands', 'design-system.md');
    assert.ok(await fs.pathExists(commandPath), 'Expected .claude/commands/design-system.md');
    assert.ok(
      !(await fs.pathExists(path.join(projectDir, '.claude', 'agents'))),
      'Did not expect .claude/agents/ (orchestrators must be commands, not subagents)',
    );

    const command = await fs.readFile(commandPath, 'utf8');
    // Command frontmatter: no name, allowed-tools incl. AskUserQuestion, $ARGUMENTS injected.
    assert.ok(!/^name:/m.test(command), 'Command must not keep agent `name:` frontmatter');
    assert.ok(
      /^allowed-tools:.*AskUserQuestion/m.test(command),
      'Command must declare allowed-tools including AskUserQuestion',
    );
    assert.ok(command.includes('$ARGUMENTS'), 'Command must inject $ARGUMENTS');
    // The pause mechanism must point at the real interactive tool, not the dead text marker.
    assert.ok(!command.includes('vscode_askQuestions'), 'No leftover vscode_askQuestions in command');
    assert.ok(command.includes('AskUserQuestion'), 'Command must instruct calling AskUserQuestion');
    assert.ok(!command.includes('@design-system'), 'Invocation refs must be /command, not @agent');

    // Skills are transformed too (they carry the question templates).
    const skill = await fs.readFile(
      path.join(projectDir, '.claude', 'skills', 'ddd-step1-strategic-design', 'SKILL.md'),
      'utf8',
    );
    assert.ok(!skill.includes('vscode_askQuestions'), 'No leftover vscode_askQuestions in skill');
    assert.ok(skill.includes('AskUserQuestion'), 'Skill must reference AskUserQuestion');

    // Copilot path is left untouched: real vscode/askQuestions tool + @agent invocation.
    const copilotAgent = await fs.readFile(
      path.join(projectDir, '.github', 'agents', 'design-system.agent.md'),
      'utf8',
    );
    assert.ok(copilotAgent.includes('vscode_askQuestions'), 'Copilot agent must keep vscode_askQuestions');
    assert.ok(copilotAgent.includes('@design-bounded-context'), 'Copilot agent must keep @agent refs');
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

test('copied dsl-validate rejects enum transition triggeredBy arrays', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
enums:
  - name: ProductStatus
    values:
      - name: DRAFT
        transitions:
          - to: ACTIVE
            triggeredBy: [UC-CAT-001, UC-CAT-002]
      - name: ACTIVE
        terminal: true
domainEvents:
  published: []
  consumed: []
`, 'BC-008');
});

test('copied dsl-validate rejects enum values that are not valid Java identifiers', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
enums:
  - name: ProductStatus
    values:
      - name: DRAFT
      - name: pending-approval
domainEvents:
  published: []
  consumed: []
`, 'BC-006');
});

test('copied dsl-validate rejects a non-canonical Money value object shape', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
valueObjects:
  - name: Money
    properties:
      - name: value
        type: Decimal
        precision: 19
        scale: 4
      - name: currencyCode
        type: String(3)
domainEvents:
  published: []
  consumed: []
`, 'BC-073');
});

test('copied dsl-validate rejects circular value object references', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
valueObjects:
  - name: Foo
    properties:
      - name: bar
        type: Bar
  - name: Bar
    properties:
      - name: foo
        type: Foo
domainEvents:
  published: []
  consumed: []
`, 'BC-074');
});

test('copied dsl-validate rejects multipart contentTypes that are not valid MIME types', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
    domainMethods:
      - name: attachImage
        signature: "attachImage(image: StoredObject): void"
        returns: void
useCases:
  - id: UC-CAT-001
    name: UploadImage
    type: command
    actor: system
    aggregate: Product
    method: attachImage
    trigger:
      kind: event
      consumes: SomethingHappened
    input:
      - name: image
        type: File
        required: true
        source: multipart
        partName: image
        contentTypes:
          - 'image/png" , "*/*'
    implementation: scaffold
domainEvents:
  published: []
  consumed:
    - name: SomethingHappened
      sourceBc: orders
      listenerRequired: false
`, 'BC-024');
});

test('copied dsl-validate rejects multipart maxSize given as a raw byte integer', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
    domainMethods:
      - name: attachImage
        signature: "attachImage(image: StoredObject): void"
        returns: void
useCases:
  - id: UC-CAT-001
    name: UploadImage
    type: command
    actor: system
    aggregate: Product
    method: attachImage
    trigger:
      kind: event
      consumes: SomethingHappened
    input:
      - name: image
        type: File
        required: true
        source: multipart
        partName: image
        maxSize: 5242880
    implementation: scaffold
domainEvents:
  published: []
  consumed:
    - name: SomethingHappened
      sourceBc: orders
      listenerRequired: false
`, 'BC-024');
});

test('copied dsl-validate accepts multipart maxSize as a unit string (no false BC-024)', async () => {
  await assertTacticalValidationOmits(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
    domainMethods:
      - name: attachImage
        signature: "attachImage(image: StoredObject): void"
        returns: void
useCases:
  - id: UC-CAT-001
    name: UploadImage
    type: command
    actor: system
    aggregate: Product
    method: attachImage
    trigger:
      kind: event
      consumes: SomethingHappened
    input:
      - name: image
        type: File
        required: true
        source: multipart
        partName: image
        maxSize: "5MB"
    implementation: scaffold
domainEvents:
  published: []
  consumed:
    - name: SomethingHappened
      sourceBc: orders
      listenerRequired: false
`, /maxSize must be a size string/);
});

test('copied dsl-validate rejects a multipart part typed as a non-File/non-scalar/non-enum (shared superset)', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
    domainMethods:
      - name: attachImage
        signature: "attachImage(image: StoredObject): void"
        returns: void
useCases:
  - id: UC-CAT-001
    name: UploadImage
    type: command
    actor: system
    aggregate: Product
    method: attachImage
    trigger:
      kind: event
      consumes: SomethingHappened
    input:
      - name: meta
        type: SomeValueObject
        required: true
        source: multipart
    implementation: scaffold
domainEvents:
  published: []
  consumed:
    - name: SomethingHappened
      sourceBc: orders
      listenerRequired: false
`, 'BC-024');
});

test('copied dsl-validate accepts max on a Decimal input (shared superset, no false BC-025)', async () => {
  await assertTacticalValidationOmits(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
    domainMethods:
      - name: listProducts
        signature: "listProducts(minPrice: Decimal): List[Product]"
        returns: List[Product]
useCases:
  - id: UC-CAT-002
    name: ListProducts
    type: query
    actor: system
    aggregate: Product
    method: listProducts
    trigger:
      kind: http
      operationId: listProducts
    input:
      - name: minPrice
        type: Decimal
        required: false
        source: query
        max: 100000
    returns: List[Product]
    implementation: scaffold
domainEvents:
  published: []
  consumed: []
`, /declares max but type is not numeric/);
});

test('copied dsl-validate reports a malformed BC yaml as a counted error, not a silent skip', async () => {
  await withTempProject(async (projectDir) => {
    assert.strictEqual(runNode([CLI, 'init'], { cwd: projectDir }).status, 0);
    await writeValidArch(projectDir);
    // Overwrite catalog.yaml with syntactically invalid YAML (unclosed flow sequence).
    await writeYaml(path.join(projectDir, 'arch', 'catalog', 'catalog.yaml'), `
bc: catalog
type: core
description: Catalog BC.
domainEvents: [unclosed
`);
    const validateCli = path.join(projectDir, 'tools', 'dsl-validate', 'bin', 'dsl.js');
    const result = runNode([validateCli, 'validate'], { cwd: projectDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notStrictEqual(result.status, 0, output);
    assert.match(output, /Failed to load BC "catalog"/);
  });
});

test('copied dsl-validate rejects cacheable keyFields missing from useCase input', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
useCases:
  - id: UC-CAT-001
    name: GetProduct
    type: query
    aggregate: Product
    trigger:
      kind: http
      operationId: getProduct
    input:
      - name: productId
        type: Uuid
        source: path
    returns: Product?
    cacheable:
      ttl: PT5M
      keyFields: [missingField]
repositories:
  - aggregate: Product
    queryMethods:
      - name: getProduct
        params:
          - name: productId
            type: Uuid
        returns: Product?
        derivedFrom: openapi:getProduct
domainEvents:
  published: []
  consumed: []
`, 'BC-035');
});

test('copied dsl-validate rejects ownership.field missing from the aggregate', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
useCases:
  - id: UC-CAT-001
    name: GetProduct
    type: query
    aggregate: Product
    trigger:
      kind: http
      operationId: getProduct
    input:
      - name: productId
        type: Uuid
        source: path
    returns: Product?
    authorization:
      ownership:
        field: ownerId
        claim: sub
repositories:
  - aggregate: Product
    queryMethods:
      - name: getProduct
        params:
          - name: productId
            type: Uuid
        returns: Product?
        derivedFrom: openapi:getProduct
domainEvents:
  published: []
  consumed: []
`, 'BC-033');
});

test('copied dsl-validate rejects Range[T] over a non-comparable inner type', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
useCases:
  - id: UC-CAT-001
    name: SearchProducts
    type: query
    aggregate: Product
    trigger:
      kind: http
      operationId: searchProducts
    input:
      - name: activeRange
        type: Range[Boolean]
        source: query
    returns: Page[ProductResponse]
repositories:
  - aggregate: Product
    queryMethods:
      - name: search
        params:
          - name: page
            type: PageRequest
        returns: Page[Product]
        derivedFrom: openapi:searchProducts
domainEvents:
  published: []
  consumed: []
`, 'BC-090');
});

test('copied dsl-validate rejects a property name that is a Java reserved word', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
      - name: class
        type: String(100)
domainEvents:
  published: []
  consumed: []
`, 'BC-095');
});

test('copied dsl-validate rejects two property names that collide after case transformation', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
      - name: productName
        type: String(100)
      - name: product_name
        type: String(100)
domainEvents:
  published: []
  consumed: []
`, 'BC-096');
});

test('copied dsl-validate rejects a Decimal whose scale exceeds its precision', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
      - name: price
        type: Decimal
        precision: 5
        scale: 10
domainEvents:
  published: []
  consumed: []
`, 'BC-097');
});

test('copied dsl-validate rejects an unknown projection-level key', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
projections:
  - name: ProductSummary
    source: aggregate:Product
    persistant: true
    properties:
      - name: id
        type: Uuid
        required: true
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
domainEvents:
  published: []
  consumed: []
`, 'BC-012');
});

test('copied dsl-validate accepts a boolean-flag repository qualifier (no false BC-161)', async () => {
  await assertTacticalValidationOmits(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
      - name: ownerId
        type: Uuid
      - name: isActive
        type: Boolean
repositories:
  - aggregate: Product
    queryMethods:
      - name: countActiveByOwnerId
        params:
          - name: ownerId
            type: Uuid
        returns: Long
domainEvents:
  published: []
  consumed: []
`, /no status enum field/);
});

test('copied dsl-validate rejects repository query params missing from useCase input', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
      - name: ownerId
        type: Uuid
useCases:
  - id: UC-CAT-001
    name: ListMyProducts
    type: query
    aggregate: Product
    trigger:
      kind: http
      operationId: listMyProducts
    input: []
    returns: Page[ProductResponse]
repositories:
  - aggregate: Product
    queryMethods:
      - name: list
        params:
          - name: ownerId
            type: Uuid
          - name: page
            type: PageRequest
        returns: Page[Product]
        derivedFrom: openapi:listMyProducts
domainEvents:
  published: []
  consumed: []
`, 'BC-165');
});

test('copied dsl-validate rejects unsupported count qualifier repository methods', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
enums:
  - name: ProductStatus
    values:
      - value: DRAFT
      - value: ACTIVE
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
      - name: categoryId
        type: Uuid
      - name: status
        type: ProductStatus
    domainRules:
      - id: RULE-CAT-003
        type: sideEffect
repositories:
  - aggregate: Product
    methods:
      - name: countRetiredByCategoryId
        params:
          - name: categoryId
            type: Uuid
        returns: Long
        derivedFrom: RULE-CAT-003
domainEvents:
  published: []
  consumed: []
`, 'BC-161');
});

test('copied dsl-validate rejects unknown qualified find repository methods', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
enums:
  - name: CartStatus
    values:
      - value: ACTIVE
      - value: CHECKED_OUT
aggregates:
  - name: Cart
    properties:
      - name: id
        type: Uuid
      - name: customerId
        type: Uuid
      - name: status
        type: CartStatus
repositories:
  - aggregate: Cart
    queryMethods:
      - name: findArchivedByCustomerId
        params:
          - name: customerId
            type: Uuid
        returns: Cart?
        derivedFrom: implicit
domainEvents:
  published: []
  consumed: []
`, 'BC-161');
});

test('copied dsl-validate rejects unsupported search qualifier repository methods', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
enums:
  - name: ProductStatus
    values:
      - value: DRAFT
      - value: ACTIVE
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
      - name: status
        type: ProductStatus
repositories:
  - aggregate: Product
    queryMethods:
      - name: searchArchived
        params:
          - name: page
            type: PageRequest
        returns: Page[Product]
        derivedFrom: implicit
domainEvents:
  published: []
  consumed: []
`, 'BC-161');
});

test('copied dsl-validate rejects exists qualifier methods that do not return Boolean', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
enums:
  - name: ProductStatus
    values:
      - value: DRAFT
      - value: ACTIVE
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
      - name: status
        type: ProductStatus
repositories:
  - aggregate: Product
    methods:
      - name: existsActiveById
        params:
          - name: id
            type: Uuid
        returns: Product?
        derivedFrom: implicit
domainEvents:
  published: []
  consumed: []
`, 'BC-161');
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

test('copied dsl-validate rejects idempotency on event-triggered commands', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
domainEvents:
  published: []
  consumed:
    - name: ProductActivated
      sourceBc: products
useCases:
  - id: UC-CAT-001
    name: SyncProduct
    type: command
    trigger:
      kind: event
      event: ProductActivated
      channel: products.product.activated
    aggregate: ProductReadModel
    method: upsert
    implementation: scaffold
    idempotency:
      header: eventId
      ttl: PT24H
      storage: cache
`, 'BC-034');
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

test('copied dsl-validate rejects source param payloads missing from emitsList domainMethods', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
    domainMethods:
      - name: activate
        params: []
        returns: void
        emitsList: [ProductActivated]
domainEvents:
  published:
    - name: ProductActivated
      payload:
        - name: productId
          type: Uuid
          source: aggregate
          field: id
        - name: activatedBy
          type: Uuid
          source: param
  consumed: []
`, 'INT-026');
});

test('copied dsl-validate accepts source param payloads declared in signature', async () => {
  await withTempProject(async (projectDir) => {
    assert.strictEqual(runNode([CLI, 'init'], { cwd: projectDir }).status, 0);
    await writeTacticalInvalidArch(projectDir, `
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
    domainMethods:
      - name: activate
        signature: "activate(activatedBy: Uuid): void"
        returns: void
        emitsList: [ProductActivated]
domainEvents:
  published:
    - name: ProductActivated
      payload:
        - name: productId
          type: Uuid
          source: aggregate
          field: id
        - name: activatedBy
          type: Uuid
          source: param
  consumed: []
`);

    const validateCli = path.join(projectDir, 'tools', 'dsl-validate', 'bin', 'dsl.js');
    const result = runNode([validateCli, 'validate'], { cwd: projectDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.strictEqual(result.status, 0, output);
    assert.match(output, /All validations passed/);
  });
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

test('copied dsl-validate rejects storageCalls referencing an undeclared object store', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
aggregates:
  - name: Product
    properties:
      - name: id
        type: Uuid
    domainMethods:
      - name: attachImage
        signature: "attachImage(image: StoredObject): void"
        returns: void
useCases:
  - id: UC-CAT-001
    name: UploadImage
    type: command
    actor: system
    aggregate: Product
    method: attachImage
    trigger:
      kind: event
      consumes: SomethingHappened
    input:
      - name: image
        type: File
        required: true
        source: multipart
        partName: image
    storageCalls:
      - store: product-media
        operation: put
    implementation: scaffold
domainEvents:
  published: []
  consumed:
    - name: SomethingHappened
      sourceBc: orders
      listenerRequired: false
`, 'INT-028');
});

test('copied dsl-validate rejects storageCalls with an unsupported operation', async () => {
  await assertTacticalValidationFails(`
bc: catalog
type: core
description: Catalog BC.
useCases:
  - id: UC-CAT-001
    name: UploadImage
    type: command
    actor: system
    trigger:
      kind: event
      consumes: SomethingHappened
    storageCalls:
      - store: product-media
        operation: upsert
    implementation: scaffold
domainEvents:
  published: []
  consumed:
    - name: SomethingHappened
      sourceBc: orders
      listenerRequired: false
`, 'BC-028');
});

test('copied dsl-validate rejects signUrl against a public-url store', async () => {
  await withTempProject(async (projectDir) => {
    assert.strictEqual(runNode([CLI, 'init'], { cwd: projectDir }).status, 0);
    const { status, output } = await runStorageValidation(
      projectDir,
      `    - name: product-media
      visibility: public
      urlAccess: public-url
      ownedBy: catalog`,
      STORAGE_UPLOAD_BC.replace('%STORE%', 'product-media').replace('%OP%', 'signUrl'),
    );
    assert.notStrictEqual(status, 0, output);
    assert.match(output, /INT-029/);
  });
});

test('copied dsl-validate warns on cross-BC object storage access', async () => {
  await withTempProject(async (projectDir) => {
    assert.strictEqual(runNode([CLI, 'init'], { cwd: projectDir }).status, 0);
    const { output } = await runStorageValidation(
      projectDir,
      `    - name: order-receipts
      visibility: private
      urlAccess: signed-url
      ownedBy: orders`,
      STORAGE_UPLOAD_BC.replace('%STORE%', 'order-receipts').replace('%OP%', 'put'),
    );
    assert.match(output, /INT-031/);
  });
});

test('copied dsl-validate accepts a well-formed upload to a declared store', async () => {
  await withTempProject(async (projectDir) => {
    assert.strictEqual(runNode([CLI, 'init'], { cwd: projectDir }).status, 0);
    const { output } = await runStorageValidation(
      projectDir,
      `    - name: product-media
      visibility: public
      urlAccess: public-url
      ownedBy: catalog`,
      STORAGE_UPLOAD_BC.replace('%STORE%', 'product-media').replace('%OP%', 'put'),
    );
    assert.doesNotMatch(output, /INT-028|INT-029|INT-030|INT-031/);
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

test('dsl preview generates decision review assets without opening browser', async () => {
  await withTempProject(async (projectDir) => {
    await writeValidArch(projectDir);

    const result = runNode([CLI, 'preview', '--no-open', '--format', 'all', '--locale', 'es'], { cwd: projectDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.strictEqual(result.status, 0, output);

    const reviewDir = path.join(projectDir, 'arch', 'review');
    const indexHtml = await fs.readFile(path.join(reviewDir, 'index.html'), 'utf8');
    const bcReviewHtml = await fs.readFile(path.join(reviewDir, 'catalog-review.html'), 'utf8');
    const reviewModel = JSON.parse(await fs.readFile(path.join(reviewDir, 'review-model.json'), 'utf8'));
    const patchProposals = await fs.readFile(path.join(reviewDir, 'patch-proposals.yaml'), 'utf8');

    assert.match(indexHtml, /Revisi.n de dise.o/);
    assert.match(indexHtml, /Propuestas de ajuste/);
    assert.match(indexHtml, /data-locale="es"/);
    assert.match(bcReviewHtml, /Prompt para el agente/);
    assert.match(bcReviewHtml, /Use case topology/);
    assert.match(bcReviewHtml, /Catálogo de casos de uso/);
    assert.match(bcReviewHtml, /Seguridad de endpoints/);
    assert.ok(Array.isArray(reviewModel.decisions));
    assert.ok(reviewModel.decisions.length > 0);
    assert.ok(Array.isArray(reviewModel.sagas), 'review model exposes sagas');
    assert.match(patchProposals, /proposals:/);
  });
});

test('dsl preview renders the direct-integrations section per bounded context', async () => {
  await withTempProject(async (projectDir) => {
    await writeArchWithIntegrations(projectDir);

    const result = runNode([CLI, 'preview', '--no-open', '--format', 'all', '--locale', 'es'], { cwd: projectDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.strictEqual(result.status, 0, output);

    const reviewDir = path.join(projectDir, 'arch', 'review');
    const ordersHtml = await fs.readFile(path.join(reviewDir, 'orders-review.html'), 'utf8');
    const reviewModel = JSON.parse(await fs.readFile(path.join(reviewDir, 'review-model.json'), 'utf8'));

    // Section + context-map diagram are present.
    assert.match(ordersHtml, /Integraciones directas/);
    assert.match(ordersHtml, /Mapa de contexto/);
    assert.match(ordersHtml, /class="mermaid"/);
    assert.match(ordersHtml, /flowchart LR/);

    // Strategy badge, contracts and triggers surface the design intent.
    assert.match(ordersHtml, /customer-supplier/);
    assert.match(ordersHtml, /validateProductsAndPrices/);
    assert.match(ordersHtml, /UC-ORD-001/);

    // Rationale merges tactical description with strategic notes.
    assert.match(ordersHtml, /OWASP A04/);
    assert.match(ordersHtml, /authoritative prices/);

    // An integration with no description/notes is flagged as missing rationale.
    // Assert on the rendered marker (the data-i18n attribute and the row class),
    // not the plain text, which is also present in the embedded locale catalog.
    assert.match(ordersHtml, /data-i18n="int\.missingRationale"/);
    assert.match(ordersHtml, /<tr class="table-warning">/);

    // Review model exposes the structured integrations per BC.
    const orders = reviewModel.boundedContexts.find((bc) => bc.name === 'orders');
    assert.ok(orders && orders.integrations, 'orders BC exposes integrations');
    assert.ok(orders.integrations.outbound.length >= 1, 'orders has outbound integrations');
    assert.ok(orders.integrations.inbound.length >= 1, 'orders has inbound integrations');
    assert.ok(typeof orders.integrations.contextMap === 'string' && orders.integrations.contextMap.length > 0, 'context map is generated');
  });
});

test('dsl preview diagram page includes locale switcher and zoom controls', async () => {
  await withTempProject(async (projectDir) => {
    await writeArchWithDiagram(projectDir);

    const result = runNode([CLI, 'preview', '--no-open', '--locale', 'es'], { cwd: projectDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.strictEqual(result.status, 0, output);

    const designHtml = await fs.readFile(path.join(projectDir, 'arch', 'review', 'catalog-design.html'), 'utf8');
    assert.match(designHtml, /Vista general/);
    assert.match(designHtml, /data-zoom="in"/);
    assert.match(designHtml, /data-zoom="fit"/);
    assert.match(designHtml, /dslSetLocale\('en'\)/);
    assert.match(designHtml, /catalog-diagram\.mmd/);
    assert.match(designHtml, /diagram\.syntaxError/);
    assert.match(designHtml, /numberedSource/);
  });
});

test('dsl preview includes the dark-mode theme toggle and boot script', async () => {
  await withTempProject(async (projectDir) => {
    await writeValidArch(projectDir);

    const result = runNode([CLI, 'preview', '--no-open', '--format', 'all', '--locale', 'es'], { cwd: projectDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.strictEqual(result.status, 0, output);

    const indexHtml = await fs.readFile(path.join(projectDir, 'arch', 'review', 'index.html'), 'utf8');
    // Toggle button + runtime.
    assert.match(indexHtml, /data-theme-toggle/);
    assert.match(indexHtml, /dslToggleTheme\(\)/);
    // Persistence + applied attribute.
    assert.match(indexHtml, /dsl-preview-theme/);
    assert.match(indexHtml, /data-bs-theme/);
    // Anti-FOUC: theme resolved from OS preference before paint.
    assert.match(indexHtml, /prefers-color-scheme: dark/);
  });
});

test('dsl preview can generate English UI text', async () => {
  await withTempProject(async (projectDir) => {
    await writeValidArch(projectDir);

    const result = runNode([CLI, 'preview', '--no-open', '--locale', 'en'], { cwd: projectDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.strictEqual(result.status, 0, output);

    const indexHtml = await fs.readFile(path.join(projectDir, 'arch', 'review', 'index.html'), 'utf8');
    assert.match(indexHtml, /Design Review/);
    assert.match(indexHtml, /Patch proposals/);
    assert.match(indexHtml, /Decision Explorer/);
    assert.match(indexHtml, /data-locale="en"/);
  });
});

test('dsl preview strict exits non-zero when validations fail', async () => {
  await withTempProject(async (projectDir) => {
    await writeHttpOperationMissingArch(projectDir);

    const result = runNode([CLI, 'preview', '--no-open', '--strict'], { cwd: projectDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notStrictEqual(result.status, 0, output);
    assert.match(output, /Diagn.sticos:/);
    assert.ok(await fs.pathExists(path.join(projectDir, 'arch', 'review', 'index.html')));
  });
});

test('governance docs describe agent selection and validation workflow', async () => {
  const files = [
    path.join(ROOT, 'docs', 'agent-decision-guide.md'),
    path.join(ROOT, 'docs', 'workflow-reference.md'),
    path.join(ROOT, 'examples', 'README.md'),
    path.join(ROOT, 'AGENTS.md'),
    path.join(ROOT, 'README.md'),
  ];

  for (const file of files) {
    assert.ok(await fs.pathExists(file), `Expected ${file} to exist`);
  }

  const decisionGuide = await fs.readFile(path.join(ROOT, 'docs', 'agent-decision-guide.md'), 'utf8');
  assert.match(decisionGuide, /design-system/);
  assert.match(decisionGuide, /design-bounded-context/);
  assert.match(decisionGuide, /dsl validate/);
  assert.match(decisionGuide, /dsl preview/);
  assert.match(decisionGuide, /system\.yaml/);

  const workflowReference = await fs.readFile(path.join(ROOT, 'docs', 'workflow-reference.md'), 'utf8');
  assert.match(workflowReference, /Proyecto nuevo/);
  assert.match(workflowReference, /Handoff a Fase 2/);
  assert.match(workflowReference, /dsl preview --no-open --format all --locale es/);

  const agentsDoc = await fs.readFile(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agentsDoc, /Gobernanza operacional/);
  assert.match(agentsDoc, /docs\/agent-decision-guide\.md/);
  assert.match(agentsDoc, /docs\/workflow-reference\.md/);
});

test('canasta familiar example includes strategic and tactical artifacts', async () => {
  const expectedPaths = [
    path.join('arch', 'system', 'system.yaml'),
    path.join('arch', 'system', 'system-spec.md'),
    path.join('arch', 'system', 'system-diagram.mmd'),
    path.join('arch', 'catalog', 'catalog.yaml'),
    path.join('arch', 'catalog', 'catalog-open-api.yaml'),
    path.join('arch', 'catalog', 'catalog-async-api.yaml'),
    path.join('arch', 'catalog', 'diagrams', 'catalog-diagram.mmd'),
    path.join('arch', 'orders', 'orders.yaml'),
    path.join('arch', 'orders', 'orders-open-api.yaml'),
    path.join('arch', 'orders', 'orders-async-api.yaml'),
    path.join('arch', 'orders', 'diagrams', 'orders-diagram.mmd'),
  ];

  for (const rel of expectedPaths) {
    assert.ok(await fs.pathExists(path.join(CANASTA_EXAMPLE, rel)), `Expected example file ${rel}`);
  }

  const exampleReadme = await fs.readFile(path.join(ROOT, 'examples', 'README.md'), 'utf8');
  assert.match(exampleReadme, /canasta-familiar/);
  assert.match(exampleReadme, /catalog/);
  assert.match(exampleReadme, /orders/);
  assert.match(exampleReadme, /INT-007/);
});

test('canasta familiar example validates and previews as an incremental design', async () => {
  await withTempProject(async (projectDir) => {
    await copyCanastaExample(projectDir);

    const validateResult = runNode([CLI, 'validate'], { cwd: projectDir });
    const validateOutput = `${validateResult.stdout}\n${validateResult.stderr}`;
    assert.strictEqual(validateResult.status, 0, validateOutput);
    assert.match(validateOutput, /warning\(s\) found, no errors/);
    assert.match(validateOutput, /INT-007|INT-012|INT-014/);

    const previewResult = runNode([CLI, 'preview', '--no-open', '--format', 'all', '--locale', 'es'], { cwd: projectDir });
    const previewOutput = `${previewResult.stdout}\n${previewResult.stderr}`;
    assert.strictEqual(previewResult.status, 0, previewOutput);

    const reviewDir = path.join(projectDir, 'arch', 'review');
    assert.ok(await fs.pathExists(path.join(reviewDir, 'index.html')));
    assert.ok(await fs.pathExists(path.join(reviewDir, 'catalog-review.html')));
    assert.ok(await fs.pathExists(path.join(reviewDir, 'orders-review.html')));
    assert.ok(await fs.pathExists(path.join(reviewDir, 'review-model.json')));
    assert.ok(await fs.pathExists(path.join(reviewDir, 'decisions.html')), 'decision explorer page generated');

    // index shows the system saga flow (auto-generated Mermaid) and links the explorer
    const indexHtml = await fs.readFile(path.join(reviewDir, 'index.html'), 'utf8');
    assert.match(indexHtml, /Sagas del sistema/);
    assert.match(indexHtml, /Explorador de decisiones/);
    assert.match(indexHtml, /sequenceDiagram/);

    // per-BC review surfaces the actual decisions, not just counts
    const ordersReview = await fs.readFile(path.join(reviewDir, 'orders-review.html'), 'utf8');
    assert.match(ordersReview, /Catálogo de casos de uso/);
    assert.match(ordersReview, /Seguridad de endpoints/);
    assert.match(ordersReview, /Participación en sagas/);
    assert.match(ordersReview, /UC-ORD-020/);

    // decision explorer aggregates BCs with working filters
    const decisionsHtml = await fs.readFile(path.join(reviewDir, 'decisions.html'), 'utf8');
    assert.match(decisionsHtml, /id="filter-bc"/);
    assert.match(decisionsHtml, /id="filter-cat"/);
    assert.match(decisionsHtml, /explorer-block/);

    // review-model.json carries the structured detail for agent consumption
    const reviewModel = JSON.parse(await fs.readFile(path.join(reviewDir, 'review-model.json'), 'utf8'));
    assert.strictEqual(reviewModel.sagas[0].name, 'CheckoutSaga');
    const orders = reviewModel.boundedContexts.find((bc) => bc.name === 'orders');
    assert.ok(orders.useCaseCatalog.length > 0, 'orders use case catalog populated');
    assert.ok(orders.securityMatrix.length > 0, 'orders security matrix populated');
    const owned = orders.securityMatrix.find((entry) => entry.ownership);
    assert.ok(owned && owned.ownership.field && owned.ownership.claim, 'ownership field/claim extracted');
    const step3 = reviewModel.sagas[0].steps.find((step) => step.order === 3);
    assert.strictEqual(step3.implementedBy.id, 'UC-ORD-020', 'saga step resolved to implementing use case');
  });
});

test('dsl preview surfaces narrative, attention, traceability and iteration aids', async () => {
  await withTempProject(async (projectDir) => {
    await copyCanastaExample(projectDir);

    // First run establishes a baseline review model for the diff on the next run.
    let result = runNode([CLI, 'preview', '--no-open', '--format', 'all', '--locale', 'es'], { cwd: projectDir });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    // Second run should detect "no structural changes" since nothing changed.
    result = runNode([CLI, 'preview', '--no-open', '--format', 'all', '--locale', 'es'], { cwd: projectDir });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const reviewDir = path.join(projectDir, 'arch', 'review');
    const catalogReview = await fs.readFile(path.join(reviewDir, 'catalog-review.html'), 'utf8');
    const ordersReview = await fs.readFile(path.join(reviewDir, 'orders-review.html'), 'utf8');
    const indexHtml = await fs.readFile(path.join(reviewDir, 'index.html'), 'utf8');
    const reviewModel = JSON.parse(await fs.readFile(path.join(reviewDir, 'review-model.json'), 'utf8'));

    // Área 1 — plain-language narrative parsed from spec.md / flows.md.
    assert.match(catalogReview, /class="narrative-flow/, 'Given/When/Then flow blocks rendered');
    assert.match(catalogReview, /class="uc-detail-row"/, 'use case rows are expandable');
    assert.match(catalogReview, /Given/, 'flow narrative text present');

    // Área 2 — executive summary, attention panel and in-page navigation.
    assert.match(catalogReview, /casos de uso \(\d+ comandos/, 'executive summary sentence rendered');
    assert.match(catalogReview, /attention-card/, 'attention panel rendered');
    assert.match(catalogReview, /class="review-nav/, 'in-page side navigation rendered');

    // Área 3 — clickable traceability (links + review-model index).
    assert.match(ordersReview, /href="[a-z]+-review\.html#event-/, 'consumed events link to producer');
    assert.match(ordersReview, /id="event-orderplaced"/, 'published events carry anchors');
    assert.ok(reviewModel.traceability && reviewModel.traceability.useCases['UC-ORD-020'], 'traceability indexes use cases');
    assert.strictEqual(reviewModel.traceability.useCases['UC-ORD-020'].bc, 'orders');
    assert.ok(reviewModel.traceability.events['OrderPlaced'], 'traceability indexes published events');
    assert.strictEqual(reviewModel.traceability.events['OrderPlaced'].producer, 'orders');

    // Área 4 — iteration loop: proposals page, copy buttons, diff banner.
    assert.ok(await fs.pathExists(path.join(reviewDir, 'proposals.html')), 'proposals page generated');
    const proposalsHtml = await fs.readFile(path.join(reviewDir, 'proposals.html'), 'utf8');
    assert.match(proposalsHtml, /Propuestas de iteración/, 'proposals page titled');
    assert.match(proposalsHtml, /data-copy-target/, 'copy-to-clipboard controls present');
    assert.match(catalogReview, /class="btn btn-sm btn-outline-secondary copy-btn"/, 'decision cards expose copy buttons');
    assert.match(indexHtml, /data-i18n="diff\.title"/, 'dashboard shows changes-since-last-run banner');
    assert.match(indexHtml, /data-i18n="diff\.none"/, 'banner reports no structural changes on identical rerun');
    assert.match(indexHtml, /data-i18n="ui\.openProposals"/, 'dashboard links the proposals page');
  });
});

test('dsl preview narrative parser is dependency-free and id-keyed', () => {
  const { parseBcNarrative, renderMarkdown } = require(path.join(ROOT, 'src', 'utils', 'narrative.js'));
  const specMd = [
    '### UC-CAT-001: CreateCategory',
    '',
    '**Precondiciones**:',
    '- El `name` no existe.',
    '',
    '### UC-CAT-002: UpdateCategory',
    '',
    'Updates a category.',
  ].join('\n');
  const flowsMd = [
    '| UC | Nombre | Impl | Flujo(s) |',
    '|----|--------|------|----------|',
    '| UC-CAT-001 | CreateCategory | scaffold | FL-CAT-001 |',
    '',
    '### FL-CAT-001: CreateCategory — happy path',
    '',
    '**Given**:',
    '- nothing exists',
  ].join('\n');

  const narrative = parseBcNarrative(specMd, flowsMd);
  assert.ok(narrative.get('UC-CAT-001'), 'spec section keyed by id');
  assert.match(narrative.get('UC-CAT-001').spec.html, /<strong>Precondiciones<\/strong>/, 'markdown rendered to HTML');
  assert.strictEqual(narrative.get('UC-CAT-001').flows.length, 1, 'flow linked via coverage matrix');
  assert.strictEqual(narrative.get('UC-CAT-001').flows[0].id, 'FL-CAT-001');
  assert.match(renderMarkdown('plain `code` and **bold**'), /<code>code<\/code>.*<strong>bold<\/strong>/);
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

test('agent instructions protect framework AGENTS.md from overwrite', async () => {
  const files = [
    path.join(ROOT, 'src', 'agents', 'design-system.agent.md'),
    path.join(ROOT, 'src', 'skills', 'ddd-step1-strategic-design', 'SKILL.md'),
    path.join(ROOT, 'src', 'skills', 'ddd-step1-refine', 'SKILL.md'),
    path.join(ROOT, 'AGENTS.md'),
  ];

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    assert.match(text, /DSL Design System/, `${file} should identify framework AGENTS.md`);
    assert.match(text, /confirmaci[oó]n expl[ií]cita|no debe sobrescribirse/, `${file} should require explicit confirmation before overwrite`);
  }
});

test('tactical refine docs reject derived event payload source', async () => {
  const file = path.join(ROOT, 'src', 'skills', 'ddd-step2-refine', 'SKILL.md');
  const text = await fs.readFile(file, 'utf8');

  assert.match(text, /BC-121/);
  assert.match(text, /No usar `source: derived` en `domainEvents\[\]\.payload\[\]`/);
  assert.doesNotMatch(text, /`payload\[\]\.source`\*\* ∈ `\{aggregate, param, timestamp, constant, derived\}`/);
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
