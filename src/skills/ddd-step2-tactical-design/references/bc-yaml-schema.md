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
        validations:               # opcional — constraints adicionales que el tipo no expresa solo.
                                   # Ver references/validation.md para el vocabulario completo.
                                   # Las constraints aquí declaradas se propagan automáticamente
                                   # a cualquier propiedad de un agregado que use este VO como tipo.
          - minLength: {N}         # solo para String, String(n), Text
          - pattern: "{REGEXP}"    # solo para String, String(n)
          - min: {N}               # solo para Integer, Long, Decimal
          - max: {N}               # solo para Integer, Long, Decimal
          - positive: true         # solo para Integer, Long, Decimal — excluye cero
          - positiveOrZero: true   # solo para Integer, Long, Decimal — incluye cero
          - future: true           # solo para Date, DateTime
          - past: true             # solo para Date, DateTime
          - minSize: {N}           # solo para List[T]
          - maxSize: {N}           # solo para List[T]


# ─── PROJECTIONS ─────────────────────────────────────────────────────────────

# Proyecciones: shapes de lectura usados como `returns` en use cases de tipo query.
# No representan estado del dominio — NUNCA se usan como `type` en aggregates[].properties[].
#
# Cuándo definir aquí (nombrado) vs inline en `returns`:
#   - Nombrado: el mismo shape lo retornan ≥2 UCs, o el concepto tiene nombre semántico en el negocio
#   - Inline:   shape simple de un único UC

projections:

  - name: {ProjectionName}         # PascalCase — qué ES el dato en el negocio, no cómo se transfiere
                                   # Sufijos PROHIBIDOS: *Response, *Dto, *Request, *Payload
                                   # Sufijos permitidos: Summary, Detail, Snapshot, View (o sin sufijo)
    description: >
      {qué representa esta proyección y por qué no coincide 1:1 con el agregado completo}
    properties:
      - name: {field}
        type: {canonical-type | EnumName | ValueObjectName}
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
        validations:                  # opcional — constraints adicionales que el tipo no puede expresar solo.
                                      # Ver references/validation.md para el vocabulario completo.
                                      # Regla: nunca repetir lo que ya está implícito en el tipo
                                      # (ej: no poner maxLength si ya hay String(n); no poner format:email si el tipo es Email).
                                      # Estas constraints se heredan automáticamente en TODOS los commands
                                      # que incluyan este campo en su input[]. El generador aplica las
                                      # annotations correspondientes en el Command record/class.
          - minLength: {N}            # solo para String, String(n), Text
          - pattern: "{REGEXP}"       # solo para String, String(n)
          - min: {N}                  # solo para Integer, Long, Decimal
          - max: {N}                  # solo para Integer, Long, Decimal
          - positive: true            # solo para Integer, Long, Decimal — excluye cero
          - positiveOrZero: true      # solo para Integer, Long, Decimal — incluye cero
          - future: true              # solo para Date, DateTime
          - past: true                # solo para Date, DateTime
          - minSize: {N}              # solo para List[T]
          - maxSize: {N}              # solo para List[T]

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
          # ... propiedades de la entidad (admiten validations: igual que aggregates[].properties[])

    domainRules:
      - id: {PREFIX}-RULE-{NNN}
        type: statePrecondition | uniqueness | terminalState | sideEffect | deleteGuard | crossAggregateConstraint
        errorCode: {ERROR_CODE}       # referencia a errors[].code; omitir si no hay error propio
        description: {invariante de negocio que el sistema debe hacer cumplir siempre}

    # ─ Métodos de dominio (fuente de verdad para commands)
    # Solo en agregados que NO son readModel. Omitir si el agregado es readModel: true.
    domainMethods:
      - name: {methodName}          # camelCase — referenciado desde useCases[].method
        params:                     # omitir si el método no recibe parámetros externos
          - name: {param}
            type: {DSL-type}        # tipo canónico o declarado en enums/valueObjects
        returns: void | {AggregateName}  # void si no devuelve nada; tipo del agregado para creaciones (factory)
        emits: {NombreEvento | null}     # evento de dominio emitido tras ejecución exitosa; null si no emite


# ─── USE CASES ──────────────────────────────────────────────────────────────

