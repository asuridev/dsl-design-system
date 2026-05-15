'use strict';

const {
  hasProhibitedType,
  isCanonicalType,
  stripTypeParameters,
  typeHead,
  unwrapCollection,
  unwrapEnum,
} = require('./canonical-types');

function validateBcYamlAnatomy(doc, options = {}) {
  const validator = new BcYamlValidator(doc || {}, options || {});
  return validator.run();
}

class BcYamlValidator {
  constructor(doc, options) {
    this.doc = doc;
    this.bc = doc.bc || '<unknown-bc>';
    this.systemActors = options.systemActors instanceof Set ? options.systemActors : null;
    this.diagnostics = [];
  }

  run() {
    this.validateDocumentHeader();
    this.validateEnums();
    this.validateUseCases();
    this.validateErrors();
    this.validateDomainRulesAndAggregates();
    this.validateValueObjects();
    this.validateProjections();
    this.validateEventDtos();
    this.validateUseCaseReferences();
    this.validateDomainMethodReferences();
    this.validateDomainEventPayloadMappings();
    this.validateDomainEvents();
    this.validateReadModels();
    this.validateRepositories();
    this.validateErrorOrphans();
    return this.diagnostics;
  }

  error(code, message, location) {
    this.diagnostics.push({ code, level: 'error', message, location: location || `${this.bc}.yaml` });
  }

  warn(code, message, location) {
    this.diagnostics.push({ code, level: 'warn', message, location: location || `${this.bc}.yaml` });
  }

  loc(pointer) {
    return `arch/${this.bc}/${this.bc}.yaml${pointer || ''}`;
  }

  validateDocumentHeader() {
    if (!this.doc.bc) {
      this.error('BC-001', 'BC yaml is missing required field "bc".', this.loc('#/bc'));
    }
    if (this.doc.bc && this.doc.bc !== this.bc) {
      this.error('BC-001', `BC yaml declares bc "${this.doc.bc}" but was loaded as "${this.bc}".`, this.loc('#/bc'));
    }
  }

  validateEnums() {
    const enums = asArray(this.doc.enums);
    this.assertUnique(enums, (enumDef) => enumDef && enumDef.name, 'BC-005', 'enum name', '#/enums');

    const allowedEnumKeys = new Set(['name', 'description', 'values']);
    const allowedValueKeys = new Set(['name', 'value', 'description', 'transitions', 'terminal']);
    const allowedTransitionKeys = new Set(['to', 'triggeredBy', 'condition', 'rules', 'emits']);

    for (let i = 0; i < enums.length; i++) {
      const enumDef = enums[i];
      const enumLoc = this.loc(`#/enums/${i}`);
      if (!isMapping(enumDef)) {
        this.error('BC-005', 'enums[] contains a non-mapping entry.', enumLoc);
        continue;
      }
      this.checkAllowedKeys(enumDef, allowedEnumKeys, 'BC-012', `Enum "${enumDef.name || '<unnamed>'}"`, enumLoc);
      if (!enumDef.name) this.error('BC-005', 'An enums[] entry is missing required field "name".', `${enumLoc}/name`);
      if (!Array.isArray(enumDef.values) || enumDef.values.length === 0) {
        this.error('BC-005', `Enum "${enumDef.name || '<unnamed>'}" must declare a non-empty values[] list.`, `${enumLoc}/values`);
        continue;
      }

      const declaredValues = new Set();
      for (let j = 0; j < enumDef.values.length; j++) {
        const valueDef = enumDef.values[j];
        const valueLoc = `${enumLoc}/values/${j}`;
        if (!isMapping(valueDef)) {
          this.error('BC-006', `Enum "${enumDef.name}" values[] contains a non-mapping entry.`, valueLoc);
          continue;
        }
        this.checkAllowedKeys(valueDef, allowedValueKeys, 'BC-012', `Enum "${enumDef.name}" value`, valueLoc);
        const label = valueDef.value || valueDef.name;
        if (!label || typeof label !== 'string') {
          this.error('BC-006', `Enum "${enumDef.name}" has a value entry without string value/name.`, valueLoc);
          continue;
        }
        if (declaredValues.has(label)) this.error('BC-006', `Enum "${enumDef.name}" declares duplicate value "${label}".`, valueLoc);
        declaredValues.add(label);
      }

      for (let j = 0; j < enumDef.values.length; j++) {
        const valueDef = enumDef.values[j];
        if (!isMapping(valueDef)) continue;
        const from = valueDef.value || valueDef.name;
        const valueLoc = `${enumLoc}/values/${j}`;
        if (valueDef.transitions == null) continue;
        if (!Array.isArray(valueDef.transitions)) {
          this.error('BC-007', `Enum "${enumDef.name}" value "${from}" transitions must be a list.`, `${valueLoc}/transitions`);
          continue;
        }
        for (let k = 0; k < valueDef.transitions.length; k++) {
          const transition = valueDef.transitions[k];
          const transitionLoc = `${valueLoc}/transitions/${k}`;
          if (!isMapping(transition)) {
            this.error('BC-007', `Enum "${enumDef.name}" value "${from}" transition must be a mapping.`, transitionLoc);
            continue;
          }
          this.checkAllowedKeys(transition, allowedTransitionKeys, 'BC-012', `Enum "${enumDef.name}" transition`, transitionLoc);
          if (!transition.to || typeof transition.to !== 'string') {
            this.error('BC-007', `Enum "${enumDef.name}" value "${from}" transition requires string field "to".`, `${transitionLoc}/to`);
          } else if (!declaredValues.has(transition.to)) {
            this.error('BC-007', `Enum "${enumDef.name}" value "${from}" transition.to "${transition.to}" is not declared in values[].`, `${transitionLoc}/to`);
          }
          if (!transition.triggeredBy || typeof transition.triggeredBy !== 'string') {
            const actual = Array.isArray(transition.triggeredBy) ? 'array' : typeof transition.triggeredBy;
            this.error('BC-008', `Enum "${enumDef.name}" value "${from}" transition to "${transition.to || '<missing>'}" requires triggeredBy as a single string, not ${actual}. Repeat the transition when several use cases reach the same state.`, `${transitionLoc}/triggeredBy`);
          }
        }
      }
    }
  }

  validateUseCases() {
    const useCases = asArray(this.doc.useCases);
    this.assertUnique(useCases, (uc) => uc && uc.id, 'BC-010', 'use case id', '#/useCases');

    const allowedUcKeys = new Set([
      'id', 'name', 'type', 'actor', 'description', 'trigger', 'aggregate', 'method',
      'aggregates', 'steps', 'input', 'returns', 'rules', 'notFoundError', 'lookups',
      'fkValidations', 'implementation', 'emits', 'emitsList', 'pagination',
      'authorization', 'idempotency', 'cacheable', 'bulk', 'async', 'validations',
      'loadAggregate', 'public', 'notes', 'outgoingCalls', 'sagaStep',
    ]);
    const allowedTriggerKeys = new Set(['kind', 'operationId', 'event', 'channel', 'consumes', 'fromBc', 'filter']);
    const allowedInputKeys = new Set(['name', 'type', 'required', 'source', 'loadAggregate', 'headerName', 'default', 'max', 'partName', 'maxSize', 'contentTypes', 'fields']);
    const allowedInputSources = new Set(['body', 'path', 'query', 'authContext', 'header', 'multipart']);
    const allowedTypes = new Set(['command', 'query']);
    const allowedImplementations = new Set(['full', 'scaffold']);
    const allowedTriggerKinds = new Set(['http', 'event']);
    const allowedPaginationKeys = new Set(['defaultSize', 'maxSize', 'sortable', 'defaultSort']);
    const allowedDefaultSortKeys = new Set(['field', 'direction']);
    const allowedAuthKeys = new Set(['rolesAnyOf', 'permissionsAnyOf', 'scopesAnyOf', 'ownership']);
    const allowedOwnershipKeys = new Set(['field', 'claim', 'allowRoleBypass']);
    const allowedIdempotencyKeys = new Set(['header', 'ttl', 'storage']);
    const allowedCacheableKeys = new Set(['ttl', 'keyFields', 'cacheWhen']);
    const allowedBulkKeys = new Set(['itemType', 'maxItems', 'onItemError']);
    const allowedAsyncKeys = new Set(['mode', 'statusEndpoint']);
    const allowedStepKeys = new Set(['aggregate', 'method', 'onFailure']);
    const allowedOnFailureKeys = new Set(['compensate']);
    const allowedCompensateKeys = new Set(['aggregate', 'method']);
    const allowedFkKeys = new Set(['aggregate', 'param', 'error', 'notFoundError', 'bc', 'conditional']);
    const allowedLookupKeys = new Set(['param', 'aggregate', 'errorCode', 'nestedIn', 'description']);
    const allowedValidationKeys = new Set(['id', 'expression', 'errorCode', 'description']);

    for (let i = 0; i < useCases.length; i++) {
      const uc = useCases[i];
      const baseLoc = this.loc(`#/useCases/${i}`);
      if (!isMapping(uc)) {
        this.error('BC-011', 'useCases[] contains a non-mapping entry.', baseLoc);
        continue;
      }
      this.checkAllowedKeys(uc, allowedUcKeys, 'BC-012', `Use case "${uc.id || uc.name || '<unnamed>'}"`, baseLoc);
      if (!uc.id) this.error('BC-013', 'A useCases[] entry is missing required field "id".', `${baseLoc}/id`);
      if (!uc.name) this.error('BC-013', `Use case "${uc.id || '<unnamed>'}" is missing required field "name".`, `${baseLoc}/name`);
      if (!uc.type) this.error('BC-013', `Use case "${uc.id || '<unnamed>'}" is missing required field "type".`, `${baseLoc}/type`);
      if (uc.type && !allowedTypes.has(uc.type)) this.error('BC-014', `Use case "${uc.id}" has unsupported type "${uc.type}". Allowed: command, query.`, `${baseLoc}/type`);
      if (uc.implementation != null && !allowedImplementations.has(uc.implementation)) this.error('BC-014', `Use case "${uc.id}" has unsupported implementation "${uc.implementation}". Allowed: full, scaffold.`, `${baseLoc}/implementation`);

      if (uc.trigger != null) {
        if (!isMapping(uc.trigger)) {
          this.error('BC-015', `Use case "${uc.id}" has invalid trigger; expected a mapping.`, `${baseLoc}/trigger`);
        } else {
          this.checkAllowedKeys(uc.trigger, allowedTriggerKeys, 'BC-012', `Use case "${uc.id}" trigger`, `${baseLoc}/trigger`);
          if (uc.trigger.kind && !allowedTriggerKinds.has(uc.trigger.kind)) this.error('BC-014', `Use case "${uc.id}" trigger.kind "${uc.trigger.kind}" is not supported.`, `${baseLoc}/trigger/kind`);
          if (uc.trigger.kind === 'http' && !uc.trigger.operationId) this.error('BC-016', `Use case "${uc.id}" trigger.kind: http requires operationId.`, `${baseLoc}/trigger/operationId`);
          if (uc.trigger.kind === 'event') {
            if (uc.trigger.event != null && uc.trigger.consumes != null) this.error('BC-017', `Use case "${uc.id}" trigger declares both event and consumes. Use one.`, `${baseLoc}/trigger`);
            const eventName = uc.trigger.event || uc.trigger.consumes;
            if (!eventName || typeof eventName !== 'string') this.error('BC-016', `Use case "${uc.id}" trigger.kind: event requires consumes (or legacy event).`, `${baseLoc}/trigger/consumes`);
            if (uc.trigger.fromBc != null && typeof uc.trigger.fromBc !== 'string') this.error('BC-015', `Use case "${uc.id}" trigger.fromBc must be a string.`, `${baseLoc}/trigger/fromBc`);
            if (uc.trigger.filter != null && typeof uc.trigger.filter !== 'string') this.error('BC-015', `Use case "${uc.id}" trigger.filter must be a string.`, `${baseLoc}/trigger/filter`);
            if (uc.trigger.channel != null && typeof uc.trigger.channel !== 'string') this.error('BC-015', `Use case "${uc.id}" trigger.channel must be a string.`, `${baseLoc}/trigger/channel`);
          } else {
            for (const key of ['event', 'consumes', 'channel', 'fromBc', 'filter']) {
              if (uc.trigger[key] != null) this.error('BC-017', `Use case "${uc.id}" trigger.kind="${uc.trigger.kind}" declares event-only key "${key}".`, `${baseLoc}/trigger/${key}`);
            }
          }
        }
      }

      this.validateUseCaseInputs(uc, baseLoc, allowedInputKeys, allowedInputSources);
      this.validateUseCasePagination(uc, baseLoc, allowedPaginationKeys, allowedDefaultSortKeys);
      this.validateUseCaseAuthorization(uc, baseLoc, allowedAuthKeys, allowedOwnershipKeys);
      this.validateUseCaseIdempotency(uc, baseLoc, allowedIdempotencyKeys);
      this.validateUseCaseCacheable(uc, baseLoc, allowedCacheableKeys);
      this.validateUseCaseBulk(uc, baseLoc, allowedBulkKeys);
      this.validateUseCaseAsync(uc, baseLoc, allowedAsyncKeys);
      this.validateUseCaseMultiAggregate(uc, baseLoc, allowedStepKeys, allowedOnFailureKeys, allowedCompensateKeys);
      this.validateUseCaseFkLookupsValidations(uc, baseLoc, allowedFkKeys, allowedLookupKeys, allowedValidationKeys);
      this.validateUseCaseReturns(uc, baseLoc);

      if (this.systemActors && uc.actor && !this.systemActors.has(uc.actor)) {
        this.error('BC-018', `Use case "${uc.id}" actor "${uc.actor}" is not declared in system.yaml#/actors.`, `${baseLoc}/actor`);
      }
    }

    const ucNames = new Set(useCases.filter(isMapping).map((u) => u.name));
    for (let i = 0; i < useCases.length; i++) {
      const uc = useCases[i];
      if (!isMapping(uc) || !uc.bulk || !uc.bulk.itemType) continue;
      const item = useCases.find((u) => isMapping(u) && u.name === uc.bulk.itemType);
      if (!ucNames.has(uc.bulk.itemType)) this.error('BC-019', `Use case "${uc.id}" bulk.itemType "${uc.bulk.itemType}" does not match any use case name in this BC.`, this.loc(`#/useCases/${i}/bulk/itemType`));
      if (item && item.type !== 'command') this.error('BC-019', `Use case "${uc.id}" bulk.itemType "${uc.bulk.itemType}" must reference a command use case.`, this.loc(`#/useCases/${i}/bulk/itemType`));
      if (item && item.bulk) this.error('BC-019', `Use case "${uc.id}" bulk.itemType "${uc.bulk.itemType}" must not itself be a bulk wrapper.`, this.loc(`#/useCases/${i}/bulk/itemType`));
    }
  }

