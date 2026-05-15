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

            # triggeredBy SIEMPRE es string. NUNCA usar listas/arrays.
            # Si varios use cases llevan al mismo estado destino, repetir la transición:
            # - to: ESTADO_2
            #   triggeredBy: UC-001 NombreUseCase
            # - to: ESTADO_2
            #   triggeredBy: UC-002 OtroUseCase

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

# ─── CUÁNDO NO usar valueObjects[] ──────────────────────────────────────────
#
# Un valueObject[] DEBE ser utilizado como `type` de alguna propiedad en
# aggregates[] o entities[]. Si el concepto sólo aparece como `returns` de un
# use case (i.e., su único propósito es transportar datos hacia el llamador),
# NO es un VO — es una proyección y debe ir en projections[].
#
# Regla de oro:
#   VO   → concepto del dominio propio; tiene invariantes o validaciones;
#           se usa como `type` en el modelo de datos del agregado.
#   Projection → shape de lectura; ninguna invariante de negocio;
#                 sólo aparece en `returns`.
#
# Caso frecuente de error:
#   Un "snapshot" inmutable diseñado para una respuesta de internal-API o
#   de query se declara en valueObjects[] porque es inmutable. Pero la
#   inmutabilidad NO es criterio suficiente para ser VO. Si el objeto no
#   participa en el modelo del agregado, va en projections[].

valueObjects:

  - name: {Name}
    description: >
      {qué representa este VO y por qué existe como VO y no como primitivo}
    immutable: true  # opcional — aplica List.copyOf() defensivo en constructores para
                     # propiedades List[T]. Recomendado para VOs Snapshot (capturan estado
                     # de entidades para eventos de dominio) y VOs compartidos en contextos
                     # concurrentes. Un VO inmutable garantiza que ningún llamador puede
                     # modificar la colección interna después de construir el VO.
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


# ─── EVENT DTOS ──────────────────────────────────────────────────────────────

# eventDtos: shapes de eventos consumidos de BCs externos.
# Úsalos cuando consumed[].payload[] incluye tipos de objetos complejos (VO o List[VO])
# que pertenecen al BC productor — no al dominio propio de este BC.
# El generador produce un Java record en application.dtos.incoming/ (NO en domain.valueobject/).
#
# Regla: si el snapshot existe SOLO para transportar datos de un evento externo → eventDtos[].
#        Si el concepto tiene semántica propia en el dominio de ESTE BC → valueObjects[].

eventDtos:

  - name: {SnapshotName}           # PascalCase — ej: OrderLineSnapshot, ProductSnapshot
    sourceBc: {bc-name}            # BC que publica el evento — solo documentación, no validado
    properties:
      - name: {field}
        type: {canonical-type | EnumName | ValueObjectName | OtherEventDtoName}
        # type puede referenciar:
        #   - tipos canónicos (Uuid, String, Decimal, Money, ...)
        #   - enums declarados en enums[] de este BC
        #   - otros eventDtos[] de este BC (mismo paquete)
        #   - valueObjects[] de este BC (para tipos de dominio propios como Money)


# Ejemplo real:
# eventDtos:
#   - name: OrderLineSnapshot
#     sourceBc: orders
#     properties:
#       - name: productId
#         type: Uuid
#       - name: quantity
#         type: Integer
#       - name: unitPrice
#         type: Money    # Money sí es un VO del dominio propio (billing tiene Money)


# ─── PROJECTIONS ─────────────────────────────────────────────────────────────

# Proyecciones: shapes de lectura usados como `returns` en use cases de tipo query.
# No representan estado del dominio — NUNCA se usan como `type` en aggregates[].properties[].
#
# Cuándo definir aquí (nombrado) vs inline en `returns`:
#   - Nombrado: el mismo shape lo retornan ≥2 UCs, o el concepto tiene nombre semántico en el negocio
#   - Inline:   shape simple de un único UC

# ─── PROYECCIONES — incluyendo respuestas de internal-API ───────────────────
#
# Todo shape retornado en `returns` de un use case de tipo query va aquí,
# sin importar si es para un endpoint público, interno (BC-a-BC) o de saga.
#
# Criterio para usar projections[] vs valueObjects[]:
#   ┌─────────────────────────────────┬───────────────┬────────────────┐
#   │ Característica                  │ valueObjects  │ projections    │
#   ├─────────────────────────────────┼───────────────┼────────────────┤
#   │ Tiene invariantes / validaciones│ ✅            │ ❌             │
#   │ Usado como `type` en agregados  │ ✅            │ ❌ (prohibido) │
#   │ Solo aparece en `returns`       │ ❌            │ ✅             │
#   │ Puede ser inmutable             │ ✅            │ ✅ (no importa)│
#   │ Generado en domain.valueobject  │ ✅            │ ❌             │
#   │ Generado en application.dtos    │ ❌            │ ✅             │
#   └─────────────────────────────────┴───────────────┴────────────────┘
#
# Caso especial — snapshot de internal-API:
#   Cuando un BC expone un endpoint interno (internal-api.yaml) y la
#   respuesta es un shape propio (ej: ProductPriceSnapshot), ese shape
#   va en projections[] aunque sea inmutable y tenga nombre de "snapshot".
#   El generador lo emitirá en application.dtos y lo importará correctamente
#   en el QueryHandler y en el Query record.

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


