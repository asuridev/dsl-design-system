# Schema de {bc-name}.yaml — Referencia Completa

Este documento define la estructura canónica del archivo `{bc-name}.yaml`.
Es la fuente de verdad táctica de cada Bounded Context.

---

## Estructura Completa del Archivo

```yaml
# ─────────────────────────────────────────────────────────────────────────────
# BOUNDED CONTEXT: {bc-name}
# {System Name} — Paso 2: Diseño Táctico
# Versión: 1.0.0 | Fecha: {YYYY-MM-DD}
# ─────────────────────────────────────────────────────────────────────────────

bc: {bc-name}                    # string, debe coincidir exactamente con system.yaml
type: core | supporting | generic
description: >
  {propósito del BC en inglés, 1-2 oraciones. Derivar de system.yaml}


# ─── ENUMS ───────────────────────────────────────────────────────────────────

enums:

  # Enum con ciclo de vida (estados del agregado)
  - name: {Name}Status
    description: {descripción del ciclo de vida}
    values:
      - value: ESTADO_1
        description: {qué significa este estado}
        transitions:
          - to: ESTADO_2
            triggeredBy: {UC-ID NombreUC | acción del sistema | acción de admin}
            condition: {RULE-ID | none}   # SIEMPRE un RULE-ID o "none". NUNCA texto libre.
            rules: [{RULE-ID, ...}]      # omitir si no hay reglas
            emits: {NombreEvento | null}

      - value: ESTADO_2
        description: {qué significa este estado}
        transitions:
          - to: ESTADO_1
            triggeredBy: {UC-ID NombreUC}
            condition: none
            emits: {NombreEvento | null}

  # Enum de clasificación simple (sin ciclo de vida)
  - name: {Name}Type
    description: {descripción}
    values:
      - value: VALOR_1
        description: {descripción}
      - value: VALOR_2
        description: {descripción}


# ─── VALUE OBJECTS ───────────────────────────────────────────────────────────

valueObjects:

  - name: {Name}
    description: >
      {qué representa este VO y por qué existe como VO y no como primitivo}
    properties:
      - name: {field}
        type: {canonical-type}     # ver canonical-types.md
        required: true | false
        description: {descripción}


# ─── AGGREGATES ──────────────────────────────────────────────────────────────

aggregates:

  - name: {AggregateName}
    root: {AggregateName}
    auditable: true        # el generador inyecta createdAt y updatedAt; no declarar como propiedades
    # softDelete: true     # opcional — borrado lógico. El generador inyecta deletedAt (nullable).
    #                        Todos los findAll/findBy* filtran deletedAt IS NULL implícitamente.
    #                        DELETE endpoint mapea a softDelete(id). Sin endpoint de restore.
    # readModel: true      # opcional — agregado de proyección local (local read model).
    #   sourceBC: {bc-name}          # BC fuente de los datos proyectados
    #   sourceEvents:                # eventos que alimentan la proyección
    #     - {EventName}              # uno por evento del BC fuente
    #   El generador: no genera endpoints POST/PATCH/DELETE ni command useCases para
    #   este agregado. Solo genera event-triggered UCs (trigger.kind: event).
    #   Usar cuando el BC necesita datos de otro BC en tiempo de escritura y la
    #   consistencia eventual es aceptable. Ver references/local-read-model.md.
    description: >
      {qué representa, su invariante central y por qué es un agregado propio}

    properties:
      # ─ Identificador (siempre primero)
      - name: id
        type: Uuid
        required: true
        description: Unique identifier of the {aggregate}.

      # ─ Propiedades del dominio
      - name: {field}
        type: {canonical-type}
        required: true | false
        unique: true | false          # omitir si false; genera índice UNIQUE en DB
        indexed: true | false         # omitir si false; genera índice no-UNIQUE en DB
        description: {descripción}

      # ─ Enums propios
      - name: {status}
        type: {EnumName}
        required: true
        description: {qué controla este estado}

      # ─ Asociación mismo BC
      - name: {entityId}
        type: Uuid
        required: true
        references: {AggregateRoot}
        relationship: association
        cardinality: manyToOne | oneToOne
        description: {descripción}

      # ─ Asociación cross-BC
      - name: {entityId}
        type: Uuid
        required: true
        references: {AggregateRoot}
        relationship: association
        cardinality: manyToOne
        bc: {bc-name}
        description: {descripción}

      # ─ Flags de visibilidad (mutuamente excluyentes — omitir si ninguno aplica)
      # readOnly: true  → server-generated. EXCLUIDO de requests, incluido en responses y DB.
      #                   Requiere exactamente uno de:
      #   defaultValue: <literal>   → valor fijo en factory/constructor (ej: DRAFT, true)
      #   defaultValue: now()       → DateTime.now(UTC) resuelto en application service
      #   source: authContext      → inyectado desde el contexto de autenticación, no del request
      #
      # hidden: true    → write-only. Incluido en requests, EXCLUIDO de responses. Persiste en DB.
      #                   Ejemplo: password, pin, token secreto
      #
      # internal: true  → domain-only. EXCLUIDO de requests Y responses. Solo en DB.
      #                   Ejemplo: attemptCount, internalLockReason, retryCount
      #
      # Ejemplos:
      # - name: id
      #   type: Uuid
      #   required: true
      #   readOnly: true
      #   defaultValue: generated    # UUID generado en factory del agregado
      #
      # - name: status
      #   type: OrderStatus
      #   required: true
      #   readOnly: true
      #   defaultValue: PENDING      # estado inicial; solo mutable por métodos de dominio
      #
      # - name: slug
      #   type: String(200)
      #   required: true
      #   readOnly: true
      #   description: URL-friendly identifier derived from the name; computed server-side.
      #
      # - name: createdBy
      #   type: String(200)
      #   required: true
      #   readOnly: true
      #   source: authContext       # inyectado desde el contexto de autenticación
      #
      # - name: password
      #   type: String(200)
      #   required: true
      #   hidden: true               # presente en request, nunca en response
      #
      # - name: attemptCount
      #   type: Integer
      #   required: true
      #   internal: true             # solo existe en DB, invisible en API

      # ─ Auditoría
      # NO declarar createdAt/updatedAt como propiedades.
      # El flag `auditable: true` al nivel del agregado le indica al generador
      # que debe inyectar automáticamente estas columnas en la entidad de DB
      # y exponerlas en los responses de detalle.

    entities:
      - name: {EntityName}
        relationship: composition
        cardinality: oneToMany | oneToOne
        description: {qué representa esta entidad dentro del agregado}
        # immutable: true  → entidad de solo-inserción: no permite UPDATE ni DELETE individuales.
        #                   El generador omite métodos de update/delete para esta entidad y
        #                   emite restricción en la migración SQL.
        #                   Ejemplos: PriceHistory, AuditLog, EventLog
        properties:
          - name: id
            type: Uuid
            required: true
            description: Unique identifier of the {entity}.
          # ... propiedades de la entidad

    domainRules:
      - id: {PREFIX}-RULE-{NNN}
        type: statePrecondition | uniqueness | terminalState | sideEffect | deleteGuard | crossAggregateConstraint
        errorCode: {ERROR_CODE}       # referencia a errors[].code; omitir si no hay error propio
        description: {invariante de negocio que el sistema debe hacer cumplir siempre}


# ─── USE CASES ──────────────────────────────────────────────────────────────

useCases:

  # ─ Caso de uso de comando (modifica estado)
  - id: UC-{ABREV}-{NNN}
    name: {NombreUC}
    type: command
    actor: customer | operator | driver | system
    trigger:
      kind: http
      operationId: {operationId}    # operationId exacto del OpenAPI generado en Etapa B
    aggregate: {AggregateName}
    method: {methodName}({params}): {ReturnType}   # firma del método de dominio en el agregado
    repositoryMethod: {repoMethodName}({params})  # método del repositorio que persiste el resultado
    rules: [{RULE-ID}, ...]          # reglas evaluadas DENTRO de este use case
    emits: {NombreEvento | null}     # evento emitido al completar; null si no emite
    implementation: full | scaffold  # full = generación completa; scaffold = esqueleto con marcadores TODO
    # notFoundError: Agregar si el use case llama findById como primer paso,
    #   o si busca una entidad in-memory en la colección del agregado cargado.
    #   Si ambos aplican, usar lista: [AGGREGATE_NOT_FOUND, ENTITY_NOT_FOUND]
    # fkValidations: Agregar si el use case recibe campos que referencian otros agregados por FK

  # Ejemplo con notFoundError y fkValidations:
  # - id: UC-CAT-008
  #   name: UpdateProductDetails
  #   type: command
  #   ...
  #   notFoundError: PRODUCT_NOT_FOUND        # lanzado si findById no retorna resultado
  #   fkValidations:
  #     - field: categoryId                      # campo en el request que es FK
  #       aggregate: Category                    # agregado referenciado
  #       notFoundError: CATEGORY_NOT_FOUND    # error si el FK no existe
  #       conditional: true                      # opcional: true cuando el campo FK es opcional en el request
  #                                              # el generador emite la validación dentro de if (field != null)
  # Aplicar también cuando el FK es opcional (e.g. `categoryId?`). Si el campo se recibe
  # en el request (aunque sea opcional), el generador debe emitir la validación condicional.

  # ─ Caso de uso de query (solo lectura)
  - id: UC-{ABREV}-{NNN}
    name: {NombreUC}
    type: query
    actor: customer | operator | driver | system
    trigger:
      kind: http
      operationId: {operationId}
    aggregate: {AggregateName}
    repositoryMethod: {repoMethodName}({params})  # método del repositorio que lee los datos
    rules: []                        # normalmente vacío para queries
    emits: null
    notFoundError: {ERROR_CODE}    # agregar si este query llama findById (GetById, Validate...)
    implementation: full | scaffold

  # ─ Caso de uso disparado por evento
  - id: UC-{ABREV}-{NNN}
    name: {NombreUC}
    type: command
    actor: system
    trigger:
      kind: event
      event: {NombreEvento}          # nombre del evento consumido
      channel: {canal-asyncapi}      # canal AsyncAPI donde llega el evento
    aggregate: {AggregateName}
    method: {methodName}({params}): {ReturnType}
    repositoryMethod: {repoMethodName}({params})
    rules: [{RULE-ID}, ...]
    emits: {NombreEvento | null}
    implementation: full | scaffold


# ─── REPOSITORIES ────────────────────────────────────────────────────────────

repositories:

  - aggregate: {AggregateName}
    methods:

      # ─ Método implícito (siempre presente en todo agregado)
      - name: findById
        params:
          - name: id
            type: Uuid
        returns: "{AggregateName}?"
        derivedFrom: implicit

      # ─ Método derivado de una regla de unicidad
      - name: findBy{Campo}
        params:
          - name: {campo}
            type: {canonical-type}
        returns: "{AggregateName}?"
        derivedFrom: {RULE-ID}        # e.g. PRD-RULE-003 (uniqueness en sku)

      # ─ Método derivado de un query param del OpenAPI
      # Naming: list (no findAll). Usar list cuando hay filtros opcionales; listBy{Param} cuando
      # el método filtra por un único parámetro obligatorio.
      - name: list
        params:
          - name: {param}
            type: {canonical-type}
            required: false    # agregar required: false en params opcionales (filtros)
          - name: page
            type: PageRequest
            required: true
        returns: "Page[{AggregateName}]"
        derivedFrom: openapi:{operationId}  # e.g. openapi:listProducts

      # ─ Método derivado de regla crossAggregateConstraint
      - name: countBy{Campo1}And{Campo2}
        params:
          - name: {campo1}
            type: {canonical-type}
          - name: {campo2}
            type: {canonical-type}
        returns: Int             # siempre Int mayúscula
        derivedFrom: {RULE-ID}  # e.g. CAT-RULE-001

      # ─ Método de persistencia (siempre presente)
      - name: save
        params:
          - name: entity
            type: {AggregateName}
        derivedFrom: implicit

      # ─ Método de eliminación (solo si hay deleteGuard rule)
      - name: delete
        params:
          - name: id
            type: Uuid
        derivedFrom: {RULE-ID}        # e.g. PRD-RULE-006 (deleteGuard)


# ─── ERRORS ──────────────────────────────────────────────────────────────────

errors:

  # Un error por cada violation posible del dominio
  - code: {ERROR_CODE}               # SCREAMING_SNAKE_CASE, e.g. PRODUCT_NOT_FOUND
    httpStatus: 400 | 404 | 409 | 422 | 500
    errorType: {ErrorTypeName}      # PascalCase con sufijo Error, e.g. ProductNotFoundError


# ─── INTEGRATIONS ────────────────────────────────────────────────────────────

integrations:

  outbound:
    - name: {bc-o-sistema-externo}
      type: internalBc | externalSystem
      pattern: customerSupplier | acl | conformist
      protocol: http | grpc | amqp
      description: {por qué este BC necesita llamar al otro}
      operations:
        - name: {nombre-operacion}   # debe coincidir con contracts en system.yaml
          description: {qué hace}
          triggersOn: {UC-ID | evento}
          responseEvents:           # opcional
            - {NombreEvento}

  inbound:
    - name: {bc-consumidor}
      type: internalBc
      pattern: customerSupplier
      protocol: http
      description: {qué consulta el consumidor en este BC}
      operations:
        - name: {nombre-operacion}
          definedIn: {bc-name}-open-api.yaml
          endpoint: {METHOD /api/{bc}/v1/path}


# ─── DOMAIN EVENTS ───────────────────────────────────────────────────────────

domainEvents:

  published:
    - name: {EventName}              # PascalCase, pasado: ProductCreated, OrderConfirmed
      description: {cuándo se emite y qué significa para el negocio}
      payload:
        - name: {field}
          type: {canonical-type}
          required: true | false     # omitir si siempre requerido

  consumed:
    - name: {EventName}
      sourceBc: {bc-name}
      description: {efecto que produce este evento en este BC}
      payload:
        - name: {field}
          type: {canonical-type}
```