  validateUseCaseInputs(uc, baseLoc, allowedInputKeys, allowedInputSources) {
    if (uc.input == null) return;
    if (!Array.isArray(uc.input)) {
      this.error('BC-020', `Use case "${uc.id}" input must be a list.`, `${baseLoc}/input`);
      return;
    }
    for (let j = 0; j < uc.input.length; j++) {
      const input = uc.input[j];
      const loc = `${baseLoc}/input/${j}`;
      if (!isMapping(input)) {
        this.error('BC-020', `Use case "${uc.id}" input[] contains a non-mapping entry.`, loc);
        continue;
      }
      this.checkAllowedKeys(input, allowedInputKeys, 'BC-012', `Use case "${uc.id}" input "${input.name || '<unnamed>'}"`, loc);
      if (!input.name) this.error('BC-021', `Use case "${uc.id}" has an input without name.`, `${loc}/name`);
      if (!input.type) this.error('BC-021', `Use case "${uc.id}" input "${input.name || '<unnamed>'}" is missing required field type.`, `${loc}/type`);
      if (!input.source) this.error('BC-021', `Use case "${uc.id}" input "${input.name || '<unnamed>'}" is missing required field source.`, `${loc}/source`);
      if (input.source && !allowedInputSources.has(input.source)) this.error('BC-022', `Use case "${uc.id}" input "${input.name}" has unsupported source "${input.source}".`, `${loc}/source`);
      this.validateType(input.type, 'BC-090', `Use case "${uc.id}" input "${input.name}"`, `${loc}/type`);
      if (input.source === 'header' && (!input.headerName || typeof input.headerName !== 'string')) this.error('BC-023', `Use case "${uc.id}" input "${input.name}" declares source: header but is missing headerName.`, `${loc}/headerName`);
      if (input.headerName != null && input.source !== 'header') this.error('BC-023', `Use case "${uc.id}" input "${input.name}" declares headerName but source is not header.`, `${loc}/headerName`);
      if (input.source === 'multipart' && input.type !== 'File') this.error('BC-024', `Use case "${uc.id}" input "${input.name}" declares source: multipart but type is not File.`, `${loc}/type`);
      if (input.type === 'File' && input.source !== 'multipart') this.error('BC-024', `Use case "${uc.id}" input "${input.name}" has type File but source is not multipart.`, `${loc}/source`);
      for (const key of ['partName', 'maxSize', 'contentTypes']) {
        if (input[key] != null && input.source !== 'multipart') this.error('BC-024', `Use case "${uc.id}" input "${input.name}" declares ${key} but source is not multipart.`, `${loc}/${key}`);
      }
      if (input.max != null) {
        if (!Number.isInteger(input.max)) this.error('BC-025', `Use case "${uc.id}" input "${input.name}" max must be an integer.`, `${loc}/max`);
        if (!/^(Integer|Long|int|long|BigDecimal|Decimal)$/.test(String(input.type))) this.error('BC-025', `Use case "${uc.id}" input "${input.name}" declares max but type is not numeric.`, `${loc}/max`);
      }
      if (input.type === 'SearchText' && (!Array.isArray(input.fields) || input.fields.length === 0 || input.fields.some((f) => typeof f !== 'string' || !f.trim()))) {
        this.error('BC-026', `Use case "${uc.id}" input "${input.name}" type SearchText requires a non-empty fields list.`, `${loc}/fields`);
      }
      if (input.fields != null && input.type !== 'SearchText') this.error('BC-026', `Use case "${uc.id}" input "${input.name}" declares fields but type is not SearchText.`, `${loc}/fields`);
    }
    const hasMultipart = uc.input.some((i) => isMapping(i) && i.source === 'multipart');
    if (hasMultipart && uc.input.some((i) => isMapping(i) && i.source === 'body')) this.error('BC-024', `Use case "${uc.id}" mixes source: multipart with source: body.`, `${baseLoc}/input`);
  }

  validateUseCasePagination(uc, baseLoc, allowedPaginationKeys, allowedDefaultSortKeys) {
    if (uc.returns === 'BinaryStream' && uc.type !== 'query') this.error('BC-027', `Use case "${uc.id}" declares returns: BinaryStream but is not a query.`, `${baseLoc}/returns`);
    if (uc.pagination == null) return;
    if (!isMapping(uc.pagination)) {
      this.error('BC-030', `Use case "${uc.id}" pagination must be a mapping.`, `${baseLoc}/pagination`);
      return;
    }
    this.checkAllowedKeys(uc.pagination, allowedPaginationKeys, 'BC-012', `Use case "${uc.id}" pagination`, `${baseLoc}/pagination`);
    if (uc.pagination.defaultSize != null && (!Number.isInteger(uc.pagination.defaultSize) || uc.pagination.defaultSize <= 0)) this.error('BC-030', `Use case "${uc.id}" pagination.defaultSize must be a positive integer.`, `${baseLoc}/pagination/defaultSize`);
    if (uc.pagination.maxSize != null && (!Number.isInteger(uc.pagination.maxSize) || uc.pagination.maxSize <= 0)) this.error('BC-030', `Use case "${uc.id}" pagination.maxSize must be a positive integer.`, `${baseLoc}/pagination/maxSize`);
    if (uc.pagination.sortable != null && (!Array.isArray(uc.pagination.sortable) || uc.pagination.sortable.some((s) => typeof s !== 'string'))) this.error('BC-030', `Use case "${uc.id}" pagination.sortable must be an array of strings.`, `${baseLoc}/pagination/sortable`);
    if (uc.pagination.defaultSort != null) {
      if (!isMapping(uc.pagination.defaultSort)) {
        this.error('BC-030', `Use case "${uc.id}" pagination.defaultSort must be a mapping.`, `${baseLoc}/pagination/defaultSort`);
      } else {
        this.checkAllowedKeys(uc.pagination.defaultSort, allowedDefaultSortKeys, 'BC-012', `Use case "${uc.id}" pagination.defaultSort`, `${baseLoc}/pagination/defaultSort`);
        if (!uc.pagination.defaultSort.field || typeof uc.pagination.defaultSort.field !== 'string') this.error('BC-030', `Use case "${uc.id}" pagination.defaultSort.field is required.`, `${baseLoc}/pagination/defaultSort/field`);
        if (uc.pagination.defaultSort.direction != null && !['ASC', 'DESC'].includes(uc.pagination.defaultSort.direction)) this.error('BC-030', `Use case "${uc.id}" pagination.defaultSort.direction must be ASC or DESC.`, `${baseLoc}/pagination/defaultSort/direction`);
        if (Array.isArray(uc.pagination.sortable) && !uc.pagination.sortable.includes(uc.pagination.defaultSort.field)) this.error('BC-030', `Use case "${uc.id}" pagination.defaultSort.field must be present in pagination.sortable.`, `${baseLoc}/pagination/defaultSort/field`);
      }
    }
  }

  validateUseCaseAuthorization(uc, baseLoc, allowedAuthKeys, allowedOwnershipKeys) {
    if (uc.public != null && typeof uc.public !== 'boolean') this.error('BC-031', `Use case "${uc.id}" public must be a boolean.`, `${baseLoc}/public`);
    if (uc.public === true && uc.authorization != null) this.warn('BC-032', `Use case "${uc.id}" declares public: true with authorization; authorization will be ignored.`, `${baseLoc}/authorization`);
    if (uc.authorization == null) return;
    if (!isMapping(uc.authorization)) {
      this.error('BC-033', `Use case "${uc.id}" authorization must be a mapping.`, `${baseLoc}/authorization`);
      return;
    }
    this.checkAllowedKeys(uc.authorization, allowedAuthKeys, 'BC-012', `Use case "${uc.id}" authorization`, `${baseLoc}/authorization`);
    for (const key of ['rolesAnyOf', 'permissionsAnyOf', 'scopesAnyOf']) {
      if (uc.authorization[key] != null && (!Array.isArray(uc.authorization[key]) || uc.authorization[key].length === 0 || uc.authorization[key].some((v) => typeof v !== 'string' || !v.trim()))) {
        this.error('BC-033', `Use case "${uc.id}" authorization.${key} must be a non-empty array of strings.`, `${baseLoc}/authorization/${key}`);
      }
    }
    if (Array.isArray(uc.authorization.permissionsAnyOf) && uc.authorization.permissionsAnyOf.some((p) => p.startsWith('ROLE_'))) this.error('BC-033', `Use case "${uc.id}" permissionsAnyOf must not contain ROLE_ entries.`, `${baseLoc}/authorization/permissionsAnyOf`);
    if (Array.isArray(uc.authorization.scopesAnyOf) && uc.authorization.scopesAnyOf.some((s) => s.startsWith('SCOPE_'))) this.error('BC-033', `Use case "${uc.id}" scopesAnyOf must use bare scope names.`, `${baseLoc}/authorization/scopesAnyOf`);
    if (uc.authorization.ownership != null) {
      if (!isMapping(uc.authorization.ownership)) {
        this.error('BC-033', `Use case "${uc.id}" authorization.ownership must be a mapping.`, `${baseLoc}/authorization/ownership`);
      } else {
        this.checkAllowedKeys(uc.authorization.ownership, allowedOwnershipKeys, 'BC-012', `Use case "${uc.id}" authorization.ownership`, `${baseLoc}/authorization/ownership`);
        if (!uc.authorization.ownership.field || typeof uc.authorization.ownership.field !== 'string') this.error('BC-033', `Use case "${uc.id}" authorization.ownership.field is required.`, `${baseLoc}/authorization/ownership/field`);
        if (!uc.authorization.ownership.claim || typeof uc.authorization.ownership.claim !== 'string') this.error('BC-033', `Use case "${uc.id}" authorization.ownership.claim is required.`, `${baseLoc}/authorization/ownership/claim`);
      }
    }
  }