# ─── PERSISTENT PROJECTIONS (Local Read Model automático) ────────────────────
#
# persistent: true genera automáticamente: JPA entity + JPA repository + broker listener.
# NO requiere use cases explícitos ni entradas en spec.md.
# Ver references/local-read-model.md §Mecanismo B para el análisis completo.

  - name: {ProjectionName}
    description: >
      {qué proyecta y de qué BC fuente}
    persistent: true                     # activa generación automática
    source:
      kind: event                        # único valor soportado
      event: {SourceEventName}           # evento principal (upsert completo)
      from: {source-bc-name}             # BC fuente — debe existir en arch/
    keyBy: {propertyName}                # campo clave del upsert — NO puede ser el PK interno
    tableName: proj_{snake_name}         # opcional; default: proj_{snake_case_de_name}
    upsertStrategy: lastWriteWins        # lastWriteWins | versionGuarded
    # eventVersionField: version         # solo con versionGuarded
    #                                    # default: campo llamado 'version' en properties[]
    #                                    # PRECONDICIÓN versionGuarded: ver nota abajo
    properties:
      - name: {keyField}                 # campo referenciado por keyBy
        type: Uuid
        required: true
      - name: {field}
        type: {canonical-type}           # SOLO tipos escalares canónicos — NO VOs, NO enums, NO List[T]
                                         # Money → aplanar en priceAmount:Decimal + priceCurrency:String(3)
                                         # Enum → usar String(n) y guardar el name() del enum
        required: true | false
    # additionalSources: eventos que actualizan SOLO un subconjunto de campos (sin insertar)
    # REGLA: el BC productor de cada evento adicional DEBE incluir el campo keyBy
    # en el payload[] de ese evento. Sin él, el partial updater descarta el mensaje
    # silenciosamente en runtime (log WARN) — no hay error de build ni de compilación.
    additionalSources:
      - kind: event
        event: {PartialUpdateEventName}
        from: {source-bc-name}
        updatesFields:
          - {field1}                     # campo en properties[]; NUNCA puede ser keyBy
          - {field2}
          # payload de {PartialUpdateEventName} en {source-bc-name} DEBE incluir:
          # keyBy (para findById) + cada campo de updatesFields (para la actualización)

