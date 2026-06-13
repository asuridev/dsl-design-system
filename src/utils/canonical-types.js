'use strict';

const PROHIBITED_TYPES = new Set([
  'string',
  'int',
  'number',
  'float',
  'bool',
  'date',
  'timestamp',
  'any',
  'object',
  'bigint',
]);

const CANONICAL_TYPES = new Set([
  'Uuid',
  'String',
  'Text',
  'Integer',
  'Long',
  'Decimal',
  'Boolean',
  'Date',
  'DateTime',
  'Duration',
  'Email',
  'Url',
  'Money',
  'StoredObject',
  'PageRequest',
  'File',
  'BinaryStream',
  'SearchText',
]);

const PARAMETERIZED_CANONICAL_TYPES = new Set([
  'String',
  'List',
  'Range',
  'Page',
  'Slice',
  'Stream',
  'Optional',
]);

function stripTypeParameters(type) {
  if (!type || typeof type !== 'string') return '';
  return type.replace(/\(.*\)$/, '').trim();
}

function unwrapList(type) {
  const match = /^List\[(.+)\]$/.exec(String(type || '').trim());
  return match ? match[1].trim() : null;
}

function unwrapRange(type) {
  const match = /^Range\[(.+)\]$/.exec(String(type || '').trim());
  return match ? match[1].trim() : null;
}

function unwrapCollection(type) {
  const match = /^(List|Page|Slice|Stream|Optional)\[(.+)\]$/.exec(String(type || '').trim());
  return match ? { wrapper: match[1], inner: match[2].trim() } : null;
}

function unwrapEnum(type) {
  const match = /^Enum<(.+)>$/.exec(String(type || '').trim());
  return match ? match[1].trim() : null;
}

function typeHead(type) {
  if (!type || typeof type !== 'string') return '';
  const trimmed = type.trim();
  const collection = unwrapCollection(trimmed);
  if (collection) return typeHead(collection.inner);
  const range = unwrapRange(trimmed);
  if (range) return typeHead(range);
  const enumName = unwrapEnum(trimmed);
  if (enumName) return enumName;
  return stripTypeParameters(trimmed);
}

function isCanonicalType(type, options = {}) {
  if (!type || typeof type !== 'string') return false;
  const trimmed = type.trim();
  if (/^String\(\d+\)$/.test(trimmed)) return true;
  if (CANONICAL_TYPES.has(trimmed)) return true;

  const collection = unwrapCollection(trimmed);
  if (collection) return isCanonicalType(collection.inner, options);

  const range = unwrapRange(trimmed);
  if (range) return isCanonicalType(range, options);

  const enumName = unwrapEnum(trimmed);
  if (enumName) return Boolean(options.enums && options.enums.has(enumName));

  return false;
}

function hasProhibitedType(type) {
  const head = typeHead(type);
  return PROHIBITED_TYPES.has(head) || /^varchar\(\d+\)$/i.test(String(type || '').trim());
}

module.exports = {
  CANONICAL_TYPES,
  PARAMETERIZED_CANONICAL_TYPES,
  PROHIBITED_TYPES,
  hasProhibitedType,
  isCanonicalType,
  stripTypeParameters,
  typeHead,
  unwrapCollection,
  unwrapEnum,
  unwrapList,
  unwrapRange,
};