  validateUseCaseIdempotency(uc, baseLoc, allowedKeys) {
    if (uc.idempotency == null) return;
    if (!isMapping(uc.idempotency)) {
      this.error('BC-034', `Use case "${uc.id}" idempotency must be a mapping.`, `${baseLoc}/idempotency`);
      return;
    }
    this.checkAllowedKeys(uc.idempotency, allowedKeys, 'BC-012', `Use case "${uc.id}" idempotency`, `${baseLoc}/idempotency`);
    if (!uc.idempotency.header || typeof uc.idempotency.header !== 'string') this.error('BC-034', `Use case "${uc.id}" idempotency.header is required.`, `${baseLoc}/idempotency/header`);
    if (!uc.idempotency.ttl || typeof uc.idempotency.ttl !== 'string' || !/^P/.test(uc.idempotency.ttl)) this.error('BC-034', `Use case "${uc.id}" idempotency.ttl must be an ISO-8601 duration.`, `${baseLoc}/idempotency/ttl`);
    if (uc.idempotency.storage !== 'cache') this.error('BC-034', `Use case "${uc.id}" idempotency.storage must be cache.`, `${baseLoc}/idempotency/storage`);
    if (uc.type !== 'command') this.error('BC-034', `Use case "${uc.id}" declares idempotency but is not a command.`, `${baseLoc}/idempotency`);
    if (!uc.trigger || uc.trigger.kind !== 'http') {
      this.error('BC-034', `Use case "${uc.id}" declares idempotency but trigger.kind is "${uc.trigger && uc.trigger.kind || 'undefined'}". Idempotency is only supported on HTTP-triggered commands.`, `${baseLoc}/idempotency`);
    }
  }

  validateUseCaseCacheable(uc, baseLoc, allowedKeys) {
    if (uc.cacheable == null) return;
    if (!isMapping(uc.cacheable)) {
      this.error('BC-035', `Use case "${uc.id}" cacheable must be a mapping.`, `${baseLoc}/cacheable`);
      return;
    }
    this.checkAllowedKeys(uc.cacheable, allowedKeys, 'BC-012', `Use case "${uc.id}" cacheable`, `${baseLoc}/cacheable`);
    if (!uc.cacheable.ttl || typeof uc.cacheable.ttl !== 'string' || !/^P/.test(uc.cacheable.ttl)) this.error('BC-035', `Use case "${uc.id}" cacheable.ttl must be an ISO-8601 duration.`, `${baseLoc}/cacheable/ttl`);
    for (const key of ['keyFields', 'cacheWhen']) {
      if (uc.cacheable[key] != null && (!Array.isArray(uc.cacheable[key]) || uc.cacheable[key].length === 0 || uc.cacheable[key].some((f) => typeof f !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(f)))) {
        this.error('BC-035', `Use case "${uc.id}" cacheable.${key} must be a non-empty array of camelCase field names.`, `${baseLoc}/cacheable/${key}`);
      }
    }
    if (uc.type !== 'query') this.error('BC-035', `Use case "${uc.id}" declares cacheable but is not a query.`, `${baseLoc}/cacheable`);
  }

  validateUseCaseBulk(uc, baseLoc, allowedKeys) {
    if (uc.bulk == null) return;
    if (!isMapping(uc.bulk)) {
      this.error('BC-036', `Use case "${uc.id}" bulk must be a mapping.`, `${baseLoc}/bulk`);
      return;
    }
    this.checkAllowedKeys(uc.bulk, allowedKeys, 'BC-012', `Use case "${uc.id}" bulk`, `${baseLoc}/bulk`);
    if (!uc.bulk.itemType || typeof uc.bulk.itemType !== 'string') this.error('BC-036', `Use case "${uc.id}" bulk.itemType is required.`, `${baseLoc}/bulk/itemType`);
    if (uc.bulk.maxItems != null && (!Number.isInteger(uc.bulk.maxItems) || uc.bulk.maxItems <= 0)) this.error('BC-036', `Use case "${uc.id}" bulk.maxItems must be a positive integer.`, `${baseLoc}/bulk/maxItems`);
    if (uc.bulk.onItemError != null && !['continue', 'abort'].includes(uc.bulk.onItemError)) this.error('BC-036', `Use case "${uc.id}" bulk.onItemError must be continue or abort.`, `${baseLoc}/bulk/onItemError`);
    if (uc.type !== 'command') this.error('BC-036', `Use case "${uc.id}" declares bulk but is not a command.`, `${baseLoc}/bulk`);
    if (Array.isArray(uc.input) && uc.input.length > 0) this.error('BC-036', `Use case "${uc.id}" declares both bulk and input[].`, `${baseLoc}/input`);
  }

  validateUseCaseAsync(uc, baseLoc, allowedKeys) {
    if (uc.async == null) return;
    if (!isMapping(uc.async)) {
      this.error('BC-037', `Use case "${uc.id}" async must be a mapping.`, `${baseLoc}/async`);
      return;
    }
    this.checkAllowedKeys(uc.async, allowedKeys, 'BC-012', `Use case "${uc.id}" async`, `${baseLoc}/async`);
    if (!['jobTracking', 'fireAndForget'].includes(uc.async.mode)) this.error('BC-037', `Use case "${uc.id}" async.mode must be jobTracking or fireAndForget.`, `${baseLoc}/async/mode`);
    if (uc.async.statusEndpoint != null && typeof uc.async.statusEndpoint !== 'string') this.error('BC-037', `Use case "${uc.id}" async.statusEndpoint must be a string.`, `${baseLoc}/async/statusEndpoint`);
    if (uc.type !== 'command') this.error('BC-037', `Use case "${uc.id}" declares async but is not a command.`, `${baseLoc}/async`);
    if (uc.bulk) this.error('BC-037', `Use case "${uc.id}" declares both async and bulk.`, `${baseLoc}/async`);
  }

  validateUseCaseMultiAggregate(uc, baseLoc, allowedStepKeys, allowedOnFailureKeys, allowedCompensateKeys) {
    if (uc.aggregates == null && uc.steps == null) return;
    if (!Array.isArray(uc.aggregates) || uc.aggregates.length < 2) this.error('BC-038', `Use case "${uc.id}" aggregates must be a list of at least 2 aggregate names.`, `${baseLoc}/aggregates`);
    if (Array.isArray(uc.aggregates) && uc.aggregates.some((a) => typeof a !== 'string' || !a.trim())) this.error('BC-038', `Use case "${uc.id}" aggregates[] must contain only strings.`, `${baseLoc}/aggregates`);
    if (uc.aggregate || uc.method) this.error('BC-038', `Use case "${uc.id}" declares both aggregates and aggregate/method.`, baseLoc);
    if (uc.type !== 'command') this.error('BC-038', `Use case "${uc.id}" declares aggregates but is not a command.`, `${baseLoc}/aggregates`);
    if (uc.bulk || uc.async) this.error('BC-038', `Use case "${uc.id}" combines aggregates with bulk or async.`, `${baseLoc}/aggregates`);
    if (!Array.isArray(uc.steps) || uc.steps.length === 0) {
      this.error('BC-038', `Use case "${uc.id}" declares aggregates so steps is required.`, `${baseLoc}/steps`);
      return;
    }
    const declaredAggs = new Set(Array.isArray(uc.aggregates) ? uc.aggregates : []);
    for (let i = 0; i < uc.steps.length; i++) {
      const step = uc.steps[i];
      const loc = `${baseLoc}/steps/${i}`;
      if (!isMapping(step)) {
        this.error('BC-038', `Use case "${uc.id}" steps[] contains a non-mapping entry.`, loc);
        continue;
      }
      this.checkAllowedKeys(step, allowedStepKeys, 'BC-012', `Use case "${uc.id}" step`, loc);
      if (!step.aggregate || typeof step.aggregate !== 'string') this.error('BC-038', `Use case "${uc.id}" step is missing aggregate.`, `${loc}/aggregate`);
      if (step.aggregate && !declaredAggs.has(step.aggregate)) this.error('BC-038', `Use case "${uc.id}" step references aggregate "${step.aggregate}" outside aggregates[].`, `${loc}/aggregate`);
      if (!step.method || typeof step.method !== 'string') this.error('BC-038', `Use case "${uc.id}" step is missing method.`, `${loc}/method`);
      if (step.onFailure != null) {
        if (!isMapping(step.onFailure)) {
          this.error('BC-038', `Use case "${uc.id}" step.onFailure must be a mapping.`, `${loc}/onFailure`);
        } else {
          this.checkAllowedKeys(step.onFailure, allowedOnFailureKeys, 'BC-012', `Use case "${uc.id}" step.onFailure`, `${loc}/onFailure`);
          const comp = step.onFailure.compensate;
          if (!isMapping(comp)) {
            this.error('BC-038', `Use case "${uc.id}" step.onFailure.compensate must be a mapping.`, `${loc}/onFailure/compensate`);
          } else {
            this.checkAllowedKeys(comp, allowedCompensateKeys, 'BC-012', `Use case "${uc.id}" step.onFailure.compensate`, `${loc}/onFailure/compensate`);
            if (!comp.aggregate || !declaredAggs.has(comp.aggregate)) this.error('BC-038', `Use case "${uc.id}" compensate.aggregate must be one of this UC aggregates.`, `${loc}/onFailure/compensate/aggregate`);
            if (!comp.method || typeof comp.method !== 'string') this.error('BC-038', `Use case "${uc.id}" compensate.method is required.`, `${loc}/onFailure/compensate/method`);
          }
        }
      }
    }
  }