# PRECONDICIÓN para upsertStrategy: versionGuarded
# El campo de versión (eventVersionField o 'version') DEBE estar en el payload[]
# del evento fuente del BC productor. Si no está, el guard degenera silenciosamente
# a lastWriteWins en runtime. El generador emite INT-027 warn (no error).
# Verificar antes de declarar versionGuarded:
#   1. El agregado productor tiene el campo 'version: Long' en sus properties[].
#   2. El evento fuente incluye ese campo en su payload[].
#   3. Cada evento en additionalSources[] también incluye el campo versión en su payload[].


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

      # ── statePrecondition ──────────────────────────────────────────────────
      # Condición para una transición de estado. El generador emite un TODO enriquecido
      # en el handler con el nombre de la clase de error a lanzar.
      # La condición concreta (ej: product.getStatus() == DRAFT) se implementa en Fase 3.
      - id: {PREFIX}-RULE-{NNN}
        type: statePrecondition
        errorCode: {ERROR_CODE}        # requerido — referencia a errors[].code
        description: {condición que debe cumplir el estado del agregado antes de la operación}

      # ── uniqueness ────────────────────────────────────────────────────────
      # Garantiza unicidad de un campo a nivel de sistema.
      # Con `field` → genera guardia proactiva en el handler (findBy{Campo} pre-check).
      # Con `field` + `constraintName` → ADEMÁS genera mapeo reactivo de
      #   DataIntegrityViolationException (el constraint DB lanzado por concurrent inserts).
      # Sin `field` → emite un TODO enriquecido en el handler (no aborta el build).
      # `constraintName` solo es válido cuando `field` está declarado (el build falla si solo uno).
      - id: {PREFIX}-RULE-{NNN}
        type: uniqueness
        errorCode: {ERROR_CODE}        # requerido
        description: {campo} must be unique across all {Aggregate}s.
        field: {campoDelAgregado}      # camelCase — debe coincidir con un name en properties[] del agregado
        constraintName: {uk_nombre}    # snake_case — nombre del índice UNIQUE en la BD
                                       # REQUIERE `field`. Activa el mapeo reactivo de
                                       # DataIntegrityViolationException → errorCode.

      # ── terminalState ──────────────────────────────────────────────────────
      # Estado final sin transiciones de salida. El generador envuelve la llamada
      # transitionTo() del enum en un try/catch que convierte
      # InvalidStateTransitionException en el error declarado.
      # NO declarar transiciones FROM este estado en el enum — es el mecanismo de bloqueo.
      - id: {PREFIX}-RULE-{NNN}
        type: terminalState
        errorCode: {ERROR_CODE}        # requerido
        description: A {aggregate} in {TERMINAL_STATE} cannot be modified.

      # ── sideEffect ────────────────────────────────────────────────────────
      # Acción complementaria documentada para Fase 3 (ej: registrar historial, notificar).
      # ⚠️ NO lleva `errorCode` — no produce error visible al cliente.
      # El generador NO emite código ejecutable — es una anotación de diseño pura.
      - id: {PREFIX}-RULE-{NNN}
        type: sideEffect
        description: {efecto colateral documentado para la implementación en Fase 3}
        # errorCode: PROHIBIDO en sideEffect — el generador lo ignora

      # ── deleteGuard ───────────────────────────────────────────────────────
      # Impide eliminar un registro que tiene dependientes activos en OTRO agregado.
      # Con `targetAggregate` + `targetRepositoryMethod` → genera guardia ejecutable.
      # Sin ellos → emite TODO enriquecido.
      # ⚠️ `targetAggregate` y `targetRepositoryMethod` deben declararse JUNTOS o
      #    ninguno — el build falla si solo uno está presente.
      - id: {PREFIX}-RULE-{NNN}
        type: deleteGuard
        errorCode: {ERROR_CODE}        # requerido
        description: Cannot delete {Aggregate} while it has associated {dependents}.
        targetAggregate: {DependentAggregateName}    # PascalCase — agregado que tiene los dependientes
        targetRepositoryMethod: {countMethodName}    # camelCase — método del repo que cuenta dependientes
                                                     # Ejemplo: countActiveByCategoryId
                                                     # ⚠️ Solo UN calificador por método: un literal del enum de
                                                     #    status (Active, Draft…), su forma negada Non{Literal}
                                                     #    (NonDiscontinued → status <> 'DISCONTINUED'), o NonDeleted/Deleted.
                                                     #    Calificadores compuestos (ActiveDraft) NO son válidos — build error.

      # ── crossAggregateConstraint ──────────────────────────────────────────
      # Invariante que requiere consultar el estado de OTRO agregado antes de ejecutar.
      # Ejemplo: no se puede crear un Pedido si el Producto no está en estado ACTIVE.
      # ⚠️ Los tres atributos (targetAggregate, field, expectedStatus) deben declararse
      #    JUNTOS. El build falla si alguno de los tres está presente sin los otros dos.
      - id: {PREFIX}-RULE-{NNN}
        type: crossAggregateConstraint
        errorCode: {ERROR_CODE}        # requerido
        description: {invariante cross-agregado que debe validarse antes de continuar}
        targetAggregate: {OtherAggregateName}        # PascalCase — agregado a consultar
        field: {fieldName}                           # campo del otro agregado a verificar
        expectedStatus: {EXPECTED_ENUM_VALUE}        # valor esperado (SCREAMING_SNAKE_CASE)

    # ─ Métodos de dominio (fuente de verdad para commands)
    # Solo en agregados que NO son readModel. Omitir si el agregado es readModel: true.
    domainMethods:

      # ─ FORMATO CANÓNICO (preferido): signature como string DSL
      - name: {methodName}          # camelCase — referenciado desde useCases[].method
        signature: "{methodName}(param1: Type, param2?): ReturnType"
                                    # Firma completa del método en notación DSL:
                                    #   - param sin hint → el generador resuelve el tipo
                                    #     buscando una propiedad con el mismo nombre en el agregado
                                    #   - param: Type → type hint explícito (ej: newPrice: Money)
                                    #   - param? → parámetro opcional
                                    #   - Sin parámetros → "methodName(): void"
                                    #   - Factory → "create(field1, field2): AggregateName"
        description: "{propósito del método en términos de negocio}"
                                    # Genera Javadoc en el método Java producido.
                                    # Añadir siempre — ayuda al equipo de Fase 3.
        returns: void | {AggregateName}  # void si no devuelve nada; nombre del agregado para factories
                                    # ⚠️ OBLIGATORIO para el método "create": returns DEBE ser el
                                    # nombre del agregado (sin esto el build falla con error S23).
        emits: {NombreEvento | null}     # string: evento único; null (o ausente): no emite
        # emits también puede ser lista cuando la operación emite múltiples eventos:
        # emits:
        #   - OrderCompleted
        #   - PaymentSettled
        #   - InventoryReserved
        # Cada entrada debe referenciar un evento en domainEvents.published[].
        # Usar lista cuando la operación coordina más de un cambio de estado observable.

      # ─ FORMATO ALTERNATIVO: params como lista (válido; equivalente; menos conciso)
      # - name: {methodName}
      #   params:
      #     - name: {param}
      #       type: {DSL-type}        # tipo canónico o declarado en enums/valueObjects
      #   returns: void
      #   emits: null


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
        source: body | path | query | authContext | header | multipart
        # body       → campo del JSON request body (POST/PUT/PATCH)
        # path       → variable de path URL (ej: /products/{id})
        # query      → query string parameter (ej: ?status=ACTIVE)
        # authContext→ inyectado desde el JWT/SecurityContext (no del request)
        # header     → cabecera HTTP; requiere además: headerName: {NombreHeader}
        # multipart  → parte de un form-data; type DEBE ser "File"; opcionalmente:
        #              partName: {nombre-del-part}
        #              maxSize: {N}{B|KB|MB|GB}      # ej: 10MB
        #              contentTypes: [image/png, image/jpeg]
        #              ⚠️ multipart y body son mutuamente excluyentes en el mismo UC.
        loadAggregate: true         # opcional — activa findById({param}) antes de invocar el método.
                                    # Exactamente un param por UC puede declararlo; su tipo debe ser Uuid.
                                    # Omitir en commands de creación (domainMethods[method].returns != void).
    rules: [{RULE-ID}, ...]          # reglas evaluadas DENTRO de este use case
    notFoundError: [{ERROR_CODE}]   # lista — agregar si loadAggregate: true o si busca entidad in-memory
    fkValidations:                  # lista vacía [] si no hay FK; omitir en queries
      - aggregate: {AggregateName}  # agregado cuya existencia se valida
        param: {paramName}          # nombre del input[] que contiene el UUID de FK
        error: {ERROR_CODE}         # código de error si el FK no existe (preferido)
        # notFoundError: {ERROR_CODE} # alias también aceptado por el validador
    outgoingCalls:                  # opcional — llamadas explícitas a puertos externos
      - port: {PortName}            # debe existir en integrations.outbound[]
        method: {methodName}
        params: [{paramName}, ...]  # nombres de input[] pasados al puerto; omitir si ninguno
        bindsTo: {domainMethodParam} # parámetro de domainMethods[method].params al que se asigna el resultado
    implementation: full | scaffold  # full = todos los params resolvibles; scaffold = TODOs pendientes
    authorization:                  # opcional — omitir solo si el endpoint es público (`public: true`)
      rolesAnyOf:                   # RBAC por rol — claim JWT: realm_access.roles
        - ROLE_ADMIN                # con o sin prefijo ROLE_; el generador normaliza para hasAnyRole()
      permissionsAnyOf:             # RBAC granular — claim JWT: permissions — formato recurso:accion
        - catalog:write             # ⚠️ usar dos puntos, nunca puntos (catalog.write es incorrecto)
      scopesAnyOf:                  # OAuth2 Scopes — claim JWT: scope — sin prefijo SCOPE_
        - catalog:write             # el generador añade SCOPE_ automáticamente
      ownership:                    # guarda imperativa en el handler — no genera @PreAuthorize
        field: ownerId              # campo del agregado que identifica al propietario
        claim: sub                  # claim del JWT con el ID del usuario actual
        allowRoleBypass:            # roles que pueden saltarse la verificación de ownership
          - ROLE_ADMIN              # con o sin prefijo ROLE_; el generador normaliza
    # public: true                  # mutuamente excluyente con authorization
    #                               # añade el path a permitAll() en SecurityConfig, omite @PreAuthorize
    #                               # solo para trigger.kind: http
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
      consumes: {NombreEvento}       # nombre canónico del evento (alias legacy: event:)
      channel: {canal-asyncapi}      # opcional — canal AsyncAPI donde llega el evento
      fromBc: {bc-name}              # opcional — BC que publica el evento
      filter: "{expresión Java}"     # opcional — condición booleana; si false el mensaje se descarta
    aggregate: {AggregateName}
    method: {methodName}             # → aggregates[{AggregateName}].domainMethods[{methodName}]
                                     # Excepción — readModel: true: usar "upsert" o "delete"
    # input[] — OPCIONAL para UCs de evento.
    # Si se omite, el generador mapea automáticamente los campos del payload del evento
    # con los params del domainMethod por coincidencia de nombres.
    # Declarar input[] solo cuando necesitas `loadAggregate: true` o cuando quieres
    # incluir campos con tipo que no coincide con el nombre del param del domainMethod.
    input:
      - name: {paramNombreIgualAlPayloadField}
        type: {DSL-type}
        required: true
        source: body                 # "body" = campo del payload del evento (único source válido
                                     # para inputs de UCs event-triggered que declaran input[])
        loadAggregate: true          # opcional — activa findById({param}) antes de invocar el método
    rules: [{RULE-ID}, ...]
    notFoundError: [{ERROR_CODE}]    # omitir cuando no aplica
    fkValidations: []
    implementation: full | scaffold
    # NO declarar idempotency aqui. useCases[].idempotency es solo para commands HTTP;
    # la deduplicacion de eventos usa system.yaml infrastructure.reliability.consumerIdempotency.

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
    # Si repositories[{AggregateName}].queryMethods[].params incluye un filtro que NO
    # viene del request HTTP (ej: customerId del usuario autenticado), declararlo aquí
    # igualmente con source: authContext. El controller lo omitirá del request y el
    # handler lo inyectará desde SecurityContext/JWT. No dejar params de repositorio
    # "implícitos": el validador los rechaza porque generan handlers no compilables.
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
            # Debe existir un useCases[].input con el mismo name para el operationId
            # referenciado por derivedFrom. Si es un filtro server-side/JWT, ese input
            # debe usar source: authContext.
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

  # Un error por cada violation posible del dominio.
  # ⚠️ PROHIBIDO: la clave `constraintName` en errors[]. El constraint de unicidad va en
  #    aggregates[].domainRules[].constraintName cuando type: uniqueness. El generador
  #    rechaza claves fuera de la whitelist: {code, httpStatus, description, message, title,
  #    errorType, chainable, usedFor, messageTemplate, args, kind, triggeredBy}.

  - code: {ERROR_CODE}               # requerido — SCREAMING_SNAKE_CASE, único en el BC
    httpStatus: 404                  # Whitelist exacta (14 valores):
                                     #   400 | 401 | 402 | 403 | 404 | 408 | 409 | 412 | 415 | 422 | 423 | 429 | 503 | 504
                                     # Default: 422 (BusinessException). ⚠️ 500 NO está en la whitelist.
    description: |                   # opcional — renderizada como Javadoc en la clase Java generada
      {descripción del error y cuándo ocurre en el dominio}
    errorType: {ErrorTypeName}       # opcional — override del nombre de clase Java generada.
                                     # PascalCase con sufijo Error (e.g. ProductNotFoundError).
                                     # Default: derivado mecánicamente de code (PRODUCT_NOT_FOUND → ProductNotFoundError).
    chainable: false                 # opcional (default false). true → genera ctor(Throwable cause).
                                     # Usar cuando el error envuelve una excepción de infraestructura
                                     # (DataAccessException, TimeoutException, etc.) que el Fase 3
                                     # dev necesita preservar en el stack trace.
    usedFor: auto                    # opcional (default auto). auto | manual.
                                     # auto: el generador emite WARN si no hay ninguna referencia al code
                                     #       en domainRules, notFoundError, lookups, fkValidations, validations.
                                     # manual: suprime el warning — indica que el throw lo escribe Fase 3.
                                     # Nota: errores con kind: infrastructure se excluyen del warning automáticamente.
    messageTemplate: "Product {id} not found"   # opcional — mensaje parametrizado.
                                     # Placeholders {nombre} deben corresponder 1:1 con args[].name.
    args:                            # requerido si messageTemplate tiene placeholders; vacío si no hay.
      - name: id                     # camelCase Java identifier (^[a-z][a-zA-Z0-9_]*$)
        type: UUID                   # tipo Java válido: UUID, String, int, long, BigDecimal, etc.
    kind: business                   # opcional (default business). business | infrastructure.
    triggeredBy: ""                  # solo válido si kind: infrastructure.
                                     # FQN o nombre simple de la clase de excepción del runtime
                                     # que el advice global traduce a este error de dominio.
                                     # Ej: "org.springframework.dao.DataIntegrityViolationException"


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