---

## Reglas de Nombres

| Elemento | Convención | Ejemplo |
|----------|-----------|---------|
| `bc` (valor) | kebab-case | `catalog`, `dispatch`, `payments` |
| Enum name | PascalCase + rol | `ProductStatus`, `OrderStatus`, `ImageType` |
| Enum values | SCREAMING_SNAKE | `DRAFT`, `ACTIVE`, `PENDING_PAYMENT` |
| VO name | PascalCase + noun | `Money`, `Slug`, `ShippingAddress` |
| Aggregate name | PascalCase + noun | `Product`, `Order`, `Driver` |
| Entity name | PascalCase + noun | `OrderLine`, `ProductImage`, `DriverZone` |
| Property name | camelCase | `categoryId`, `unitPrice`, `createdAt` |
| Domain rule ID | `{ABREV}-RULE-{NNN}` | `PRD-RULE-001`, `ORD-RULE-003` |
| Event name | PascalCase + past tense | `ProductActivated`, `OrderConfirmed` |
| UC reference | `UC-{ABREV}-{NNN}` | `UC-PRD-004`, `UC-CAT-001` |

## Abreviaturas estándar de BCs

| BC | Abreviatura |
|----|------------|
| catalog | CAT / PRD (products) |
| orders | ORD |
| dispatch | DSP |
| inventory | INV |
| payments | PAY |
| customers | CUS |
| notifications | NOT |