  validateUseCaseFkLookupsValidations(uc, baseLoc, allowedFkKeys, allowedLookupKeys, allowedValidationKeys) {
    if (uc.fkValidations != null) {
      if (!Array.isArray(uc.fkValidations)) this.error('BC-039', `Use case "${uc.id}" fkValidations must be a list.`, `${baseLoc}/fkValidations`);
      for (let i = 0; i < asArray(uc.fkValidations).length; i++) {
        const fk = uc.fkValidations[i];
        const loc = `${baseLoc}/fkValidations/${i}`;
        if (!isMapping(fk)) {
          this.error('BC-039', `Use case "${uc.id}" fkValidations[] contains a non-mapping entry.`, loc);
          continue;
        }
        this.checkAllowedKeys(fk, allowedFkKeys, 'BC-012', `Use case "${uc.id}" fkValidation`, loc);
      }
    }
    if (uc.lookups != null) {
      if (!Array.isArray(uc.lookups)) this.error('BC-040', `Use case "${uc.id}" lookups must be a list.`, `${baseLoc}/lookups`);
      if (uc.notFoundError != null) this.error('BC-040', `Use case "${uc.id}" declares both lookups and notFoundError.`, `${baseLoc}/lookups`);
      const seen = new Set();
      for (let i = 0; i < asArray(uc.lookups).length; i++) {
        const lookup = uc.lookups[i];
        const loc = `${baseLoc}/lookups/${i}`;
        if (!isMapping(lookup)) {
          this.error('BC-040', `Use case "${uc.id}" lookups[] contains a non-mapping entry.`, loc);
          continue;
        }
        this.checkAllowedKeys(lookup, allowedLookupKeys, 'BC-012', `Use case "${uc.id}" lookup`, loc);
        if (!lookup.param || typeof lookup.param !== 'string') this.error('BC-040', `Use case "${uc.id}" lookup is missing param.`, `${loc}/param`);
        if (!lookup.errorCode || typeof lookup.errorCode !== 'string') this.error('BC-040', `Use case "${uc.id}" lookup is missing errorCode.`, `${loc}/errorCode`);
        if (!lookup.aggregate && !lookup.nestedIn) this.error('BC-040', `Use case "${uc.id}" lookup must declare aggregate or nestedIn.`, loc);
        if (lookup.nestedIn && !/^[A-Z][A-Za-z0-9_]*\.[a-z][A-Za-z0-9_]*$/.test(lookup.nestedIn)) this.error('BC-040', `Use case "${uc.id}" lookup.nestedIn must be <Aggregate>.<collectionField>.`, `${loc}/nestedIn`);
        if (seen.has(lookup.param)) this.error('BC-040', `Use case "${uc.id}" lookups declares duplicate param "${lookup.param}".`, `${loc}/param`);
        seen.add(lookup.param);
      }
    }
    if (uc.validations != null) {
      if (!Array.isArray(uc.validations)) this.error('BC-041', `Use case "${uc.id}" validations must be a list.`, `${baseLoc}/validations`);
      const seen = new Set();
      for (let i = 0; i < asArray(uc.validations).length; i++) {
        const validation = uc.validations[i];
        const loc = `${baseLoc}/validations/${i}`;
        if (!isMapping(validation)) {
          this.error('BC-041', `Use case "${uc.id}" validations[] contains a non-mapping entry.`, loc);
          continue;
        }
        this.checkAllowedKeys(validation, allowedValidationKeys, 'BC-012', `Use case "${uc.id}" validation`, loc);
        if (!validation.id || typeof validation.id !== 'string') this.error('BC-041', `Use case "${uc.id}" validation is missing id.`, `${loc}/id`);
        if (seen.has(validation.id)) this.error('BC-041', `Use case "${uc.id}" validations declares duplicate id "${validation.id}".`, `${loc}/id`);
        seen.add(validation.id);
        if (!validation.expression || typeof validation.expression !== 'string') this.error('BC-041', `Use case "${uc.id}" validation "${validation.id}" is missing expression.`, `${loc}/expression`);
        if (!validation.errorCode || typeof validation.errorCode !== 'string') this.error('BC-041', `Use case "${uc.id}" validation "${validation.id}" is missing errorCode.`, `${loc}/errorCode`);
      }
    }
  }

  validateUseCaseReturns(uc, baseLoc) {
    if (Array.isArray(uc.returns)) {
      if (uc.returns.length === 0) this.error('BC-042', `Use case "${uc.id || uc.name}" declares an empty inline returns list.`, `${baseLoc}/returns`);
      for (let i = 0; i < uc.returns.length; i++) {
        const entry = uc.returns[i];
        if (!isMapping(entry) || !entry.name || !entry.type) this.error('BC-042', `Use case "${uc.id || uc.name}" has an invalid inline returns entry; each item must declare name and type.`, `${baseLoc}/returns/${i}`);
      }
      const projectionName = `${toPascalCase(uc.name)}Result`;
      if (asArray(this.doc.projections).some((p) => p && p.name === projectionName)) this.error('BC-042', `Cannot synthesize projection "${projectionName}" for use case "${uc.id || uc.name}" because it already exists.`, `${baseLoc}/returns`);
    }
    if (uc.bulk && uc.returns && uc.returns !== 'BulkResult') this.error('BC-043', `Use case "${uc.id}" declares bulk and returns "${uc.returns}"; bulk wrappers always return BulkResult.`, `${baseLoc}/returns`);
    if (uc.async && uc.async.mode === 'jobTracking' && uc.returns && uc.returns !== 'JobReference') this.error('BC-043', `Use case "${uc.id}" declares async.mode=jobTracking and returns "${uc.returns}"; expected JobReference.`, `${baseLoc}/returns`);
    if (uc.async && uc.async.mode === 'fireAndForget' && uc.returns) this.error('BC-043', `Use case "${uc.id}" declares async.mode=fireAndForget and returns a value.`, `${baseLoc}/returns`);
    if (uc.type === 'command' && uc.implementation === 'full' && uc.returns && uc.returns !== 'Void' && !uc.bulk && !(uc.async && uc.async.mode === 'jobTracking')) this.error('BC-044', `Use case "${uc.id}" declares implementation: full and returns "${uc.returns}", but command return mapping is not deterministic. Use implementation: scaffold or remove returns.`, `${baseLoc}/returns`);
  }

  validateErrors() {
    const errors = asArray(this.doc.errors);
    this.assertUnique(errors, (e) => e && e.code, 'BC-050', 'error code', '#/errors');
    const allowedKeys = new Set(['code', 'httpStatus', 'description', 'message', 'title', 'errorType', 'chainable', 'usedFor', 'messageTemplate', 'args', 'kind', 'triggeredBy']);
    const allowedStatuses = new Set([400, 401, 402, 403, 404, 408, 409, 412, 415, 422, 423, 429, 503, 504]);
    for (let i = 0; i < errors.length; i++) {
      const err = errors[i];
      const loc = this.loc(`#/errors/${i}`);
      if (!isMapping(err)) {
        this.error('BC-051', 'errors[] contains a non-mapping entry.', loc);
        continue;
      }
      this.checkAllowedKeys(err, allowedKeys, 'BC-012', `Error "${err.code || '<unnamed>'}"`, loc);
      if (!err.code) this.error('BC-052', 'An errors[] entry is missing code.', `${loc}/code`);
      if (err.httpStatus != null && !allowedStatuses.has(err.httpStatus)) this.error('BC-053', `Error "${err.code}" has unsupported httpStatus "${err.httpStatus}".`, `${loc}/httpStatus`);
      if (err.errorType != null && (typeof err.errorType !== 'string' || !/^[A-Z][A-Za-z0-9_]*$/.test(err.errorType))) this.error('BC-053', `Error "${err.code}" has invalid errorType.`, `${loc}/errorType`);
      if (err.chainable != null && typeof err.chainable !== 'boolean') this.error('BC-053', `Error "${err.code}" chainable must be boolean.`, `${loc}/chainable`);
      if (err.usedFor != null && !['auto', 'manual'].includes(err.usedFor)) this.error('BC-053', `Error "${err.code}" usedFor must be auto or manual.`, `${loc}/usedFor`);
      if (err.kind != null && !['business', 'infrastructure'].includes(err.kind)) this.error('BC-053', `Error "${err.code}" kind must be business or infrastructure.`, `${loc}/kind`);
      if (err.triggeredBy != null && err.kind !== 'infrastructure') this.error('BC-053', `Error "${err.code}" declares triggeredBy but kind is not infrastructure.`, `${loc}/triggeredBy`);
      if (err.args != null) this.validateErrorArgs(err, loc);
    }
  }

  validateErrorArgs(err, loc) {
    if (!Array.isArray(err.args)) {
      this.error('BC-054', `Error "${err.code}" args must be a list.`, `${loc}/args`);
      return;
    }
    const names = new Set();
    for (let i = 0; i < err.args.length; i++) {
      const arg = err.args[i];
      const argLoc = `${loc}/args/${i}`;
      if (!isMapping(arg) || !arg.name || !arg.type) {
        this.error('BC-054', `Error "${err.code}" args entry must declare name and type.`, argLoc);
        continue;
      }
      if (!/^[a-z][A-Za-z0-9_]*$/.test(arg.name)) this.error('BC-054', `Error "${err.code}" arg name "${arg.name}" must be camelCase.`, `${argLoc}/name`);
      if (names.has(arg.name)) this.error('BC-054', `Error "${err.code}" declares duplicate arg "${arg.name}".`, `${argLoc}/name`);
      names.add(arg.name);
    }
    if (err.args.length > 0 && !err.messageTemplate) this.error('BC-054', `Error "${err.code}" declares args but no messageTemplate.`, `${loc}/messageTemplate`);
  }

  validateDomainRulesAndAggregates() {
    const allowedRuleTypes = new Set(['uniqueness', 'statePrecondition', 'terminalState', 'sideEffect', 'deleteGuard', 'crossAggregateConstraint']);
    const allowedRuleKeys = new Set(['id', 'type', 'errorCode', 'description', 'appliesTo', 'targetAggregate', 'targetRepositoryMethod', 'field', 'expectedStatus', 'constraintName']);
    const requiringError = new Set(['uniqueness', 'statePrecondition', 'deleteGuard', 'crossAggregateConstraint']);
    const seenRuleIds = new Set();

    for (let i = 0; i < asArray(this.doc.aggregates).length; i++) {
      const agg = this.doc.aggregates[i];
      const aggLoc = this.loc(`#/aggregates/${i}`);
      if (!isMapping(agg)) continue;
      this.validateProperties(agg.properties, `aggregate ${agg.name}`, `${aggLoc}/properties`, { allowDomainTypes: true });
      for (let j = 0; j < asArray(agg.entities).length; j++) {
        const entity = agg.entities[j];
        const entLoc = `${aggLoc}/entities/${j}`;
        if (!isMapping(entity)) continue;
        this.validateProperties(entity.properties, `entity ${entity.name}`, `${entLoc}/properties`, { allowDomainTypes: true });
        if (entity.relationship !== undefined && !['composition', 'aggregation'].includes(entity.relationship)) this.error('BC-060', `entity "${entity.name}" in aggregate "${agg.name}" relationship must be composition or aggregation.`, `${entLoc}/relationship`);
        if (entity.cardinality !== undefined && !['oneToMany', 'oneToOne'].includes(entity.cardinality)) this.error('BC-060', `entity "${entity.name}" in aggregate "${agg.name}" cardinality must be oneToMany or oneToOne.`, `${entLoc}/cardinality`);
      }
      for (let j = 0; j < asArray(agg.domainRules).length; j++) {
        const rule = agg.domainRules[j];
        const loc = `${aggLoc}/domainRules/${j}`;
        if (!isMapping(rule)) {
          this.error('BC-061', `Aggregate "${agg.name}" has an invalid domainRule entry.`, loc);
          continue;
        }
        this.checkAllowedKeys(rule, allowedRuleKeys, 'BC-012', `domainRule "${rule.id || '<unnamed>'}"`, loc);
        if (!rule.id) this.error('BC-062', `Aggregate "${agg.name}" has a domainRule without id.`, `${loc}/id`);
        if (!rule.type) this.error('BC-062', `domainRule "${rule.id || '<unnamed>'}" is missing type.`, `${loc}/type`);
        if (rule.type && !allowedRuleTypes.has(rule.type)) this.error('BC-063', `domainRule "${rule.id}" has unsupported type "${rule.type}".`, `${loc}/type`);
        if (requiringError.has(rule.type) && !rule.errorCode) this.error('BC-064', `domainRule "${rule.id}" of type "${rule.type}" requires errorCode.`, `${loc}/errorCode`);
        if (rule.type === 'deleteGuard' && Boolean(rule.targetAggregate) !== Boolean(rule.targetRepositoryMethod)) this.error('BC-065', `domainRule "${rule.id}" deleteGuard targetAggregate and targetRepositoryMethod must be declared together.`, loc);
        if (rule.type === 'crossAggregateConstraint' && (rule.targetAggregate || rule.field || rule.expectedStatus) && (!rule.targetAggregate || !rule.field || !rule.expectedStatus)) this.error('BC-065', `domainRule "${rule.id}" crossAggregateConstraint targetAggregate, field and expectedStatus must be declared together.`, loc);
        if (rule.type === 'uniqueness' && rule.field) {
          const propNames = new Set([ ...asArray(agg.properties).map((p) => p && p.name), ...asArray(agg.entities).flatMap((e) => asArray(e && e.properties).map((p) => p && p.name)) ].filter(Boolean));
          if (!propNames.has(rule.field)) this.error('BC-066', `domainRule "${rule.id}" uniqueness field "${rule.field}" does not match any property of aggregate "${agg.name}".`, `${loc}/field`);
        }
        if (rule.constraintName != null) {
          if (rule.type !== 'uniqueness') this.error('BC-067', `domainRule "${rule.id}" constraintName is only allowed for type uniqueness.`, `${loc}/constraintName`);
          if (typeof rule.constraintName !== 'string' || !/^[a-z][a-z0-9_]*$/.test(rule.constraintName)) this.error('BC-067', `domainRule "${rule.id}" constraintName must be snake_case.`, `${loc}/constraintName`);
          if (!rule.field) this.error('BC-067', `domainRule "${rule.id}" constraintName requires field.`, `${loc}/field`);
        }
        if (rule.id) {
          if (seenRuleIds.has(rule.id)) this.error('BC-068', `Duplicate domainRule id "${rule.id}".`, `${loc}/id`);
          seenRuleIds.add(rule.id);
        }
      }
      this.validateDomainMethodParameters(agg, aggLoc);
    }
  }