useCases:

  # ─ Command disparado por HTTP
  - id: UC-{ABREV}-{NNN}
    name: {NombreUC}
    type: command
    actor: customer | operator | driver | system
    trigger:
      kind: http
      operationId: {operationId}    # operationId exacto del OpenAPI generado en Etapa B
    aggregate: {AggregateName}
    method: {methodName}            # → aggregates[{AggregateName}].domainMethods[{methodName}]
                                    # Excepción — readModel: true: usar "upsert" o "delete" (operación de repositorio directo)
    input:                          # omitir si no hay parámetros externos
      - name: {param}
        type: {DSL-type}
        required: true | false
        source: path | query | body | authContext
        loadAggregate: true         # opcional — activa findById({param}) antes de invocar el método.
                                    # Exactamente un param por UC puede declararlo; su tipo debe ser Uuid.
                                    # Omitir en commands de creación (domainMethods[method].returns != void).
    rules: [{RULE-ID}, ...]          # reglas evaluadas DENTRO de este use case
    notFoundError: [{ERROR_CODE}]   # lista — agregar si loadAggregate: true o si busca entidad in-memory
    fkValidations:                  # lista vacía [] si no hay FK; omitir en queries
      - aggregate: {AggregateName}  # agregado cuya existencia se valida
        param: {paramName}          # nombre del input[] que contiene el UUID de FK
        error: {ERROR_CODE}         # código de error si el FK no existe
    outgoingCalls:                  # opcional — llamadas explícitas a puertos externos
      - port: {PortName}            # debe existir en integrations.outbound[]
        method: {methodName}
        params: [{paramName}, ...]  # nombres de input[] pasados al puerto; omitir si ninguno
        bindsTo: {domainMethodParam} # parámetro de domainMethods[method].params al que se asigna el resultado
    implementation: full | scaffold  # full = todos los params resolvibles; scaffold = TODOs pendientes
    sagaStep:                       # opcional — solo si es paso o compensación de una Saga
      saga: {SagaName}              # debe existir en sagas[].name en system.yaml
      order: {N}                    # posición en el flujo feliz (1-based); omitir cuando role: compensation
      role: step | compensation
      compensates: {N}              # número de orden del paso que se revierte; solo cuando role: compensation

  # ─ Command disparado por evento
  - id: UC-{ABREV}-{NNN}
    name: {NombreUC}
    type: command
    actor: system
    trigger:
      kind: event
      event: {NombreEvento}          # nombre del evento consumido
      channel: {canal-asyncapi}      # canal AsyncAPI donde llega el evento
    aggregate: {AggregateName}
    method: {methodName}             # → aggregates[{AggregateName}].domainMethods[{methodName}]
                                     # Excepción — readModel: true: usar "upsert" o "delete"
    input:
      - name: {param}
        type: {DSL-type}
        required: true
        source: event.{campo}        # extrae el campo del payload del evento
        loadAggregate: true          # opcional — activa findById({param}) antes de invocar el método
    rules: [{RULE-ID}, ...]
    notFoundError: [{ERROR_CODE}]    # omitir cuando no aplica
    fkValidations: []
    implementation: full | scaffold

  # ─ Query disparada por HTTP
  - id: UC-{ABREV}-{NNN}
    name: {NombreUC}
    type: query
    actor: customer | operator | driver | system
    trigger:
      kind: http
      operationId: {operationId}
    aggregate: {AggregateName}
    # NO incluir "method" en queries — el generador resuelve el queryMethod del repositorio por dos paths:
    #   Path A (loadAggregate: true): invoca repository.findById(param) directamente.
    #   Path B (sin loadAggregate): cruza los nombres de input[] contra repositories[aggregate].queryMethods.
    input:                           # omitir si no hay parámetros
      - name: {param}
        type: {DSL-type}
        required: true | false
        source: path | query | body | authContext
        loadAggregate: true          # Path A: findById directo. El nombre del param no necesita
                                     # coincidir con queryMethods.params.
    returns: {ProjectionName} | {AggregateName}Response  # nombre declarado en projections[]
                                    # o {AggregateName}Response para el DTO del agregado completo
                                    # (NUNCA el nombre del agregado a secas — genera error de compilación)
                                    # Colecciones: Page[{AggregateName}Response] o Page[{ProjectionName}]
                                    # Inline (shape simple de 1 UC):
                                    #   returns:
                                    #     - name: {field}
                                    #       type: {canonical-type}
    rules: []                        # normalmente vacío
    notFoundError: [{ERROR_CODE}]    # agregar si loadAggregate: true (Path A)
    implementation: full


# ─── REPOSITORIES ────────────────────────────────────────────────────────────