---

## Orden canónico de secciones

```
bc → type → description → enums → valueObjects → aggregates → useCases → repositories → errors → integrations → domainEvents
```

---

## Tipos de domainRules

| type | Cuándo usarlo | Genera |
|------|--------------|--------|
| `statePrecondition` | Condición para transición de estado (DRAFT → ACTIVE) | Guard en método de dominio |
| `uniqueness` | Campo debe ser único en todo el repositorio | Índice UNIQUE en DB + `findBy{Campo}` en repositorio |
| `terminalState` | Estado sin transiciones salientes | Sin método de transición |
| `sideEffect` | Acción que ocurre como consecuencia (ej: registrar historial) | Lógica adicional en el método de dominio |
| `deleteGuard` | Condición para permitir eliminación física | Guard en use case de delete + método `delete` en repositorio |
| `crossAggregateConstraint` | Invariante que requiere consultar otro agregado | Método de query en repositorio del otro agregado |

---

## Checklist de Calidad (yaml v2)

Antes de dar el `{bc-name}.yaml` v2 por completo, verificar:

**Secciones base:**
- [ ] `bc` coincide exactamente con el nombre en `system.yaml`
- [ ] Todos los agregados mencionados en `system.yaml` están presentes
- [ ] Cada agregado root tiene `id`, propiedades y `auditable: true`
- [ ] Si existe agregado con `readModel: true`: tiene `sourceBC` y `sourceEvents[]` declarados
- [ ] Si existe agregado con `readModel: true`: NO tiene endpoints ni command useCases — solo event-triggered UCs
- [ ] Todos los enums de ciclo de vida tienen `transitions` definidas
- [ ] Todas las `rules` referenciadas en transitions existen en `domainRules`
- [ ] Todas las asociaciones cross-BC tienen campo `bc`
- [ ] Los eventos en `domainEvents.published` corresponden a los emitidos en las transiciones
- [ ] Los eventos en `domainEvents.consumed` corresponden a los `contracts` de `system.yaml`
- [ ] Las operaciones en `integrations` coinciden con los contratos de `system.yaml`
- [ ] Todos los tipos son canónicos (ver canonical-types.md)