  validateValueObjects() {
    const enumNames = this.enumNames();
    const voNames = this.valueObjectNames();
    const aggregateNames = this.aggregateNames();
    for (let i = 0; i < asArray(this.doc.valueObjects).length; i++) {
      const vo = this.doc.valueObjects[i];
      const loc = this.loc(`#/valueObjects/${i}`);
      if (!isMapping(vo)) continue;
      if (!vo.name) this.error('BC-070', 'A valueObject entry is missing name.', `${loc}/name`);
      if (!Array.isArray(vo.properties) || vo.properties.length === 0) this.error('BC-070', `Value object "${vo.name}" must declare at least one property.`, `${loc}/properties`);
      this.validateProperties(vo.properties, `valueObject ${vo.name}`, `${loc}/properties`);
      for (let j = 0; j < asArray(vo.properties).length; j++) {
        const prop = vo.properties[j];
        if (!isMapping(prop) || !prop.type) continue;
        const result = this.resolveType(prop.type, { enumNames, voNames });
        if (result.aggregate && aggregateNames.has(result.aggregate)) this.error('BC-071', `Value object "${vo.name}" property "${prop.name}" references aggregate "${result.aggregate}". Use a Uuid reference or another VO.`, `${loc}/properties/${j}/type`);
        if (!result.resolved) this.error('BC-071', `Value object "${vo.name}" property "${prop.name}" has unresolved type "${prop.type}".`, `${loc}/properties/${j}/type`);
      }
    }
  }

  validateProjections() {
    const enumNames = this.enumNames();
    const voNames = this.valueObjectNames();
    const aggregateNames = this.aggregateNames();
    const projectionNames = new Set();
    const allowedPropKeys = new Set(['name', 'type', 'required', 'description', 'example', 'serializedName', 'derivedFrom', 'precision', 'scale']);
    for (let i = 0; i < asArray(this.doc.projections).length; i++) {
      const projection = this.doc.projections[i];
      const loc = this.loc(`#/projections/${i}`);
      if (!isMapping(projection)) continue;
      if (!projection.name) this.error('BC-080', 'A projection entry is missing name.', `${loc}/name`);
      if (projection.name && projectionNames.has(projection.name)) this.error('BC-080', `Duplicate projection name "${projection.name}".`, `${loc}/name`);
      projectionNames.add(projection.name);
      if (projection.name && /(Dto|Response|Request|Payload)$/.test(projection.name)) this.error('BC-081', `Projection "${projection.name}" uses a reserved suffix.`, `${loc}/name`);
      if (!Array.isArray(projection.properties) || projection.properties.length === 0) this.error('BC-080', `Projection "${projection.name}" must declare at least one property.`, `${loc}/properties`);
      if (projection.source != null && !projection.persistent && (typeof projection.source !== 'string' || !/^(aggregate|readModel):[A-Z][A-Za-z0-9_]*$/.test(projection.source))) this.error('BC-082', `Projection "${projection.name}" has invalid source value.`, `${loc}/source`);
      this.validateProjectionAdditionalSources(projection, loc);
      this.validateProperties(projection.properties, `projection ${projection.name}`, `${loc}/properties`, { allowedPropKeys });
      for (let j = 0; j < asArray(projection.properties).length; j++) {
        const prop = projection.properties[j];
        if (!isMapping(prop) || !prop.type) continue;
        const result = this.resolveType(prop.type, { enumNames, voNames, projectionNames });
        if (result.aggregate && aggregateNames.has(result.aggregate)) this.error('BC-083', `Projection "${projection.name}" property "${prop.name}" references aggregate "${result.aggregate}". Use its identifier or compose another projection.`, `${loc}/properties/${j}/type`);
        if (!result.resolved) this.error('BC-083', `Projection "${projection.name}" property "${prop.name}" has unresolved type "${prop.type}".`, `${loc}/properties/${j}/type`);
      }
    }
  }

  validateProjectionAdditionalSources(projection, loc) {
    if (projection.additionalSources == null) return;
    if (!projection.persistent) this.error('BC-084', `Projection "${projection.name}" declares additionalSources but is not persistent.`, `${loc}/additionalSources`);
    if (!Array.isArray(projection.additionalSources) || projection.additionalSources.length === 0) {
      this.error('BC-084', `Projection "${projection.name}" additionalSources must be a non-empty array.`, `${loc}/additionalSources`);
      return;
    }
    const propNames = new Set(asArray(projection.properties).map((p) => p && p.name));
    for (let i = 0; i < projection.additionalSources.length; i++) {
      const source = projection.additionalSources[i];
      const sourceLoc = `${loc}/additionalSources/${i}`;
      if (!isMapping(source)) {
        this.error('BC-084', `Projection "${projection.name}" additionalSources[${i}] must be a mapping.`, sourceLoc);
        continue;
      }
      if (source.kind !== 'event') this.error('BC-084', `Projection "${projection.name}" additionalSources[${i}].kind must be event.`, `${sourceLoc}/kind`);
      if (!source.event || typeof source.event !== 'string') this.error('BC-084', `Projection "${projection.name}" additionalSources[${i}].event is required.`, `${sourceLoc}/event`);
      if (!source.from || typeof source.from !== 'string') this.error('BC-084', `Projection "${projection.name}" additionalSources[${i}].from is required.`, `${sourceLoc}/from`);
      if (!Array.isArray(source.updatesFields) || source.updatesFields.length === 0) this.error('BC-084', `Projection "${projection.name}" additionalSources[${i}].updatesFields is required.`, `${sourceLoc}/updatesFields`);
      for (const field of asArray(source.updatesFields)) {
        if (field === projection.keyBy) this.error('BC-084', `Projection "${projection.name}" updatesFields cannot include keyBy field "${projection.keyBy}".`, `${sourceLoc}/updatesFields`);
        if (!propNames.has(field)) this.error('BC-084', `Projection "${projection.name}" updatesFields references unknown property "${field}".`, `${sourceLoc}/updatesFields`);
      }
    }
  }

  validateEventDtos() {
    const enumNames = this.enumNames();
    const voNames = this.valueObjectNames();
    const eventDtoNames = new Set();
    const allowedDtoKeys = new Set(['name', 'sourceBc', 'properties']);
    const allowedPropKeys = new Set(['name', 'type', 'precision', 'scale', 'required', 'description']);
    for (let i = 0; i < asArray(this.doc.eventDtos).length; i++) {
      const dto = this.doc.eventDtos[i];
      const loc = this.loc(`#/eventDtos/${i}`);
      if (!isMapping(dto)) continue;
      this.checkAllowedKeys(dto, allowedDtoKeys, 'BC-012', `eventDtos "${dto.name || '<unnamed>'}"`, loc);
      if (!dto.name) this.error('BC-085', 'An eventDtos[] entry is missing name.', `${loc}/name`);
      if (dto.name && eventDtoNames.has(dto.name)) this.error('BC-085', `Duplicate eventDtos name "${dto.name}".`, `${loc}/name`);
      eventDtoNames.add(dto.name);
      if (!Array.isArray(dto.properties) || dto.properties.length === 0) this.error('BC-085', `eventDtos "${dto.name}" must declare at least one property.`, `${loc}/properties`);
      this.validateProperties(dto.properties, `eventDtos ${dto.name}`, `${loc}/properties`, { allowedPropKeys });
      for (let j = 0; j < asArray(dto.properties).length; j++) {
        const prop = dto.properties[j];
        if (!isMapping(prop) || !prop.type) continue;
        const result = this.resolveType(prop.type, { enumNames, voNames, eventDtoNames });
        if (!result.resolved) this.error('BC-086', `eventDtos "${dto.name}" property "${prop.name}" has unresolved type "${prop.type}".`, `${loc}/properties/${j}/type`);
      }
    }
  }

  validateUseCaseReferences() {
    const ruleIds = this.ruleIds();
    const errorCodes = this.errorCodes();
    const publishedEventNames = this.publishedEventNames();
    const consumedEventNames = this.consumedEventNames();
    const aggByName = this.aggregateByName();

    for (let i = 0; i < asArray(this.doc.useCases).length; i++) {
      const uc = this.doc.useCases[i];
      if (!isMapping(uc)) continue;
      const loc = this.loc(`#/useCases/${i}`);
      for (const ruleId of asArray(uc.rules)) {
        if (!ruleIds.has(ruleId)) this.error('BC-100', `Use case "${uc.id}" references unknown rule "${ruleId}".`, `${loc}/rules`);
      }
      for (const code of normalizeList(uc.notFoundError)) {
        if (!errorCodes.has(code)) this.error('BC-101', `Use case "${uc.id}" notFoundError "${code}" not found in errors[].`, `${loc}/notFoundError`);
      }
      for (let j = 0; j < asArray(uc.lookups).length; j++) {
        const lookup = uc.lookups[j];
        if (lookup && lookup.errorCode && !errorCodes.has(lookup.errorCode)) this.error('BC-101', `Use case "${uc.id}" lookup errorCode "${lookup.errorCode}" not found in errors[].`, `${loc}/lookups/${j}/errorCode`);
      }
      for (let j = 0; j < asArray(uc.fkValidations).length; j++) {
        const fk = uc.fkValidations[j];
        const code = fk && (fk.error || fk.notFoundError);
        if (code && !errorCodes.has(code)) this.error('BC-101', `Use case "${uc.id}" fkValidation error "${code}" not found in errors[].`, `${loc}/fkValidations/${j}`);
      }
      for (let j = 0; j < asArray(uc.validations).length; j++) {
        const validation = uc.validations[j];
        if (validation && validation.errorCode && !errorCodes.has(validation.errorCode)) this.error('BC-101', `Use case "${uc.id}" validation errorCode "${validation.errorCode}" not found in errors[].`, `${loc}/validations/${j}/errorCode`);
      }
      for (const eventName of normalizeList(uc.emits)) {
        if (!publishedEventNames.has(eventName)) this.error('BC-102', `Use case "${uc.id}" emits "${eventName}" which is not declared in domainEvents.published[].`, `${loc}/emits`);
      }
      if (uc.type === 'command' && uc.method) {
        const agg = aggByName.get(uc.aggregate);
        if (agg && agg.readModel !== true && uc.method !== 'delete') {
          const method = asArray(agg.domainMethods).find((dm) => dm && dm.name === uc.method);
          if (!method) this.error('BC-103', `Use case "${uc.id}" references method "${uc.method}" which is not declared in aggregate "${agg.name}" domainMethods.`, `${loc}/method`);
        }
      }
      if (uc.trigger && uc.trigger.kind === 'event') {
        const eventName = uc.trigger.event || uc.trigger.consumes;
        if (eventName && !publishedEventNames.has(eventName) && !consumedEventNames.has(eventName)) this.error('BC-104', `Use case "${uc.id}" event trigger references "${eventName}" which is not declared in domainEvents.consumed[] or domainEvents.published[].`, `${loc}/trigger/consumes`);
      }
      this.validateSearchTextFields(uc, loc, aggByName);
      this.validateMultiAggregateReferences(uc, loc, aggByName);
      if (uc.type === 'query' && uc.trigger && uc.trigger.kind === 'http' && !uc.returns) this.error('BC-105', `Use case "${uc.id}" is a HTTP query but is missing returns.`, `${loc}/returns`);
    }
  }