# ─── DOMAIN EVENTS ───────────────────────────────────────────────────────────

domainEvents:

  published:
    - name: {EventName}              # PascalCase, tiempo pasado: ProductActivated, OrderConfirmed
      description: {cuándo se emite y qué significa para el negocio}
      version: 1                     # opcional (default 1) — versión del schema del evento.
                                     # Incrementar solo ante cambios breaking del payload.
      scope: both                    # opcional (default both).
                                     #   internal     → solo listeners del mismo BC
                                     #   integration  → solo para BCs externos / sistemas externos
                                     #   both         → ambos (default; el más común)
      channel: {routing-key-o-topic} # opcional — canal AsyncAPI exacto (routing-key en RabbitMQ,
                                     # topic en Kafka). Si se omite, el generador deriva del nombre
                                     # del evento en kebab-case con puntos (ProductActivated → product.activated).
      allowHiddenLeak: true          # opcional (default false) — opt-in CONSCIENTE para incluir en
                                     # el payload un campo marcado hidden: true en el agregado.
                                     # Solo justificado en eventos scope: integration | both que
                                     # deben transportar datos de auditoría o cifrados.
      broker:                        # opcional — hints de broker para el publicador
        partitionKey: {fieldName}    # campo del payload usado como partition key (Kafka)
        headers:                     # headers adicionales del mensaje
          {headerName}: "{value}"
        retry:                       # política de reintentos del publicador
          maxAttempts: 3
          backoff: fixed | exponential
          initialMs: 500
          maxMs: 5000
        dlq:                         # dead-letter del lado publicador
          afterAttempts: 3
          routingKey: {routing-key}  # RabbitMQ: routing key de la DLQ (ej: dead.catalog.product-activated)
          queueName: {queue-name}    # Kafka: nombre del topic DLQ (ej: catalog.product-activated.dlq)
                                     # ⚠️ `dlq.target` NO existe — el build falla si se usa
      payload:
        # ⚠️ NO declarar: eventId, eventType, eventVersion, occurredAt, sourceBc, correlationId, causationId.
        # El generador los inyecta automáticamente como EventMetadata (primer campo del record).
        # Si se declaran, el generador filtra el campo y emite un WARN de deprecación.
        - name: {field}
          type: {canonical-type | EnumName | ValueObjectName}
          required: true | false
          source: aggregate          # opcional — obligatorio cuando la fuente no es unívoca.
                                     # Opciones:
                                     #   aggregate    → this.get{Field}() del agregado raíz (default)
                                     #   param        → parámetro del domainMethod
                                     #   timestamp    → Instant.now() (para campos DateTime extra)
                                     #   constant     → valor literal fijo
                                     #   derived      → expresión derivada o calculada
                                     # ⚠️ PROHIBIDO: source: auth-context en payloads de eventos
                                     #    (INT-025). Los datos del contexto de auth no deben viajar
                                     #    en eventos de integración — viola el principio de bajo
                                     #    acoplamiento con el sistema de identidad externo.
          field: {aggregateFieldName}   # solo cuando source: aggregate y el nombre del payload
                                        # difiere del nombre del campo en el agregado
          param: {paramName}            # solo cuando source: param — nombre del parámetro del domainMethod
                                        # ⚠️ INT-026: el param DEBE existir en domainMethods[method].params[]
          value: "{literal}"            # solo cuando source: constant — valor literal fijo
          # ⚠️ source: derived NO está soportado en payloads de eventos por el validador actual (BC-121).
          # Si el valor es calculado, materializarlo como propiedad del agregado y usar source: aggregate,
          # o resolverlo antes en el handler y publicarlo como source: param.

  consumed:

    # ── Forma A (sin `command:`, preferida) ───────────────────────────────
    # El generador localiza automáticamente el UC con trigger.kind: event, consumes: {name}.
    # Usar cuando el evento tiene un UC formal en useCases[]. Solo declarar name + sourceBc + description.
    - name: {EventName}              # PascalCase. Mismo nombre del evento en el BC publicador.
      sourceBc: {bc-name}            # BC publicador — validado contra system.yaml (INT-007 si no coincide)
      producer: {bc-name}            # OPCIONAL — solo Javadoc; puede diferir de sourceBc si hay intermediario
      description: {efecto que produce este evento en este BC}
      # ⚠️ NO declarar retry ni dlq en consumed[] — son config de infraestructura.
      #    Configurar en system.yaml o archivos de entorno del proyecto.
      #    El generador ignora estos campos con GEN-WARN.

    # ── Forma B (con `command:`) ─────────────────────────────────────
    # Binding explícito. Requiere `payload[]`. Usar para compensadores de saga o
    # adaptadores legacy sin UC formal, o cuando se necesita routing/filter personalizado.
    - name: {EventName}
      sourceBc: {bc-name}            # validado contra system.yaml (INT-007)
      producer: {bc-name}            # OPCIONAL — solo Javadoc
      description: {efecto que produce este evento en este BC}
      command: {UCName}              # ACTIVADOR Forma B — nombre del handler UC. Requiere payload[].
      queueKey: {routing-key}        # OPCIONAL — override de routing-key RabbitMQ
                                     # Default: derivado del nombre del evento en kebab-case
      topicKey: {topic-name}         # OPCIONAL — override del topic Kafka
                                     # Default: derivado del nombre del evento en kebab-case
      filterExpr: "{booleano Java}"  # OPCIONAL — si false el listener descarta el mensaje sin error
      payload:
        - name: {field}
          type: {canonical-type | EventDtoName}
          # Usar EventDtoName (declarado en eventDtos[]) cuando el campo es un objeto
          # complejo que pertenece al BC productor (ej: List[OrderLineSnapshot]).
      # ⚠️ NO declarar retry ni dlq en consumed[] — son config de infraestructura.
      #    El generador los ignora con GEN-WARN.

    # ── Forma C (saga-awareness-only, sin UC, sin listener) ──────────────
    # Usar cuando el evento DEBE estar en consumed[] para satisfacer la topología
    # declarada en system.yaml y en {bc}-async-api.yaml, pero este BC no tiene
    # ninguna acción de dominio que ejecutar al recibirlo.
    #
    # Caso típico: compensaciones de saga cuyo efecto en este BC ya se materializó
    # por un evento anterior. Ejemplo: `orders` ya canceló la orden al recibir
    # `StockReservationFailed`; cuando llega `StockReleased` (confirmación de la
    # compensación del inventario), orders no tiene nada que hacer.
    #
    # El generador:
    #   ✅ Registra la cola y el binding en el broker config (topología correcta)
    #   ❌ NO genera listener Java (no hay comando que despachar)
    #   ✅ Suprime el warning "has no use case with trigger.kind=event"
    - name: {EventName}
      sourceBc: {bc-name}
      listenerRequired: false        # REQUERIDO en Forma C — indica que la ausencia de UC es intencional
      description: >
        Saga-awareness only: {razón por la que este BC conoce el evento pero no actúa}.
        Declarado para satisfacer la topología de system.yaml e {bc}-async-api.yaml.
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
bc → type → description → enums → valueObjects → eventDtos → projections → aggregates → useCases → repositories → errors → integrations → domainEvents
```

---

## Tipos de domainRules

| type | Cuándo usarlo | Sub-atributos propios | Genera |
|------|--------------|----------------------|--------|
| `statePrecondition` | Condición previa para transición de estado (ej: DRAFT → ACTIVE) | — | TODO enriquecido en handler con clase de error; la condición concreta la implementa Fase 3 |
| `uniqueness` | Campo que debe ser único en todo el repositorio | `field` (camelCase, recomendado), `constraintName` (snake_case, requiere `field`) | Con `field`: guard proactivo `findBy{Campo}` en handler. Con `constraintName`: además mapeo reactivo de `DataIntegrityViolationException`. Sin `field`: TODO enriquecido |
| `terminalState` | Estado sin transiciones salientes (ej: CANCELLED, DELETED) | — | Try/catch en métodos que invocan `transitionTo()` del enum |
| `sideEffect` | Acción complementaria documentada (ej: registrar historial) | — (sin `errorCode`) | **Ninguno** — anotación de diseño pura para Fase 3. El generador no emite código ejecutable |
| `deleteGuard` | Condición para permitir eliminación física (chequear dependientes) | `targetAggregate` (PascalCase) + `targetRepositoryMethod` (camelCase) — deben declararse juntos o ninguno | Con ambos: guard ejecutable en handler. Sin ellos: TODO enriquecido. Siempre: método `delete` en repositorio |
| `crossAggregateConstraint` | Invariante que requiere consultar el estado de otro agregado | `targetAggregate` + `field` + `expectedStatus` — los tres deben declararse juntos | Método de query en repositorio del agregado objetivo. El build falla si solo algunos de los tres están presentes |

---

## Checklist de Calidad (yaml v2)

Antes de dar el `{bc-name}.yaml` v2 por completo, verificar:

**Proyecciones:**
- [ ] Cada `returns` de tipo query referencia un nombre en `projections[]`, el nombre de un agregado del BC, o es lista inline de propiedades
- [ ] Ningún nombre en `projections[]` tiene sufijo `*Response`, `*Dto`, `*Request` o `*Payload`
- [ ] Ninguna propiedad en `aggregates[]` ni `entities[]` usa un nombre de `projections[]` como `type`
- [ ] Ningún shape que aparece **sólo** en `returns` (nunca como `type` de un agregado) está declarado en `valueObjects[]` — si es exclusivamente un shape de lectura, debe estar en `projections[]`

**Proyecciones persistentes (`persistent: true`):**
- [ ] Cada proyección con `persistent: true` tiene `source: { kind: event, event, from }` + `keyBy` + `upsertStrategy`
- [ ] `keyBy` referencia un campo declarado en `properties[]`
- [ ] `keyBy` no aparece en ningún `additionalSources[].updatesFields[]`
- [ ] Cada `additionalSources[]` entry tiene `kind: event`, `event`, `from`, y `updatesFields[]` no vacío
- [ ] Todos los campos en `additionalSources[].updatesFields[]` existen en `properties[]`
- [ ] En el BC productor: cada evento de `additionalSources[]` incluye el campo `keyBy` en su `payload[]` (sin él el partial updater descarta el evento silenciosamente en runtime)
- [ ] Si `upsertStrategy: versionGuarded`: el campo `eventVersionField` (o `version`) existe en `properties[]`
- [ ] Si `upsertStrategy: versionGuarded`: el evento fuente (`source.event`) incluye el campo versión en su `payload[]` en el BC productor (precondición INT-027)
- [ ] Si `upsertStrategy: versionGuarded` + `additionalSources[]`: cada evento adicional también incluye el campo versión en su `payload[]`
- [ ] Los eventos referenciados en `source.event` y en `additionalSources[].event` están en `domainEvents.published[]` del BC `from`
- [ ] Si hay `{bc-consumidor}-async-api.yaml`: tiene canales `subscribe` para cada evento fuente de proyecciones persistentes

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
- [ ] Si `consumed[].payload[]` incluye tipos de objetos complejos (ej: `List[OrderLineSnapshot]`): el tipo está declarado en `eventDtos[]` (NO en `valueObjects[]`)

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
**Errors:**
- [ ] `errors[]` tiene una entrada por cada `errorCode` referenciado en `domainRules`, `notFoundError`, `lookups[]`, `fkValidations[]`, `validations[]`
- [ ] `errors[]` tiene una entrada por cada código que aparece en `{bc-name}-flows.md` o en `{bc-name}-internal-api.yaml`
- [ ] Todo código en `errors[]` está referenciado en al menos uno de los anteriores (sin huérfanos; o tiene `usedFor: manual`)
- [ ] `errors[].httpStatus` pertenece a la whitelist exacta: `400 | 401 | 402 | 403 | 404 | 408 | 409 | 412 | 415 | 422 | 423 | 429 | 503 | 504`. ⚠️ `500` NO está permitido.
- [ ] Ningún `errors[]` tiene la clave `constraintName` — esa clave va en `aggregates[].domainRules[].constraintName`
- [ ] Si un error tiene `messageTemplate`, también tiene `args[]` con todos los placeholders cubiertos
- [ ] Si un error tiene `kind: infrastructure`, tiene `triggeredBy` con el FQN de la excepción del runtime
- [ ] Errores lanzados únicamente desde código de Fase 3 (no desde reglas YAML) tienen `usedFor: manual` para suprimir el warning de huérfano

**Domain Events:**
- [ ] Ningún `published[].payload[]` declara los campos canónicos automáticos: `eventId`, `eventType`, `eventVersion`, `occurredAt`, `sourceBc`, `correlationId`, `causationId` — el generador los inyecta vía `EventMetadata`
- [ ] Ningún `published[].payload[]` tiene `source: auth-context` — prohibido en payloads de eventos (INT-025)
- [ ] Todo campo `payload[].source: param` referencia un nombre que existe en `aggregates[].domainMethods[{method}].params[]` (INT-026)
- [ ] Si `published[]` tiene `scope: internal` y hay BCs externos consumiendo el evento → cambiar a `integration` o `both`
- [ ] Si `allowHiddenLeak: true` está presente, el campo del payload referencia explícitamente un campo `hidden: true` del agregado (la excepción es intencional y documentada)
- [ ] Ningún `consumed[]` tiene claves `retry` ni `dlq` — configuración de infraestructura que va en `system.yaml`
- [ ] Si `consumed[].payload[]` incluye tipos complejos de otro BC → el tipo está declarado en `eventDtos[]` (NO en `valueObjects[]`)
- [ ] Todo evento en `consumed[]` sin UC correspondiente (`trigger.kind: event, consumes: {name}`) tiene `listenerRequired: false` declarado explícitamente — si falta, el generador emitirá un warning y no generará listener

**Aggregates — concurrencia y sideEffects:**
- [ ] Aggregates con alta contención entre comandos concurrentes tienen `concurrencyControl: optimistic`
- [ ] Aggregates que participan en sagas con procesos largos tienen `concurrencyControl: optimistic`
- [ ] `domainRules[].type: sideEffect` no tiene `errorCode` (no produce error visible al cliente — es efecto documentado para Fase 3)
- [ ] Si `domainMethods[].emits` es lista, cada entrada está declarada en `domainEvents.published[]`

**Flags de visibilidad:**
- [ ] `id` tiene `readOnly: true` + `defaultValue: generated`
      (en agregados `readModel: true`: verificar además que el ID del BC fuente esté
      como campo separado `{sourceEntity}Id` con `unique: true`, NO fusionado en `id`)
- [ ] Propiedades de estado iniciales tienen `readOnly: true` + `defaultValue: <estado-inicial>`
- [ ] Ningún tipo usa sintaxis Java genérica: buscar `<[A-Z]` en el YAML
      — `Page<X>` → `Page[X]`, `List<X>` → `List[X]`, `Enum<X>` → nombre del enum directamente
- [ ] Campos inyectados del contexto de auth tienen `readOnly: true` + `source: authContext`
- [ ] Campos write-only (passwords, tokens) tienen `hidden: true`
- [ ] Campos puramente internos (contadores técnicos, scores) tienen `internal: true`

**useCases (nuevos campos):**
- [ ] Todo use_case que llama `findById` o busca una entidad in-memory tiene `notFoundError`. Formato lista `[CODE1, CODE2]` si ambos aplican.
- [ ] Todo use_case que recibe FKs de otros agregados tiene `fkValidations[]`
- [ ] `condition` en transiciones de enum es un RULE-ID o `none` (nunca texto libre)
- [ ] Todo use_case tiene `implementation: full | scaffold`
- [ ] Todo UC con `trigger.kind: http` que requiere autenticación declara `authorization` (o `public: true` si es endpoint público)
- [ ] `permissionsAnyOf[]` usa formato `recurso:accion` (dos puntos) — nunca puntos (`recurso.accion`)
- [ ] `scopesAnyOf[]` declara los scopes **sin** prefijo `SCOPE_` (el generador lo añade)
- [ ] Si declara `ownership`, al menos un `input[]` tiene `loadAggregate: true` o existe `lookups[]` que carga el agregado
- [ ] `public: true` y `authorization` no coexisten en el mismo UC
- [ ] Todo UC con `implementation: scaffold` tiene ≥1 flujo **dedicado** en `{bc-name}-flows.md` (ver DECISIÓN-001 en SKILL.md y regla 5.2). Un UC scaffold sin flujo dedicado es un gap táctico bloqueante.