**Nuevos campos (Etapa C):**
- [ ] Cada `domainRule` tiene `type` y `errorCode` (si aplica)
- [ ] Las propiedades con unicidad tienen `unique: true`; las filtradas por OpenAPI tienen `indexed: true`
- [ ] Cada operación del OpenAPI tiene exactamente un `useCase` con `trigger.operationId` correspondiente
- [ ] Cada `useCase` referencia un `repositoryMethod` que existe en `repositories`
- [ ] `repositories` tiene `findById` y `save` para cada agregado
- [ ] `repositories` tiene `findBy{Campo}` para cada regla de tipo `uniqueness`
- [ ] `repositories` tiene `list` (no `findAll`) para cada query param GET del OpenAPI
- [ ] `repositories` tiene `countBy...` para cada regla de tipo `crossAggregateConstraint`; retorna `Int` (mayúscula)
- [ ] `repositories` tiene `delete` para cada regla de tipo `deleteGuard`
- [ ] Params opcionales en métodos de listado tienen `required: false`
- [ ] `errors[]` tiene una entrada por cada `errorCode` referenciado en `domainRules`
- [ ] `errors[]` tiene una entrada por cada código en `notFoundError` de los use cases
- [ ] `errors[]` tiene una entrada por cada código `422` de negocio en query UCs que no tiene domainRule (crear la domainRule `statePrecondition` correspondiente)
- [ ] `errors[]` tiene una entrada por cada código que aparece en `{bc-name}-flows.md` o en `{bc-name}-internal-api.yaml`
- [ ] Todo código en `errors[]` está referenciado en al menos uno de los anteriores (sin huérfanos)