  validateSearchTextFields(uc, loc, aggByName) {
    if (!Array.isArray(uc.input)) return;
    const aggName = uc.aggregate || (Array.isArray(uc.aggregates) ? uc.aggregates[0] : null);
    const agg = aggByName.get(aggName);
    if (!agg) return;
    const propNames = new Set(asArray(agg.properties).map((p) => p && p.name));
    for (let i = 0; i < uc.input.length; i++) {
      const input = uc.input[i];
      if (!input || input.type !== 'SearchText' || !Array.isArray(input.fields)) continue;
      for (const field of input.fields) {
        if (!propNames.has(field)) this.error('BC-106', `Use case "${uc.id}" SearchText input "${input.name}" references unknown aggregate property "${field}".`, `${loc}/input/${i}/fields`);
      }
    }
  }

  validateMultiAggregateReferences(uc, loc, aggByName) {
    if (!Array.isArray(uc.aggregates) || uc.aggregates.length < 2) return;
    for (const aggName of uc.aggregates) {
      if (!aggByName.has(aggName)) this.error('BC-107', `Use case "${uc.id}" references aggregate "${aggName}" in aggregates[] which is not declared in this BC.`, `${loc}/aggregates`);
    }
    for (let i = 0; i < asArray(uc.steps).length; i++) {
      const step = uc.steps[i];
      if (!step) continue;
      const agg = aggByName.get(step.aggregate);
      if (agg && !asArray(agg.domainMethods).some((m) => m && m.name === step.method)) this.error('BC-107', `Use case "${uc.id}" step references method "${step.method}" which is not declared in aggregate "${agg.name}" domainMethods.`, `${loc}/steps/${i}/method`);
      if (step.onFailure && step.onFailure.compensate) {
        const comp = step.onFailure.compensate;
        const compAgg = aggByName.get(comp.aggregate);
        if (compAgg && !asArray(compAgg.domainMethods).some((m) => m && m.name === comp.method)) this.error('BC-107', `Use case "${uc.id}" compensation references method "${comp.method}" which is not declared in aggregate "${compAgg.name}" domainMethods.`, `${loc}/steps/${i}/onFailure/compensate/method`);
      }
    }
  }

  validateDomainMethodReferences() {
    const errorCodes = this.errorCodes();
    const publishedEventNames = this.publishedEventNames();
    for (let i = 0; i < asArray(this.doc.aggregates).length; i++) {
      const agg = this.doc.aggregates[i];
      if (!isMapping(agg)) continue;
      const aggLoc = this.loc(`#/aggregates/${i}`);
      for (let j = 0; j < asArray(agg.domainRules).length; j++) {
        const rule = agg.domainRules[j];
        if (rule && rule.errorCode && !errorCodes.has(rule.errorCode)) this.error('BC-101', `domainRule "${rule.id}" errorCode "${rule.errorCode}" not found in errors[].`, `${aggLoc}/domainRules/${j}/errorCode`);
      }
      for (let j = 0; j < asArray(agg.domainMethods).length; j++) {
        const dm = agg.domainMethods[j];
        const loc = `${aggLoc}/domainMethods/${j}`;
        if (!isMapping(dm)) continue;
        if (dm.name === 'create' && dm.returns !== agg.name) this.error('BC-110', `domainMethod "create" in aggregate "${agg.name}" must have returns: ${agg.name}.`, `${loc}/returns`);
        const seen = new Set();
        for (const eventName of normalizeList(dm.emits)) {
          if (seen.has(eventName)) this.error('BC-102', `domainMethod "${dm.name}" in aggregate "${agg.name}" declares duplicate emits entry "${eventName}".`, `${loc}/emits`);
          seen.add(eventName);
          if (!publishedEventNames.has(eventName)) this.error('BC-102', `domainMethod "${dm.name}" in aggregate "${agg.name}" emits "${eventName}" which is not declared in domainEvents.published[].`, `${loc}/emits`);
        }
      }
    }
  }

  validateDomainEventPayloadMappings() {
    const publishedByName = new Map(asArray(this.doc.domainEvents && this.doc.domainEvents.published).map((event) => [event && event.name, event]));
    for (let i = 0; i < asArray(this.doc.aggregates).length; i++) {
      const agg = this.doc.aggregates[i];
      if (!isMapping(agg)) continue;
      const propNames = new Set(asArray(agg.properties).map((p) => p && p.name));
      const aggregateCamelId = `${lowerFirst(agg.name)}Id`;
      for (let j = 0; j < asArray(agg.domainMethods).length; j++) {
        const dm = agg.domainMethods[j];
        if (!isMapping(dm)) continue;
        const paramNames = this.domainMethodParamNames(dm);
        for (const eventName of normalizeList(dm.emits)) {
          const event = publishedByName.get(eventName);
          if (!event) continue;
          for (let k = 0; k < asArray(event.payload).length; k++) {
            const payload = event.payload[k];
            const loc = this.loc(`#/domainEvents/published/${eventIndex(this.doc, eventName)}/payload/${k}`);
            if (!payload || !payload.name) continue;
            if (payload.source) {
              this.validateExplicitPayloadSource(payload, loc, agg, propNames, aggregateCamelId, paramNames, eventName, dm.name);
              continue;
            }
            const resolvable = payload.name === aggregateCamelId || propNames.has(payload.name) || paramNames.has(payload.name) || payload.type === 'DateTime' || payload.type === 'Instant';
            if (!resolvable) this.error('BC-120', `domainEvents.published "${eventName}" emitted by ${agg.name}.${dm.name} payload "${payload.name}" cannot be mapped deterministically. Declare source: aggregate, param, timestamp or constant.`, loc);
          }
        }
      }
    }
  }

  validateExplicitPayloadSource(payload, loc, agg, propNames, aggregateCamelId, paramNames, eventName, methodName) {
    const allowed = new Set(['aggregate', 'param', 'timestamp', 'constant']);
    if (!allowed.has(payload.source)) {
      this.error('BC-121', `domainEvents.published "${eventName}" emitted by ${agg.name}.${methodName} payload "${payload.name}" declares unsupported source "${payload.source}".`, `${loc}/source`);
      return;
    }
    if (payload.source === 'aggregate') {
      const field = payload.field || payload.name;
      if (field !== 'id' && field !== aggregateCamelId && !propNames.has(field)) this.error('BC-121', `payload "${payload.name}" declares source: aggregate field "${field}" but aggregate "${agg.name}" has no such property.`, `${loc}/field`);
    }
    if (payload.source === 'param') {
      const paramName = payload.param || payload.name;
      if (!paramNames.has(paramName)) this.error('BC-121', `payload "${payload.name}" declares source: param "${paramName}" but the emitting domainMethod has no such parameter.`, `${loc}/param`);
    }
    if (payload.source === 'constant' && (payload.value === undefined || payload.value === null)) this.error('BC-121', `payload "${payload.name}" declares source: constant but is missing value.`, `${loc}/value`);
  }

  validateDomainEvents() {
    const allowedScopes = new Set(['internal', 'integration', 'both']);
    const allowedBrokerKeys = new Set(['partitionKey', 'headers', 'retry', 'dlq']);
    for (let i = 0; i < asArray(this.doc.domainEvents && this.doc.domainEvents.published).length; i++) {
      const event = this.doc.domainEvents.published[i];
      const loc = this.loc(`#/domainEvents/published/${i}`);
      if (!isMapping(event)) continue;
      if (event.scope != null && !allowedScopes.has(event.scope)) this.error('BC-130', `domainEvents.published "${event.name}" has unsupported scope "${event.scope}".`, `${loc}/scope`);
      if (event.broker != null) {
        if (!isMapping(event.broker)) {
          this.error('BC-131', `domainEvents.published "${event.name}" broker must be a mapping.`, `${loc}/broker`);
        } else {
          this.checkAllowedKeys(event.broker, allowedBrokerKeys, 'BC-012', `domainEvents.published "${event.name}" broker`, `${loc}/broker`);
          if (event.broker.partitionKey != null) {
            if (typeof event.broker.partitionKey !== 'string') this.error('BC-131', `domainEvents.published "${event.name}" broker.partitionKey must be a string.`, `${loc}/broker/partitionKey`);
            const fields = asArray(event.payload).map((p) => p && p.name);
            if (fields.length > 0 && !fields.includes(event.broker.partitionKey)) this.error('BC-131', `domainEvents.published "${event.name}" broker.partitionKey references a field not declared in payload.`, `${loc}/broker/partitionKey`);
          }
          if (event.broker.headers != null && !isMapping(event.broker.headers)) this.error('BC-131', `domainEvents.published "${event.name}" broker.headers must be a mapping.`, `${loc}/broker/headers`);
        }
      }
    }
    for (let i = 0; i < asArray(this.doc.domainEvents && this.doc.domainEvents.consumed).length; i++) {
      const event = this.doc.domainEvents.consumed[i];
      if (!isMapping(event)) continue;
      if (event.retry != null) this.warn('BC-132', `domainEvents.consumed "${event.name}" retry is ignored by the generator; configure retry in infrastructure settings.`, this.loc(`#/domainEvents/consumed/${i}/retry`));
      if (event.dlq != null) this.warn('BC-132', `domainEvents.consumed "${event.name}" dlq is ignored by the generator; configure DLQ in infrastructure settings.`, this.loc(`#/domainEvents/consumed/${i}/dlq`));
    }
  }

  validateReadModels() {
    for (let i = 0; i < asArray(this.doc.aggregates).length; i++) {
      const agg = this.doc.aggregates[i];
      if (!isMapping(agg) || !agg.readModel) continue;
      const loc = this.loc(`#/aggregates/${i}`);
      if (!agg.sourceBC) this.error('BC-140', `readModel aggregate "${agg.name}" must have sourceBC.`, `${loc}/sourceBC`);
      if (!Array.isArray(agg.sourceEvents) || agg.sourceEvents.length === 0) this.error('BC-140', `readModel aggregate "${agg.name}" must have sourceEvents.`, `${loc}/sourceEvents`);
      for (let j = 0; j < asArray(this.doc.useCases).length; j++) {
        const uc = this.doc.useCases[j];
        if (uc && uc.aggregate === agg.name && uc.type === 'command' && (!uc.trigger || uc.trigger.kind !== 'event')) this.error('BC-141', `readModel aggregate "${agg.name}" command "${uc.id}" must have trigger.kind: event.`, this.loc(`#/useCases/${j}/trigger`));
      }
    }
  }