repositories:

  - aggregate: {AggregateName}

    # ─ Métodos de lectura para queries (fuente de verdad para el Path B de resolución)
    # El generador usa estos métodos cuando un query UC no tiene loadAggregate: true.
    # El generador cruza los nombres de input[] del UC contra los params de cada queryMethod
    # para identificar unívocamente el método a invocar.
    queryMethods:
      - name: findBy{Campo} | list | listBy{Param}
        params:
          - name: {param}
            type: {canonical-type}
            required: true | false   # false para filtros opcionales
            filterOn: [{campo}]      # requerido cuando el nombre no mapea a ninguna propiedad
            operator: LIKE_CONTAINS  # requerido cuando filterOn está presente
        returns: "{AggregateName}? | Page[{AggregateName}] | List[{AggregateName}]"
        derivedFrom: openapi:{operationId} | implicit

    methods:

      # ─ Método implícito de lectura por ID (siempre presente en todo agregado)
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
          - name: {param}               # param cuyo nombre coincide con una propiedad del agregado
            type: {canonical-type}      # el generador infiere EQ automáticamente
            required: false    # agregar required: false en params opcionales (filtros)
          - name: search                # param de búsqueda textual (no mapea a ninguna propiedad)
            type: String
            required: false
            filterOn: [{campo1}, {campo2}]  # propiedades del agregado que filtra
            operator: LIKE_CONTAINS         # LIKE_CONTAINS | LIKE_STARTS | EQ | GTE | LTE | IN
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
      auth:                         # OPCIONAL — solo si system.yaml NO declara auth para esta integración
        type: {none|api-key|bearer|oauth2-cc|mTLS|internal-jwt}
        valueProperty: {clave de configuración Spring con el secreto}  # solo api-key | bearer
        header: {nombre del header}          # solo api-key (default: X-Api-Key)
        tokenEndpoint: {url}                 # solo oauth2-cc
        credentialKey: {clave de credencial} # solo oauth2-cc
      resilience:                   # OPCIONAL — solo si system.yaml NO declara resilience para esta integración
        circuitBreaker:             # presencia del objeto → @CircuitBreaker(name="{name}") en el adaptador
          failureRateThreshold: 50           # % de fallos para abrir el circuito (1–100)
          waitDurationInOpenState: 30s       # tiempo en estado OPEN (string con unidad: "30s", "60s")
          slidingWindowSize: 20
          minimumNumberOfCalls: 10
          permittedNumberOfCallsInHalfOpenState: 3
        retries:                    # PLURAL — maxAttempts > 1 → @Retry(name="{name}") en el adaptador
          maxAttempts: 3            # debe ser > 1 para activar @Retry
          waitDuration: 500ms       # tiempo entre reintentos (string con unidad: "500ms", "1s")
        connectTimeoutMs: 5000      # timeout de conexión TCP en ms (campo plano, default: 5000)
        timeoutMs: 15000            # timeout de lectura en ms (campo plano, default: 15000 BC→BC / 30000 externo)

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
bc → type → description → enums → valueObjects → projections → aggregates → useCases → repositories → errors → integrations → domainEvents
```

---

## Tipos de domainRules

| type | Cuándo usarlo | Genera |
|------|--------------|--------|
| `statePrecondition` | Condición para transición de estado (DRAFT → ACTIVE) | Guard en método de dominio |
| `uniqueness` | Campo debe ser único en todo el repositorio | Índice UNIQUE en DB + `findBy{Campo}` en repositorio |
| `terminalState` | Estado sin transiciones salientes | Sin método de transición |
| `sideEffect` | Acción que ocurre como consecuencia (ej: registrar historial) | **Ninguno** — el generador no emite código (`emptyResult()`). Anotación de diseño para Fase 3. |
| `deleteGuard` | Condición para permitir eliminación física | Guard en use case de delete + método `delete` en repositorio |
| `crossAggregateConstraint` | Invariante que requiere consultar otro agregado | Método de query en repositorio del otro agregado |

---

## Checklist de Calidad (yaml v2)

Antes de dar el `{bc-name}.yaml` v2 por completo, verificar:

**Proyecciones:**
- [ ] Cada `returns` de tipo query referencia un nombre en `projections[]`, el nombre de un agregado del BC, o es lista inline de propiedades
- [ ] Ningún nombre en `projections[]` tiene sufijo `*Response`, `*Dto`, `*Request` o `*Payload`
- [ ] Ninguna propiedad en `aggregates[]` ni `entities[]` usa un nombre de `projections[]` como `type`

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
- [ ] Cada `useCase` de tipo `command` declara `method` con el nombre del método en `aggregates[].domainMethods[]` (excepto `readModel: true` que usa `upsert`/`delete`)
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