**Flags de visibilidad:**
- [ ] `id` tiene `readOnly: true` + `defaultValue: generated`
      (en agregados `readModel: true`: verificar además que el ID del BC fuente esté
      como campo separado `{sourceEntity}Id` con `unique: true`, NO fusionado en `id`)
- [ ] Propiedades de estado iniciales tienen `readOnly: true` + `defaultValue: <estado-inicial>`
- [ ] Ningún tipo usa sintaxis Java genérica: buscar `<[A-Z]` en el YAML
      — `Page<X>` → `Page[X]`, `List<X>` → `List[X]`, `Enum<X>` → nombre del enum directamente
- [ ] Campos inyectados del contexto de auth tienen `readOnly: true` + `source: authContext`
- [ ] Campos write-only (passwords, tokens) tienen `hidden: true`
- [ ] Campos puramente internos tienen `internal: true`

**useCases (nuevos campos):**
- [ ] Todo use_case que llama `findById` o busca una entidad in-memory tiene `notFoundError`. Formato lista `[CODE1, CODE2]` si ambos aplican.
- [ ] Todo use_case que recibe FKs de otros agregados tiene `fkValidations[]`
- [ ] `condition` en transiciones de enum es un RULE-ID o `none` (nunca texto libre)
- [ ] Todo use_case tiene `implementation: full | scaffold`
- [ ] Todo UC con `implementation: scaffold` tiene ≥1 flujo **dedicado** en `{bc-name}-flows.md` (ver DECISIÓN-001 en SKILL.md y regla 5.2). Un UC scaffold sin flujo dedicado es un gap táctico bloqueante.