  validateRepositories() {
    const repositories = this.doc.repositories;
    if (repositories == null) return;
    if (!Array.isArray(repositories)) {
      this.error('BC-150', 'repositories must be a list of repository entries.', this.loc('#/repositories'));
      return;
    }
    const allowedRepoKeys = new Set(['aggregate', 'queryMethods', 'methods', 'bulkOperations', 'autoDerive', 'readModel']);
    const allowedMethodKeys = new Set(['name', 'params', 'returns', 'derivedFrom', 'signature', 'defaultSort', 'sortable', 'description']);
    const allowedParamKeys = new Set(['name', 'type', 'required', 'filterOn', 'operator']);
    const allowedOperators = new Set(['EQ', 'LIKE_CONTAINS', 'LIKE_STARTS', 'LIKE_ENDS', 'GTE', 'LTE', 'IN']);
    const aggregateNames = this.aggregateNames();
    const aggByName = this.aggregateByName();
    const ruleIds = this.ruleIds();
    const deleteGuardByAggregate = this.deleteGuardByAggregate();

    for (let i = 0; i < repositories.length; i++) {
      const repo = repositories[i];
      const loc = this.loc(`#/repositories/${i}`);
      if (!isMapping(repo)) {
        this.error('BC-151', 'repositories[] contains a non-mapping entry.', loc);
        continue;
      }
      this.checkAllowedKeys(repo, allowedRepoKeys, 'BC-012', `Repository entry for "${repo.aggregate || '<unnamed>'}"`, loc);
      if (!repo.aggregate) this.error('BC-152', 'A repositories[] entry is missing aggregate.', `${loc}/aggregate`);
      if (repo.aggregate && !aggregateNames.has(repo.aggregate)) this.error('BC-153', `Repository declares aggregate "${repo.aggregate}" but no aggregate with that name exists.`, `${loc}/aggregate`);
      const aggregate = aggByName.get(repo.aggregate);
      const allMethods = [
        ...asArray(repo.queryMethods).map((m) => ({ ...m, _section: 'queryMethods' })),
        ...asArray(repo.methods).map((m) => ({ ...m, _section: 'methods' })),
      ];
      const seenNames = new Set();
      for (const method of allMethods) {
        const methodName = method.name || parseSignatureName(method.signature);
        if (!methodName) this.error('BC-154', `Repository for "${repo.aggregate}" has a method without name or parsable signature.`, loc);
        if (seenNames.has(methodName)) this.error('BC-154', `Repository for "${repo.aggregate}" declares duplicate method "${methodName}".`, loc);
        seenNames.add(methodName);
      }
      if (aggregate && aggregate.readModel === true) {
        for (const method of allMethods) {
          if (method._section === 'methods' && ['save', 'delete', 'softDelete'].includes(method.name)) this.error('BC-155', `Repository for read-model aggregate "${repo.aggregate}" declares write method "${method.name}".`, loc);
        }
      }
      for (let j = 0; j < allMethods.length; j++) {
        const method = allMethods[j];
        const methodLoc = `${loc}/${method._section}/${j}`;
        this.validateRepositoryMethod(repo, aggregate, method, methodLoc, allowedMethodKeys, allowedParamKeys, allowedOperators, ruleIds);
        this.validateRepositoryMethodUseCaseInputs(repo, method, methodLoc);
      }
      const deleteMethod = asArray(repo.methods).find((m) => m && m.name === 'delete' && Array.isArray(m.params) && m.params.length === 1);
      if (deleteMethod && aggregate && aggregate.softDelete !== true) {
        const guards = deleteGuardByAggregate.get(repo.aggregate) || [];
        const referencesGuard = deleteMethod.derivedFrom && ruleIds.has(deleteMethod.derivedFrom) && guards.some((r) => r.id === deleteMethod.derivedFrom);
        if (!referencesGuard && guards.length === 0) this.error('BC-156', `Repository for "${repo.aggregate}" declares delete(id) but aggregate is not softDelete and no deleteGuard rule exists.`, `${loc}/methods`);
      }
    }

    this.validateQueryUseCasesHaveRepositoryMethods(repositories, aggregateNames);
  }

  validateRepositoryMethod(repo, aggregate, method, loc, allowedMethodKeys, allowedParamKeys, allowedOperators, ruleIds) {
    if (!isMapping(method)) return;
    this.checkAllowedKeys(method, allowedMethodKeys, 'BC-012', `repositories["${repo.aggregate}"].${method._section}`, loc);
    if (method.returns != null && !isAllowedRepositoryReturn(method.returns)) this.error('BC-157', `Repository method for "${repo.aggregate}" has unsupported returns "${method.returns}".`, `${loc}/returns`);
    if (method.defaultSort != null) {
      if (method._section !== 'queryMethods') this.error('BC-158', 'defaultSort is only allowed in queryMethods.', `${loc}/defaultSort`);
      if (!isMapping(method.defaultSort) || !method.defaultSort.field) this.error('BC-158', 'defaultSort must be an object with field.', `${loc}/defaultSort`);
      if (method.defaultSort && method.defaultSort.direction != null && !['ASC', 'DESC'].includes(String(method.defaultSort.direction).toUpperCase())) this.error('BC-158', 'defaultSort.direction must be ASC or DESC.', `${loc}/defaultSort/direction`);
      if (aggregate && method.defaultSort && method.defaultSort.field && !this.aggregateFieldNames(aggregate).has(method.defaultSort.field)) this.error('BC-158', `defaultSort.field "${method.defaultSort.field}" is not a known field of aggregate "${repo.aggregate}".`, `${loc}/defaultSort/field`);
    }
    if (method.sortable != null) {
      if (method._section !== 'queryMethods') this.error('BC-159', 'sortable is only allowed in queryMethods.', `${loc}/sortable`);
      if (!Array.isArray(method.sortable) || method.sortable.length === 0) this.error('BC-159', 'sortable must be a non-empty list.', `${loc}/sortable`);
      if (aggregate) {
        const fields = this.aggregateFieldNames(aggregate);
        for (const field of asArray(method.sortable)) if (!fields.has(field)) this.error('BC-159', `sortable lists unknown field "${field}" on aggregate "${repo.aggregate}".`, `${loc}/sortable`);
      }
    }
    if (method.params != null && !Array.isArray(method.params)) this.error('BC-160', 'Repository method params must be a list.', `${loc}/params`);
    for (let i = 0; i < asArray(method.params).length; i++) {
      const param = method.params[i];
      const paramLoc = `${loc}/params/${i}`;
      if (!isMapping(param)) continue;
      if ('name' in param || 'type' in param) {
        this.checkAllowedKeys(param, allowedParamKeys, 'BC-012', `repository method param "${param.name || '<unnamed>'}"`, paramLoc);
        if (param.operator != null && !allowedOperators.has(param.operator)) this.error('BC-160', `Repository param "${param.name}" has unsupported operator "${param.operator}".`, `${paramLoc}/operator`);
        if (param.filterOn != null) {
          if (!Array.isArray(param.filterOn) || param.filterOn.length === 0) this.error('BC-160', `Repository param "${param.name}" filterOn must be a non-empty list.`, `${paramLoc}/filterOn`);
          if (param.operator == null) this.error('BC-160', `Repository param "${param.name}" declares filterOn but is missing operator.`, `${paramLoc}/operator`);
        }
      }
    }
    if (method.name && method.returns) {
      const ret = String(method.returns).trim();
      if (/^findBy[A-Z]/.test(method.name) && !/\?$/.test(ret) && !/^List\[/.test(ret) && !/^Page\[/.test(ret)) this.error('BC-161', `findBy* repository methods must return T?, List[T] or Page[T].`, `${loc}/returns`);
      if (/^countBy[A-Z]/.test(method.name) && ret !== 'Int' && ret !== 'Long') this.error('BC-161', `countBy* repository methods must return Int or Long.`, `${loc}/returns`);
      if (/^existsBy[A-Z]/.test(method.name) && ret !== 'Boolean') this.error('BC-161', `existsBy* repository methods must return Boolean.`, `${loc}/returns`);
    }
    if (method.returns && /^Page\[/.test(String(method.returns).trim()) && Array.isArray(method.params)) {
      const hasPageable = method.params.some((p) => p && (p.type === 'PageRequest' || p.name === 'pageable'));
      const hasPagePair = method.params.some((p) => p && p.name === 'page' && p.type === 'Integer') && method.params.some((p) => p && p.name === 'size' && p.type === 'Integer');
      if (!hasPageable && !hasPagePair) this.error('BC-162', 'Repository method returns Page[T] but declares no PageRequest or page/size params.', `${loc}/params`);
    }
    if (method.derivedFrom != null) {
      const derivedFrom = String(method.derivedFrom);
      if (derivedFrom === 'implicit') return;
      if (derivedFrom.startsWith('openapi:')) {
        if (derivedFrom === 'openapi:') this.error('BC-163', 'derivedFrom: openapi: must include an operationId.', `${loc}/derivedFrom`);
      } else if (!ruleIds.has(derivedFrom)) {
        this.error('BC-163', `Repository method has derivedFrom "${derivedFrom}" but no domainRule with that id exists.`, `${loc}/derivedFrom`);
      }
    }
  }

  validateRepositoryMethodUseCaseInputs(repo, method, loc) {
    if (!isMapping(method) || method._section !== 'queryMethods') return;
    const derivedFrom = String(method.derivedFrom || '');
    if (!derivedFrom.startsWith('openapi:') || derivedFrom === 'openapi:') return;
    const operationId = derivedFrom.slice('openapi:'.length);
    const useCase = asArray(this.doc.useCases).find((uc) => (
      isMapping(uc)
      && uc.type === 'query'
      && uc.aggregate === repo.aggregate
      && uc.trigger
      && uc.trigger.kind === 'http'
      && uc.trigger.operationId === operationId
    ));
    if (!useCase) return;

    const inputNames = new Set(asArray(useCase.input).map((input) => input && input.name).filter(Boolean));
    for (let i = 0; i < asArray(method.params).length; i++) {
      const param = method.params[i];
      if (!isMapping(param) || !param.name) continue;
      if (param.type === 'PageRequest' || param.type === 'Pageable') continue;
      if (param.name === 'page' || param.name === 'size' || param.name === 'sortBy' || param.name === 'sortDirection') continue;
      if (!inputNames.has(param.name)) {
        this.error('BC-165', `Repository queryMethod "${method.name}" derived from openapi:${operationId} declares param "${param.name}", but use case "${useCase.id}" does not declare an input with that name. If it comes from JWT/SecurityContext, declare it under useCases[].input with source: authContext.`, `${loc}/params/${i}`);
      }
    }
  }

  validateQueryUseCasesHaveRepositoryMethods(repositories, aggregateNames) {
    const repoByAggregate = new Map(repositories.filter((r) => r && r.aggregate).map((r) => [r.aggregate, r]));
    for (let i = 0; i < asArray(this.doc.useCases).length; i++) {
      const uc = this.doc.useCases[i];
      if (!isMapping(uc) || uc.type !== 'query') continue;
      if (uc.loadAggregate === true) continue;
      const hasLoadAggregateInput = Array.isArray(uc.input) && uc.input.some((input) => input && input.loadAggregate === true);
      if (hasLoadAggregateInput) continue;
      if (!uc.aggregate || !aggregateNames.has(uc.aggregate)) continue;
      const repo = repoByAggregate.get(uc.aggregate);
      if (!repo || !Array.isArray(repo.queryMethods) || repo.queryMethods.length === 0) this.error('BC-164', `Use case "${uc.id}" is a query against aggregate "${uc.aggregate}" but its repository declares no queryMethods.`, this.loc(`#/useCases/${i}`));
    }
  }

  validateErrorOrphans() {
    const referenced = new Set();
    for (const agg of asArray(this.doc.aggregates)) for (const rule of asArray(agg && agg.domainRules)) if (rule && rule.errorCode) referenced.add(rule.errorCode);
    for (const uc of asArray(this.doc.useCases)) {
      for (const code of normalizeList(uc && uc.notFoundError)) referenced.add(code);
      for (const lookup of asArray(uc && uc.lookups)) if (lookup && lookup.errorCode) referenced.add(lookup.errorCode);
      for (const fk of asArray(uc && uc.fkValidations)) if (fk && (fk.error || fk.notFoundError)) referenced.add(fk.error || fk.notFoundError);
      for (const validation of asArray(uc && uc.validations)) if (validation && validation.errorCode) referenced.add(validation.errorCode);
    }
    for (let i = 0; i < asArray(this.doc.errors).length; i++) {
      const err = this.doc.errors[i];
      if (!err || err.usedFor === 'manual') continue;
      if (err.code && !referenced.has(err.code)) this.warn('BC-170', `Error "${err.code}" is declared in errors[] but never referenced. Reference it, remove it, or set usedFor: manual.`, this.loc(`#/errors/${i}`));
    }
  }

  validateProperties(properties, context, location, options = {}) {
    if (properties == null) return;
    if (!Array.isArray(properties)) {
      this.error('BC-090', `${context} properties must be a list.`, location);
      return;
    }
    const enumNames = this.enumNames();
    const allowedPropKeys = options.allowedPropKeys || null;
    for (let i = 0; i < properties.length; i++) {
      const prop = properties[i];
      const loc = `${location}/${i}`;
      if (!isMapping(prop)) {
        this.error('BC-090', `${context} has a non-mapping property entry.`, loc);
        continue;
      }
      if (allowedPropKeys) this.checkAllowedKeys(prop, allowedPropKeys, 'BC-012', `${context} property "${prop.name || '<unnamed>'}"`, loc);
      if (!prop.name) this.error('BC-090', `${context} has a property without name.`, `${loc}/name`);
      if (!prop.type) this.error('BC-090', `${context} property "${prop.name || '<unnamed>'}" is missing type.`, `${loc}/type`);
      this.validateType(prop.type, 'BC-091', `${context} property "${prop.name}"`, `${loc}/type`);
      const head = stripTypeParameters(String(prop.type || '').trim());
      if (head === 'Decimal' && (prop.precision == null || prop.scale == null)) this.error('BC-092', `${context} property "${prop.name}" has type Decimal but is missing precision and/or scale.`, loc);
      this.validateReadOnlyDefault(prop, context, loc, enumNames);
    }
  }

  validateReadOnlyDefault(prop, context, loc, enumNames) {
    if (prop.readOnly !== true || prop.defaultValue == null) return;
    const value = prop.defaultValue;
    const head = typeHead(prop.type);
    if (head === 'Uuid' && value !== 'generated') this.error('BC-093', `${context} property "${prop.name}": readOnly Uuid must have defaultValue: generated.`, `${loc}/defaultValue`);
    if (head === 'DateTime' && value !== 'now()') this.error('BC-093', `${context} property "${prop.name}": readOnly DateTime must have defaultValue: now().`, `${loc}/defaultValue`);
    if ((head === 'Integer' || head === 'Long' || head === 'Decimal') && isNaN(Number(value))) this.error('BC-093', `${context} property "${prop.name}": defaultValue must be numeric for ${head}.`, `${loc}/defaultValue`);
    if (head === 'Boolean' && value !== true && value !== false && value !== 'true' && value !== 'false') this.error('BC-093', `${context} property "${prop.name}": defaultValue must be true or false.`, `${loc}/defaultValue`);
    if (enumNames.has(head)) {
      const enumDef = asArray(this.doc.enums).find((e) => e && e.name === head);
      const values = asArray(enumDef && enumDef.values).map((v) => isMapping(v) ? (v.value || v.name) : v);
      if (!values.includes(value)) this.error('BC-093', `${context} property "${prop.name}": defaultValue "${value}" is not a valid value of enum ${head}.`, `${loc}/defaultValue`);
    }
  }

  validateType(type, code, context, location) {
    if (!type) return;
    if (hasProhibitedType(type)) this.error(code, `${context} uses prohibited type "${type}". Use canonical DSL types.`, location);
  }

  validateDomainMethodParameters(aggregate, aggLoc) {
    const rootProps = new Set(asArray(aggregate.properties).map((p) => p && p.name));
    const childProps = new Set(asArray(aggregate.entities).flatMap((e) => asArray(e && e.properties).map((p) => p && p.name)));
    for (let i = 0; i < asArray(aggregate.domainMethods).length; i++) {
      const dm = aggregate.domainMethods[i];
      if (!isMapping(dm)) continue;
      for (let j = 0; j < asArray(dm.params).length; j++) {
        const param = dm.params[j];
        const loc = `${aggLoc}/domainMethods/${i}/params/${j}`;
        if (!isMapping(param)) {
          this.error('BC-094', `domainMethod "${dm.name}" in aggregate "${aggregate.name}" has a non-mapping param entry.`, loc);
          continue;
        }
        if (!param.name) this.error('BC-094', `domainMethod "${dm.name}" in aggregate "${aggregate.name}" has a param without name.`, `${loc}/name`);
        if (param.type) {
          this.validateType(param.type, 'BC-091', `domainMethod "${dm.name}" param "${param.name}"`, `${loc}/type`);
          continue;
        }
        const resolvable = rootProps.has(param.name) || childProps.has(param.name) || param.name === 'id' || param.name.endsWith('Id') || param.name.endsWith('At') || param.name === 'password' || param.name === 'passwordHash';
        if (!resolvable) this.error('BC-094', `domainMethod "${dm.name}" in aggregate "${aggregate.name}" param "${param.name}" is missing type and cannot be resolved by convention.`, `${loc}/type`);
      }
    }
  }

  resolveType(type, sets = {}) {
    const head = typeHead(type);
    const collection = unwrapCollection(String(type || '').trim());
    if (collection) return this.resolveType(collection.inner, sets);
    const enumWrapped = unwrapEnum(String(type || '').trim());
    if (enumWrapped) return { resolved: sets.enumNames && sets.enumNames.has(enumWrapped), aggregate: enumWrapped };
    if (isCanonicalType(type, { enums: sets.enumNames })) return { resolved: true, aggregate: null };
    if (sets.enumNames && sets.enumNames.has(head)) return { resolved: true, aggregate: null };
    if (sets.voNames && sets.voNames.has(head)) return { resolved: true, aggregate: null };
    if (sets.projectionNames && sets.projectionNames.has(head)) return { resolved: true, aggregate: null };
    if (sets.eventDtoNames && sets.eventDtoNames.has(head)) return { resolved: true, aggregate: null };
    if (this.aggregateNames().has(head)) return { resolved: false, aggregate: head };
    return { resolved: false, aggregate: head };
  }

  domainMethodParamNames(method) {
    if (Array.isArray(method.params) && method.params.length > 0) return new Set(method.params.map((p) => p && p.name).filter(Boolean));
    if (method.signature) {
      const match = String(method.signature).match(/\(([^)]*)\)/);
      if (!match || !match[1].trim()) return new Set();
      return new Set(match[1].split(',').map((part) => {
        const trimmed = part.trim();
        const colon = trimmed.indexOf(':');
        return (colon >= 0 ? trimmed.substring(0, colon) : trimmed).replace('?', '').trim();
      }).filter(Boolean));
    }
    return new Set();
  }

  enumNames() {
    return new Set(asArray(this.doc.enums).map((e) => e && e.name).filter(Boolean));
  }

  valueObjectNames() {
    return new Set(asArray(this.doc.valueObjects).map((v) => v && v.name).filter(Boolean));
  }

  aggregateNames() {
    return new Set(asArray(this.doc.aggregates).map((a) => a && a.name).filter(Boolean));
  }

  aggregateByName() {
    return new Map(asArray(this.doc.aggregates).filter((a) => a && a.name).map((a) => [a.name, a]));
  }

  aggregateFieldNames(aggregate) {
    return new Set([
      ...asArray(aggregate.properties).map((p) => p && p.name),
      ...asArray(aggregate.attributes).map((p) => p && p.name),
      ...asArray(aggregate.fields).map((p) => p && p.name),
      'createdAt', 'updatedAt', 'deletedAt', 'id',
    ].filter(Boolean));
  }

  ruleIds() {
    const ids = new Set();
    for (const rule of asArray(this.doc.domainRules)) if (rule && rule.id) ids.add(rule.id);
    for (const agg of asArray(this.doc.aggregates)) for (const rule of asArray(agg && agg.domainRules)) if (rule && rule.id) ids.add(rule.id);
    return ids;
  }

  deleteGuardByAggregate() {
    const map = new Map();
    for (const agg of asArray(this.doc.aggregates)) {
      for (const rule of asArray(agg && agg.domainRules)) {
        if (rule && rule.type === 'deleteGuard') {
          const list = map.get(agg.name) || [];
          list.push(rule);
          map.set(agg.name, list);
        }
      }
    }
    return map;
  }

  errorCodes() {
    return new Set(asArray(this.doc.errors).map((e) => e && e.code).filter(Boolean));
  }

  publishedEventNames() {
    return new Set(asArray(this.doc.domainEvents && this.doc.domainEvents.published).map((e) => e && e.name).filter(Boolean));
  }

  consumedEventNames() {
    return new Set(asArray(this.doc.domainEvents && this.doc.domainEvents.consumed).map((e) => e && e.name).filter(Boolean));
  }

  checkAllowedKeys(obj, allowed, code, label, location) {
    for (const key of Object.keys(obj || {})) {
      if (key === '_section') continue;
      if (!allowed.has(key)) this.error(code, `${label} declares unsupported attribute "${key}". Allowed keys: ${[...allowed].join(', ')}.`, `${location}/${key}`);
    }
  }

  assertUnique(items, keyFn, code, label, pointer) {
    const seen = new Set();
    for (let i = 0; i < items.length; i++) {
      const key = keyFn(items[i]);
      if (!key) continue;
      if (seen.has(key)) this.error(code, `Duplicate ${label}: "${key}".`, this.loc(`${pointer}/${i}`));
      seen.add(key);
    }
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isMapping(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.filter((v) => v != null && v !== 'null');
  if (value == null || value === 'null') return [];
  return [value];
}

function toPascalCase(value) {
  return String(value || '')
    .replace(/(^|[-_\s]+)([a-zA-Z0-9])/g, (_, __, chr) => chr.toUpperCase())
    .replace(/[^A-Za-z0-9]/g, '');
}

function lowerFirst(value) {
  const str = String(value || '');
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function parseSignatureName(signature) {
  const match = String(signature || '').match(/^(\w+)/);
  return match ? match[1] : null;
}

function isAllowedRepositoryReturn(value) {
  const ret = String(value || '').trim();
  return /^void$/.test(ret)
    || /^Boolean$/.test(ret)
    || /^Int$/.test(ret)
    || /^Long$/.test(ret)
    || /^[A-Z][A-Za-z0-9]*\?$/.test(ret)
    || /^Page\[[A-Z][A-Za-z0-9]*\]$/.test(ret)
    || /^Slice\[[A-Z][A-Za-z0-9]*\]$/.test(ret)
    || /^Stream\[[A-Z][A-Za-z0-9]*\]$/.test(ret)
    || /^List\[[A-Z][A-Za-z0-9]*\]$/.test(ret)
    || /^[A-Z][A-Za-z0-9]*$/.test(ret);
}

function eventIndex(doc, eventName) {
  return Math.max(0, asArray(doc.domainEvents && doc.domainEvents.published).findIndex((event) => event && event.name === eventName));
}

module.exports = { validateBcYamlAnatomy };
