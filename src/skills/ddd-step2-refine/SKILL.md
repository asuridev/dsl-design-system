---
name: ddd-step2-refine
description: >
  Refina, ajusta o corrige los artefactos del diseño táctico DDD (Paso 2) de un
  Bounded Context ya diseñado. También valida a profundidad la coherencia interna del BC
  y su alineación con arch/system/. Asume dos roles simultáneos: experto de negocio del
  dominio específico + ingeniero senior de diseño de sistemas DDD.
  Usar SIEMPRE que el usuario quiera ajustar, corregir, cuestionar, ampliar o validar el
  diseño táctico de un BC ya generado. Aplica cuando diga frases como "cambia el agregado
  de...", "agrega una entidad a...", "refina el BC de...", "el dominio de [BC] está mal...",
  "agrega un caso de uso...", "la regla de negocio no es así...", "cambia el flujo de...",
  "ajusta el contrato de...", "¿por qué modelaste X como entidad?", "esto debería ser un VO",
  "falta una regla en...", "valida el diseño de [BC]", "¿está coherente el BC?", "encuentra
  inconsistencias en...", "audita el diseño táctico", "¿es correcto el modelo de dominio?",
  o cualquier variante de revisión, cuestionamiento o ajuste sobre artefactos en
  arch/{bc-name}/. También aplica cuando el usuario proporcione nueva información de negocio
  que cambie el modelo de dominio de un BC específico.
  NO aplica para cambios al diseño estratégico (arch/system/) — usar ddd-step1-refine para eso.
---

# DDD Paso 2 — Refinamiento del Diseño Táctico

Este skill ajusta el diseño táctico de un Bounded Context de forma **quirúrgica y consistente**:
solo toca lo que cambia, verifica coherencia con el Paso 1, y lo hace desde una perspectiva
dual que detecta problemas que un prompt genérico no ve.

---

## Tu Rol Durante Esta Sesión

Asumes **dos voces expertas simultáneas**. No son roles alternativos — son una tensión
productiva que enriquece cada análisis.

### Voz 1: Experto de Negocio Especializado en el BC

Conoces el BC desde adentro. Para `catalog` piensas como un product manager de e-commerce.
Para `payments` piensas como un especialista en medios de pago. Para `delivery` piensas
como jefe de flota logística.

- Cuestionas si los agregados reflejan cómo el negocio **realmente** opera
- Detectas cuando una regla de dominio no captura la invariante real del negocio
- Señalas cuando un flujo de excepción está ausente y el negocio lo viviría cotidianamente
- Piensas en los actores: ¿quién ejecuta realmente esta acción? ¿bajo qué condición?
- Nombras entidades con el lenguaje que usaría el equipo de negocio, no el técnico

### Voz 2: Ingeniero Senior de Diseño de Sistemas DDD

Conoces los principios de diseño táctico y sus trade-offs reales.

- Decides qué es Agregado vs Entidad vs VO con criterio de invariantes y ciclo de vida
- Detectas propiedades que deberían ser VOs (semántica de negocio, no solo tipo primitivo)
- Verificas que los flags `readOnly`, `hidden`, `internal`, `unique`, `indexed` estén correctos
- Revisas que los contratos OpenAPI/AsyncAPI cumplan CQRS, naming y convenciones de Money
- Verificas que cada UC scaffold tenga su flujo de especificación en flows.md

Cuando las dos voces estén en tensión, **explícitalo al usuario**. Esa tensión es
información valiosa para la decisión.

---

## Fase 1: Leer el Estado Actual

Antes de responder cualquier solicitud, **siempre** leer los artefactos del BC:

```
arch/{bc-name}/{bc-name}.yaml              ← fuente de verdad táctica
arch/{bc-name}/{bc-name}-spec.md           ← casos de uso
arch/{bc-name}/{bc-name}-flows.md          ← flujos Given/When/Then
arch/{bc-name}/{bc-name}-open-api.yaml     ← contratos REST públicos
arch/{bc-name}/{bc-name}-internal-api.yaml ← contratos REST internos (si existe)
arch/{bc-name}/{bc-name}-async-api.yaml    ← contratos de eventos
arch/{bc-name}/diagrams/                   ← inventario de diagramas
```

Y leer los artefactos del Paso 1:

```
arch/system/system.yaml       ← fuente de verdad estratégica
arch/system/system-spec.md    ← lenguaje ubícuo por BC
AGENTS.md                     ← contexto del sistema
```

Leer todos en paralelo. Si algún artefacto del BC no existe, notificarlo inmediatamente
y preguntar si el usuario quiere ejecutar el Paso 2 primero o si el archivo fue omitido.

Si necesitas validar estructura o convenciones del `{bc-name}.yaml`, leer:
→ `../ddd-step2-tactical-design/references/bc-yaml-guide.md` — ejemplos anotados, distinción `condition` vs `rules`, flags de agregado, convenciones de naming y relación con los demás artefactos

---

## Fase 1B: Validación Profunda

Esta fase se ejecuta en **dos escenarios**:

1. **Validación standalone**: el usuario pide validar, auditar o encontrar problemas.
   Esta fase ES la respuesta principal — generar el informe diagnóstico completo y
   ofrecer aplicar las correcciones detectadas.

2. **Pre-validación de refinamiento**: el usuario pide un cambio. Ejecutar esta fase
   antes de aplicar el cambio para garantizar que no se introduce deuda sobre un diseño
   ya inconsistente.

Ejecutar **todos** los checklists en orden. No omitir checklists aunque el diseño
"parezca correcto" a primera vista.

### Formato del Informe Diagnóstico

```
## Informe Diagnóstico — BC: [nombre]

**Estado general:** ✅ Limpio / ⚠️ Con alertas (N) / ❌ Con errores (N)

### [Checklist nombre]
| # | Severidad | Problema | Elemento afectado | Corrección propuesta |
|---|-----------|----------|-------------------|----------------------|
| 1 | 🔴 ERROR   | ...      | ...               | ...                  |
| 2 | 🟡 ALERTA  | ...      | ...               | ...                  |
| 3 | 🔵 SUGERENCIA | ...   | ...               | ...                  |
```

**Niveles de severidad:**
- 🔴 **ERROR**: el diseño es incorrecto o inconsistente. Debe corregirse antes de continuar.
- 🟡 **ALERTA**: el diseño funciona pero introduce riesgo de deuda técnica o ambigüedad.
- 🔵 **SUGERENCIA**: mejora de calidad no crítica — naming, convenciones, claridad.

---

### Checklist A — Coherencia con arch/system/ (Paso 1)

**A1 — El BC existe en system.yaml**
- ¿El BC está declarado en `boundedContexts[].name`?
  - No existe → 🔴 ERROR: detener — no hay base estratégica para este diseño táctico

**A2 — Integraciones en bc.yaml ↔ system.yaml**
- Cada integración `outbound` en bc.yaml, ¿tiene su contrato correspondiente en las
  `integrations[]` de system.yaml donde `from: este-bc`?
- Cada integración `inbound` en bc.yaml, ¿tiene su contrato en `integrations[]` de system.yaml
  donde `to: este-bc`?
- Los nombres de operaciones en bc.yaml, ¿coinciden exactamente con `contracts[].name`
  en system.yaml?
  - Integración en bc.yaml sin contrato en system.yaml → **Checklist D**
  - Nombre de operación que no coincide → 🔴 ERROR

**A3 — Eventos de dominio ↔ contratos de system.yaml**
- Para cada evento en `domainEvents.published[]`, ¿existe un contrato en system.yaml con ese
  `name` PascalCase en la integración `from: este-bc, channel: message-broker`?
- Para cada evento en `domainEvents.consumed[]`, ¿existe un contrato en system.yaml con ese
  `name` en la integración `to: este-bc, channel: message-broker`?
- Para cada evento en `domainEvents.consumed[]`, ¿declara `sourceBc` y coincide exactamente con
  el `from` de la integración correspondiente en system.yaml?
  - Falta `sourceBc` o no coincide → 🔴 ERROR: corregir el evento consumido. **No basta con
    declarar `from`**; el validador usa `sourceBc` para reconocer publishers declarados pero aún
    no diseñados y degradar `INT-007` de error a warning.
- El `channel` del evento en el AsyncAPI, ¿coincide exactamente con el `channel` del
  contrato en system.yaml?
  - Evento sin contrato declarado → 🔴 ERROR
  - Canal AsyncAPI que no coincide con system.yaml → 🔴 ERROR (el BC nunca recibirá el evento)

**A4 — Agregados declarados en system.yaml presentes en bc.yaml**
- Los agregados listados en `system.yaml → boundedContexts[bc].aggregates[].root`,
  ¿están presentes en bc.yaml?
  - Agregado en system.yaml ausente en bc.yaml → 🟡 ALERTA: puede haberse dividido o
    renombrado conscientemente — preguntar al diseñador antes de marcar como error

**A5 — Sagas en bc.yaml ↔ system.yaml sagas[]**
- Para cada UC con `sagaStep`, el saga referenciado (`sagaStep.saga`) debe existir en
  `sagas[].name` en system.yaml.
- Para cada paso en system.yaml `sagas[].steps[]` donde `step.bc: este-bc`:
  - ¿Existe un UC con `sagaStep.order` y `sagaStep.role: step`?
  - Si el paso tiene `compensation`, ¿existe un UC con `sagaStep.role: compensation`?
  - Paso de saga sin UC correspondiente → 🔴 ERROR
- **Verificación de listeners de compensación:**
  - Para cada paso de la saga donde `step.bc != este-bc` pero la *compensación de ese paso* requiere
    que **este BC reaccione** (el `step.compensation` es un evento que este BC debe publicar):
    el evento que *dispara* esa compensación (el `onFailure` del paso siguiente) debe estar en
    `domainEvents.consumed[]` de este BC con un UC con `sagaStep.role: compensation`.
  - Compensation trigger sin UC en `consumed[]` → 🔴 ERROR: el listener de compensación NO
    se genera automáticamente desde `system.yaml#/sagas[].compensation`; sin declaración
    explícita en `consumed[]`, la compensación nunca se ejecuta en runtime.
- **Verificación de payloads de saga:**
  - El campo de correlación de la saga (ej: `orderId`) debe estar en el payload de **todos**
    los eventos del saga que este BC publica o consume.
    - Evento de saga sin campo de correlación → 🔴 ERROR
  - Los eventos de compensación publicados deben incluir el ID del recurso revertido
    (ej: `reservationId`) para que el consumidor pueda confirmar cuál recurso fue liberado.
    - Compensation event sin ID de reversión → 🟡 ALERTA
  - Los eventos de compensación consumidos deben incluir el ID del recurso a revertir
    (ej: `reservationId`) en el payload — sin él el handler no puede localizar el recurso.
    - Compensation trigger consumido sin ID de reversión → 🔴 ERROR
- **`sagaStep.compensatedBy`**: si el UC tiene `role: step`, debe referenciar el UC-ID
  del handler de compensación de este mismo paso.
  - `compensatedBy` apunta a un UC-ID que no existe → 🔴 ERROR

**A6 — Sistemas externos ↔ system.yaml externalSystems**
- Cada integración `type: externalSystem` en bc.yaml debe referenciar un sistema
  en `externalSystems[]` de system.yaml.
  - Sistema externo no declarado en system.yaml → **Checklist D**

---

### Checklist B — Consistencia Interna del BC

**B1 — Enum transitions → triggeredBy → UC-IDs válidos**
- Cada `transitions[].triggeredBy` en los enums, ¿referencia un UC-ID que exista
  en `useCases[]`?
  - triggeredBy sin UC-ID correspondiente → 🔴 ERROR
- El formato de `triggeredBy`, ¿usa la forma larga `UC-{ABREV}-{NNN} NombreUC`?
  - Formato corto (solo UC-ID sin nombre, ej: `UC-CST-005`) → 🔵 SUGERENCIA: normalizar al formato largo para facilitar trazabilidad (ej: `UC-CST-005 DeactivateCustomer`)

**B2 — domainRules: type asignado y errorCode → OpenAPI 4xx**
- ¿Cada domainRule tiene `type` asignado?
  - domainRule sin type → 🟡 ALERTA
- Para cada domainRule con `errorCode`, ¿existe ese código como valor `code` en un
  response 4xx del OpenAPI o internal-api?
  - errorCode en domainRule sin response 4xx en OpenAPI → 🔴 ERROR

**B3 — errors[] → responses 4xx en OpenAPI**
- Para cada entrada en `errors[]`, ¿existe al menos un response 4xx en el OpenAPI
  o en flows.md que use ese código?
  - Error declarado pero nunca referenciado → 🔵 SUGERENCIA

**B4 — Use Cases http → operationId en OpenAPI/Internal-API**
- Cada UC con `trigger.kind: http`, ¿tiene su `trigger.operationId` en el OpenAPI
  público o en el internal-api?
  - operationId sin match en OpenAPI → 🔴 ERROR

**B5 — notFoundError → errors[] con httpStatus 404**
- Cada código en `notFoundError` (string o lista), ¿existe en `errors[]` con
  `httpStatus: 404`?
  - notFoundError sin entrada en errors[] → 🔴 ERROR

**B6 — fkValidations → aggregates existentes y errors[]**
- Cada código en `fkValidations[].error` o `fkValidations[].notFoundError` (código de error si el FK no existe), ¿existe en `errors[]`?
  - error de FK sin entrada en errors[] → 🔴 ERROR
- Los campos permitidos en cada entry son `aggregate`, `param`, `error`, `notFoundError`, `bc` y `conditional`.
  - Entry con `field` en lugar de `param` → 🔴 ERROR: nombre de campo incorrecto — el generador no puede resolver la validación
  - `error` es el nombre preferido por consistencia, pero el validador también acepta `notFoundError` como alias para el mismo código.
  - (`bc` es para FKs cross-BC; ver B23. `conditional` es un flag booleano opcional que suprime la FK cuando el campo está ausente/null)

**B7 — UC scaffold → flujo dedicado en flows.md**
- Cada UC con `implementation: scaffold`, ¿tiene ≥1 flujo en flows.md que lo cubra?
  - UC scaffold sin flujo → 🔴 ERROR: Fase 3 (implementación) no tendrá especificación ejecutable

**B8 — domainMethods[].emits → domainEvents.published[]**
- Para cada agregado con `domainMethods[]`: cada valor no-null en `domainMethods[].emits`, ¿existe en `domainEvents.published[].name`?
  - Evento emitido en `domainMethods` sin entrada en `published` → 🔴 ERROR
- Si un UC declara `emits` o `emitsList`, cada valor no-null debe existir en `domainEvents.published[].name`.
  - Evento emitido en `useCases[]` sin entrada en `published` → 🔴 ERROR
- `emits` y `emitsList` en `useCases[]` son válidos. Para diseños nuevos, preferir `domainMethods[].emits` cuando el evento pertenece a un método de dominio, pero no marcar como error un UC existente solo por declarar `emits` a nivel de use case.
- Entradas duplicadas en `domainMethods[].emits` (sea string o lista) → 🔴 ERROR: el validador rechaza listas con el mismo nombre de evento más de una vez.

**B8b — Commands: `method` referencia `domainMethods` existentes**
- Para cada UC con `type: command` cuyo `method` no sea `upsert` ni `delete`:
  - ¿Existe una entrada en `aggregates[aggregate].domainMethods[]` cuyo `name` coincide con `method`?
  - `method` sin correspondencia en `domainMethods` → 🔴 ERROR: el generador no puede resolver la invocación
- Para cada UC con `type: command` cuyo `method` ES `upsert` o `delete`:
  - ¿El `aggregate` tiene `readModel: true`?
  - `method: upsert` o `method: delete` en un agregado sin `readModel: true` → 🔴 ERROR: estas operaciones solo aplican a proyecciones

- **`domainMethods[].create` debe declarar `returns: <AggregateName>`** (no `void`).
  El generador solo emite el método estático `public static <Aggregate> create(...)` cuando
  `returns` es el nombre del agregado. Con `returns: void` la creación queda privada y
  sin acceso desde fuera del agregado → el código generado no compila en tiempo de uso.
  → 🔴 ERROR: corregir a `returns: Category`, `returns: Product`, etc.

**B8c — Commands: `implementation: full` solo cuando todos los params son resolvibles**
- Para cada UC con `type: command` e `implementation: full`:
  - Para cada `domainMethods[method].params[]`: ¿existe un `input[]` cuyo `name` coincide, o un `outgoingCalls[].bindsTo` que lo cubre?
  - Param de `domainMethods` no cubierto por `input[]` ni `outgoingCalls[].bindsTo` con `implementation: full` → 🔴 ERROR: debe ser `scaffold`
- Para cada UC con `type: command` e `implementation: scaffold`:
  - Si todos los `domainMethods[method].params[]` están cubiertos → 🔵 SUGERENCIA: puede ser `full`

**B8d — `repositoryMethod` en use cases (campo eliminado)**
- Para cada UC: ¿tiene el campo `repositoryMethod`?
  - UC con `repositoryMethod` → 🔴 ERROR: campo eliminado en el nuevo formato. Eliminar del UC (la persistencia la infiere el generador desde la lógica del handler).

**B8e — useCases[].rules[] → domainRules existentes**
- Para cada UC con `rules[]` declarado: cada ID en la lista, ¿existe como `id` en
  algún `aggregates[].domainRules[]` del BC?
  - ID en `rules[]` que no corresponde a ninguna domainRule → 🔴 ERROR: la
    validación queda referenciada pero sin implementación — el generador falla
    al generar el handler.

**B9 — UC event-triggered → domainEvents.consumed[]**
- Cada UC con `trigger.kind: event`, ¿tiene `trigger.event` en `domainEvents.consumed[]`?
  - Evento en trigger sin entrada en consumed → 🔴 ERROR

**B10 — Repositories: métodos derivados y `queryMethods`**
- Cada domainRule `type: uniqueness` o propiedad `unique: true` en el agregado raíz,
  ¿tiene su `findBy{campo}` en `repositories[aggregate].methods[]`?
- Cada query UC con `trigger.kind: http` sin ningún `input[]` con `loadAggregate: true` (Path B),
  ¿tiene un `queryMethod` correspondiente en `repositories[aggregate].queryMethods[]` cuyos
  `params[]` coinciden en nombre con los `input[]` del UC?
  - queryMethod faltante para UC Path B → 🟡 ALERTA: el generador no puede identificar el método de lectura
- Métodos de listado con filtros (GET con query params) en `methods[]` en lugar de `queryMethods[]`:
  → 🟡 ALERTA: los métodos de listado deben ir en `queryMethods[]`, no en `methods[]`.

**B11 — Properties: flags readOnly/hidden/internal**
- `id` en cada agregado y entidad, ¿tiene `readOnly: true` y `defaultValue: generated`?
  - id sin readOnly → 🔴 ERROR
  - **Excepción `readModel: true`:** El `id` del agregado de proyección sí lleva
    `defaultValue: generated` (es el PK interno). Verificar además que exista un campo
    separado `{sourceEntity}Id` con `unique: true` para el ID espejado del BC fuente.
    Si el diseño fusionó ambos en `id` sin `defaultValue: generated` → 🔴 ERROR:
    reestructurar con el patrón de dos campos (`id` generated + `{sourceEntity}Id` unique).
- Propiedades de estado inicial (enumerados), ¿tienen `readOnly: true`?
  - Estado inicial sin readOnly → 🟡 ALERTA
- Campos calculados por el servidor (`slug`, totales derivados), ¿tienen `readOnly: true`?
  - Campo calculado sin readOnly → 🟡 ALERTA
- Campos inyectados de authContext, ¿tienen `readOnly: true` y `source: authContext``?
  - Campo de authContext sin flag → 🟡 ALERTA
  - **Criterio de identificación** — un campo necesita `source: authContext` si cumple las tres condiciones:
    1. El valor proviene del usuario autenticado (no del request body ni de parámetros de ruta/query)
    2. Es inmutable después de la creación (ningún UC posterior lo modifica)
    3. Registra **quién** ejecutó la acción (auditoría de responsabilidad)
  - Campos típicos con `source: authContext`: `createdBy`, `customerId` inyectado desde JWT, `operatorId` en acciones de backoffice
  - Campos que NO usan `source: authContext` aunque parezcan candidatos: campos asignables por el actor desde el request (`assignedTo`, `ownerId` editable), estado inicial (`defaultValue:` es el flag correcto), timestamps del servidor (`auditable: true` los inyecta automáticamente)

**B12 — Properties: flags unique/indexed**
- Propiedad referenciada por domainRule `type: uniqueness`, ¿tiene `unique: true`?
- Propiedad usada como query param en GET y sin `unique: true`, ¿tiene `indexed: true`?
  - Flag faltante → 🟡 ALERTA

**B12b — Value Objects: validaciones en propiedades**
- Para cada VO en `valueObjects[]`, revisar todas sus propiedades:
  - ¿Existe alguna propiedad con restricciones de negocio que el tipo canónico no captura?
    - `Decimal` o `Integer` con semántica de positivo/rango → ¿tiene `positive: true`, `min`, `max`?
    - `String(n)` con formato conocido (código, referencia, ISO) → ¿tiene `pattern`?
    - `String(n)` con longitud mínima de negocio → ¿tiene `minLength`?
    - `List` con cardinalidad mínima/máxima de negocio → ¿tiene `minSize`/`maxSize`?
  - Propiedad de VO con restricción de negocio evidente sin `validations` → 🟡 ALERTA: diseño incompleto.
    El generador no podrá aplicar la constraint en los commands que usen este VO como tipo.
  - VO que declara un `pattern` sobre propiedad con `type: Email` o `type: Url` (canónicos) →
    🔵 SUGERENCIA: el tipo canónico ya valida el formato en su constructor; eliminar el `pattern` redundante.

**B13 — auditable y softDelete: campos no declarados manualmente**
- Agregado con `auditable: true`, ¿declara `createdAt` o `updatedAt` manualmente?
  - Declarados manualmente → 🟡 ALERTA (el generador los inyecta; la declaración manual duplica)
- Agregado con `softDelete: true`, ¿declara `deletedAt` manualmente?
  - Declarado manualmente → 🟡 ALERTA

**B14 — ReadModel aggregates: campos obligatorios**
- Todo agregado con `readModel: true`, ¿tiene `sourceBC` y `sourceEvents[]`?
- `sourceBC`, ¿existe en `boundedContexts[].name` de system.yaml?
- Cada evento en `sourceEvents[]`, ¿existe en `domainEvents.consumed[].name`?
- Los UCs del readModel, ¿tienen `trigger.kind: event` y `actor: system`?
  - Campo faltante o inconsistente → 🔴 ERROR

**B15 — Inventario de diagramas**
- Calcular el inventario exacto derivable del bc.yaml:
  - Siempre: `{bc-name}-diagram.mmd` y `{bc-name}-diagram-domain-model.mmd`
  - 1 por cada `enum` con al menos un valor con `transitions` no vacías:
    `{bc-name}-diagram-{entity}-states.mmd`
  - 1 por cada operación en `integrations.outbound[].operations[]`:
    `{bc-name}-diagram-{op-kebab}-seq.mmd`
  - 1 por cada agregado con `readModel: true`:
    `{bc-name}-diagram-{readmodel-kebab}-sync-seq.mmd`
  - Archivo en diagrams/ que no está en el inventario → 🔵 SUGERENCIA
  - Archivo del inventario ausente en diagrams/ → 🟡 ALERTA

**B16 — Resolución de tipos: todo tipo referenciado debe estar declarado**

Este es el error más silencioso del diseño táctico: un tipo aparece como `type:` en
propiedades o payloads pero nunca fue declarado en el YAML. El generador no puede
resolver el tipo y falla en tiempo de generación de código.

Recopilar todos los valores `type:` que NO sean tipos canónicos (ver `../ddd-step2-tactical-design/references/canonical-types.md`).
Para cada uno verificar:

| Lugar de referencia | Qué verificar |
|---|---|
| `aggregates[].properties[].type` | ¿Existe en `enums[]` o `valueObjects[]`? |
| `aggregates[].entities[].properties[].type` | ¿Existe en `enums[]` o `valueObjects[]`? |
| `valueObjects[].properties[].type` | ¿Es tipo canónico? (los VOs no pueden referenciar otros VOs salvo composición real) |
| `eventDtos[].properties[].type` | ¿Es tipo canónico, enum, otro eventDto o VO de este BC? |
| `domainEvents.published[].payload[].type` | ¿Existe en `enums[]` o `valueObjects[]`? |
| `domainEvents.consumed[].payload[].type` | ¿Existe en `enums[]`, `valueObjects[]` o `eventDtos[]`? |
| `repositories[].methods[].params[].type` | ¿Existe en `enums[]`, `valueObjects[]` o agregados del BC? |
| `repositories[].methods[].returns` | ¿El tipo base (sin `?`, `[]` o `Page[...]`) está declarado? |

- Tipo referenciado que no existe en `enums[]`, `valueObjects[]`, `eventDtos[]` ni es canónico → 🔴 ERROR: bloquea la generación de código. Declarar el VO/enum/eventDto faltante con sus propiedades.
- Tipo en `consumed[].payload[]` que es objeto compuesto de un BC externo y está declarado en `valueObjects[]` → 🟡 ALERTA: mover a `eventDtos[]` para no contaminar el modelo de dominio propio.

**B16b — Snapshot VO: convención de sufijo para VOs de evento**
- Para cada campo en `domainEvents.published[].payload[]` cuyo tipo es un VO o `List[VO]`
  y cuyo nombre coincide con una entidad declarada en `aggregates[].entities[]` del BC
  (ej: campo `lines` con tipo `List[OrderLine]`, entidad `OrderLine`):
  - El tipo del payload **no debe ser el nombre de la entidad** — las entidades son mutables
    y no serializables como contrato del evento.
  - Si el VO de payload NO tiene sufijo `Snapshot` y se llama igual que una entidad → 🟡 ALERTA:
    renombrar el VO a `{NombreEntidad}Snapshot` para evitar colisión de namespaces y hacer
    explícita la semántica de foto inmutable.
  - Si el tipo del payload ES directamente el nombre de una entidad (no un VO declarado en
    `valueObjects[]`) → 🔴 ERROR: las entidades no son tipos válidos en el payload de un evento
    — declarar un `{Entidad}Snapshot` VO en `valueObjects[]` con solo los campos que el
    consumidor necesita.
- Para cada campo con `source: aggregate` en `domainEvents.published[].payload[]`:
  - Verificar que el `field` (o `name`) referenciado existe en `aggregates[].properties[]`.
  - Verificar que el tipo del campo en el agregado coincida con el tipo declarado en el payload.
    - Tipos distintos (ej: agregado guarda `List[OrderLine]` pero el payload declara
      `List[OrderLineSnapshot]`) → 🔴 ERROR: `source: aggregate` emite `this.getField()` sin
      transformación; el código no compila. Usar `source: param` y declarar el parámetro en
      `domainMethods[].params[]` con el tipo Snapshot.

**B17 — Sintaxis Java genérica prohibida**

El generador parsea los tipos literalmente. Cualquier uso de sintaxis con ángulos (`<>`) — habitual en lenguajes de implementación, ajena al DSL — produce fallos silenciosos en generación:

| Patrón prohibido | Corrección | Error que produce |
|---|---|---|
| `returns: Page<X>` | `returns: Page[X]` | el reader no reconoce el tipo paginado → método de listado degradado, fallo en tiempo de ejecución |
| `returns: List<X>` | `returns: List[X]` | tipo no reconocido → propiedad generada con tipo desconocido |
| `type: Enum<X>` | `type: X` (nombre del enum directamente) | tipo no resuelto → la generación falla |
| `type: List<X>` | `type: List[X]` | ídem List<X> |

Buscar en todo el YAML: `/<[A-Z]` (apertura de ángulo seguida de mayúscula). Cada ocurrencia → 🔴 ERROR: corregir antes de pasar al generador.
- Patrón típico: `OrderLineSummary`, `CartItemSnapshot`, `ProductRef` en payloads de eventos — son VOs implícitos que deben declararse explícitamente.

**B18 — domainEvents.published: payload obligatorio**
- Para cada evento en `domainEvents.published[]`:
  - ¿Tiene `payload[]` con al menos un campo?
  - ¿Incluye el ID del agregado raíz (`{aggregate}Id: Uuid`)?
  - ¿Declara manualmente `eventId`, `eventType`, `eventVersion`, `occurredAt`, `sourceBc`, `correlationId`, `causationId` en `payload[]`?
  - Evento sin `payload` (campo ausente o lista vacía) → 🔴 ERROR: el consumidor no puede actuar sin datos — rompe el contrato del evento
  - Evento con alguno de esos campos en `payload[]` → 🟡 ALERTA: forman parte de `EventMetadata` y el generador los auto-inyecta — eliminar del `payload[]` (ver E4)

**B19 — domainEvents.consumed: UC obligatorio + payload**
- Para cada evento en `domainEvents.consumed[]`:
  - ¿Declara `sourceBc`? ¿Ese valor coincide con el BC publisher del contrato en `system.yaml`?
  - Evento consumido sin `sourceBc` → 🔴 ERROR: añadir `sourceBc: {publisher-bc}`. El campo `from`
    puede mantenerse solo como documentación legacy, pero no sustituye a `sourceBc`.
  - ¿Existe un UC en `useCases[]` con `trigger.kind: event` y `trigger.event` igual al `name` de este evento?
  - Evento consumido sin UC → 🔴 ERROR: gap de diseño — el generador no puede crear el handler y la intención es ambigua. Añadir un UC con la lógica de dominio correspondiente.
- Para cada evento en `domainEvents.consumed[]`:
  - ¿Tiene `payload[]` con al menos un campo?
  - Evento consumido con UC pero sin `payload` (campo ausente o lista vacía) → 🔴 ERROR: el generador no puede construir el message handler sin saber qué campos leer del mensaje — falla en tiempo de generación de código
  - Verificar que el payload incluye al mínimo:
    - Para **saga handlers** (`sagaStep` presente): el ID del agregado que el UC carga del repositorio (ej: `orderId: Uuid`)
    - Para **LRM handlers** (UC sobre agregado `readModel: true`): todos los campos que la proyección necesita replicar → comparar con el `payload[]` del evento correspondiente en `domainEvents.published[]` del BC fuente
    - Para cualquier otro event-triggered UC: el ID del agregado afectado + campos usados en la lógica del UC (`occurredAt` disponible vía `EventMetadata` — no declararlo en `payload[]`)
  - Payload incompleto que falta el ID del agregado a cargar → 🔴 ERROR: el handler no puede ejecutar `repositoryMethod: findById`
  - Payload incompleto en LRM handler (faltan campos que la proyección usa) → 🔴 ERROR: la proyección quedará desincronizada — el dato que el LRM no recibe en el evento tendrá que buscarlo en el BC fuente (acoplamiento sincrónico encubierto)

**B20 — repositories.list: params sin mapeo a propiedad necesitan `filterOn` y `operator`**
- Para cada método en `repositories[].methods[]` de tipo listado (`returns: Page[...]` o `List[...]`):
  - Para cada param cuyo `name` no coincide con ninguna propiedad del agregado raiz (típicamente: `search`, `q`, `query`, `keyword`):
    - ¿Tiene `filterOn[]` con al menos una propiedad que exista en el agregado?
    - ¿Tiene `operator` con un valor válido (`EQ`, `LIKE_CONTAINS`, `LIKE_STARTS`, `LIKE_ENDS`, `GTE`, `LTE`, `IN`)?
    - Param sin `filterOn` → 🔴 ERROR: el generador no puede inferir sobre qué columna(s) aplica el filtro — gap de diseño que produce código incorrecto o incompleto.
    - `filterOn` presente pero sin `operator` → 🔴 ERROR: el operador es parte del predicado; sin él el generador no puede construir la cláusula WHERE.
    - Verificar además que el UC asociado tenga `implementation: scaffold` si `filterOn`/`operator` no están declarados.

**B21 — métodos con calificador de estado (`Active`, `NonDeleted`, etc.)**
- Para cada método en `repositories[].methods[]` o `queryMethods[]` cuyo nombre usa un calificador de estado (ej: `findActiveByCustomerId`, `countActiveByX`, `existsNonDeletedByY`, `searchActive`):
  - ¿El agregado asociado tiene `softDelete: true`?
  - ¿El agregado tiene una propiedad `status`/`*Status` con un valor compatible (`ACTIVE`, `DELETED`, etc.)?
  - Si el agregado tiene `softDelete: true` pero **no** tiene campo `status`: el calificador `Active` es ambiguo → 🔴 ERROR. El generador infiere `status = 'ACTIVE'` pero la columna no existe. Renombrar el método usando `NonDeleted` (ej: `countNonDeletedByCustomerId`) para que el generador derive `deleted_at IS NULL`.
  - Si el agregado tiene `softDelete: true` **y** tiene campo `status`: 🟡 ALERTA. El calificador es ambiguo — clarificar si el predicado filtra por `status = 'ACTIVE'`, por `deleted_at IS NULL`, o por ambos. Elegir un nombre que exprese sin ambigüedad la intención.
  - Si el qualifier no existe en el enum de estado y tampoco es soft delete válido → 🔴 ERROR: el validador falla antes de generación.
  - En `find{Qualifier}By{Field}`, verificar además que `{Field}` exista en el agregado raíz y que el retorno sea `T?`, `List[T]` o `Page[T]`.
  - **Calificador de bandera booleana:** si `{Qualifier}` no es de estado ni soft-delete, el generador lo resuelve contra una propiedad `Boolean` `is{Qualifier}` del agregado (ej: `findDefaultByCustomerId` → `isDefault`). Verificar que esa propiedad booleana exista. ⚠️ La propiedad **debe** llamarse `isDefault`, nunca `default` (palabra reservada — ver B24). `Non`/`Not` niegan la bandera.

**B22 — `fkValidations` sobre campos con `source: authContext`**
- Para cada UC con `fkValidations[]` no vacío:
  - Para cada entrada en `fkValidations[]`, localizar el `input[]` cuyo `name` coincide con `fkValidations[].param` en el UC.
  - ¿Ese `input[]` tiene `source: authContext`?
  - Si tiene `source: authContext`: la validación de FK es redundante — el campo viene del contexto de autenticación (ya validado por la capa de seguridad) y nunca del request body. El generador emitiría un puerto de salida hacia ese BC sin adaptador implementador → fallo en el arranque del servicio porque la dependencia no se puede satisfacer. → 🔴 ERROR: eliminar la entrada `fkValidations[]` del UC y, si el código en `fkValidations[].error` solo era referenciado desde esa FK, eliminar también la entrada de `errors[]`.

**B23 — `fkValidations[].aggregate` sin entrada en `integrations.outbound`**
- Para cada UC con `fkValidations[]` no vacío:
  - Para cada entrada, ¿el valor de `aggregate` corresponde a un agregado local del BC actual o a un agregado de un BC externo con entrada en `integrations.outbound[]`?
  - Si `fkValidations[].aggregate` es de un BC externo pero no hay entrada en `integrations.outbound` para ese BC: el generador produce el puerto de salida hacia ese BC pero ningún componente lo implementa → fallo en el arranque del servicio porque la dependencia queda sin proveedor. → 🔴 ERROR. Opciones: (a) declarar la integración outbound hacia ese BC si la comunicación HTTP real existe, o (b) eliminar la `fkValidation` si la validación es innecesaria.
  - **Excepción:** si el `aggregate` es un agregado local del mismo BC — no se necesita `integrations.outbound`.

**B24 — Nombres de propiedad: palabras reservadas y banderas booleanas**
- Revisar el `name` de toda propiedad/param: `aggregates[].properties[]`, `aggregates[].entities[].properties[]`, `valueObjects[].properties[]` y `repositories[].*.params[]`.
- Nombre que coincide con una **palabra reservada de Java/SQL/JPQL** (`default`, `class`, `case`, `new`, `enum`, `package`, `order`, `group`, `user`, `key`, `value`, `level`, `desc`, `asc`, `from`, `select`, `where`…) → 🔴 ERROR: el generador lo emite como identificador Java y ruta JPQL/columna; no compila o la query falla. Renombrar.
- Propiedad `Boolean` cuyo nombre **no** empieza por `is`/`has` (ej: `default`, `active`, `verified`) → 🔵 SUGERENCIA: usar el prefijo `is`/`has` (`isDefault`, `isActive`, `isVerified`). Además de la convención, habilita el calificador de repositorio `find{Flag}By…` (ver B21). El caso `default` es 🔴 ERROR por ser palabra reservada.

---

### Checklist C — Calidad del Diseño del Dominio

**C1 — Entidades candidatas a agregado propio**
- Para cada entidad en composición dentro de un agregado, ejecutar el test:
  - ¿Puede existir sin el Aggregate Root?
  - ¿Es referenciada por múltiples instancias del Root?
  - ¿Tiene operaciones CRUD independientes en la API o UI?
  - ≥2 SÍ → 🟡 ALERTA: candidata a agregado separado dentro del mismo BC

**C2 — Primitivos candidatos a VO**
- Para campos de tipo String/Decimal/Int con semántica de negocio específica:
  - Precio/monto → `Money`, email → `Email`, código postal → `PostalCode`, teléfono → `PhoneNumber`
  - Si existe un tipo canónico en `../ddd-step2-tactical-design/references/canonical-types.md`
    y no se está usando → 🔵 SUGERENCIA

**C3 — Transiciones con condition != none → RULE-ID existente**
- Cada `transitions[].condition` que no sea `none`, ¿referencia una RULE-ID existente
  en `domainRules[]`?
  - condition con RULE-ID inexistente → 🔴 ERROR: la transición referencia una regla que no existe

**C4 — OpenAPI: cumplimiento CQRS**
- `GET` → siempre tiene response body con datos del recurso
- `POST` → 201 + header `Location`, sin body
- `PATCH` / `DELETE` → 204, sin body
  - Comando con response body → permitido solo si el UC command declara `returns` y coincide con el schema de respuesta
  - Query sin body de respuesta → 🟡 ALERTA

**C5 — OpenAPI: Money como string**
- Todo campo monetario en schemas OpenAPI debe ser `type: string` (decimal string)
  - Monto como `type: number` o `type: integer` → 🔴 ERROR (pérdida de precisión + OWASP A04)

**C6 — AsyncAPI: canales consumidos ↔ system.yaml**
- El `channel` de cada sección `subscribe` en el AsyncAPI, ¿coincide exactamente con
  el `channel` del contrato en system.yaml?
  - Canal que no coincide → 🔴 ERROR (el BC nunca recibirá el evento en producción)

**C7 — Naming conventions**
- Agregados, entidades, VOs: PascalCase inglés
- Enums: PascalCase inglés con sufijo `Status`, `State` o `Type`
- domainRules IDs: `{PREFIX}-RULE-NNN` (PREFIX = abreviatura del BC en MAYÚSCULAS)
- UC IDs: `UC-{ABREV}-{NNN}`
- Flow IDs: `FL-{ABREV}-{NNN}`
- Incumplimiento → 🔵 SUGERENCIA

---

### Checklist E — Validaciones Específicas de Características del Generador

Este checklist captura validaciones bloqueantes derivadas de capacidades del
generador. Si alguna falla, el generador rechaza el YAML o produce código
incorrecto en runtime — son ERROR salvo indicación contraria.

#### E1 — Aggregates: `concurrencyControl` y `domainRules` whitelist

- **`concurrencyControl`**: si está declarado, su único valor válido es `optimistic`.
  - Cualquier otro valor → 🔴 ERROR.
  - Si el agregado tiene escrituras concurrentes desde múltiples UCs y NO declara
    `concurrencyControl: optimistic` → 🟡 ALERTA: candidato a optimistic locking.

- **`domainRules[].type` whitelist estricta**:
  `uniqueness | statePrecondition | terminalState | sideEffect | deleteGuard | crossAggregateConstraint`.
  Cualquier otro valor → 🔴 ERROR (el generador no clasifica la regla).

- **Hints obligatorios por tipo**:
  | type | Hints requeridos | Hints opcionales |
  |---|---|---|
  | `uniqueness` | `errorCode` | `field` (muy recomendado), `constraintName` en snake_case |
  | `statePrecondition` | `errorCode` | — |
  | `terminalState` | `errorCode` (opcional) | — |
  | `sideEffect` | `description` | — (sin `errorCode`) |
  | `deleteGuard` | `targetAggregate` + `targetRepositoryMethod` + `errorCode` | — |
  | `crossAggregateConstraint` | `targetAggregate` + `field` + `expectedStatus` + `errorCode` | — |
  - Falta de hint requerido → 🔴 ERROR.

  > **`condition` y `state` no son claves válidas en `domainRules[]`.** Son errores
  > frecuentes de diseño: `condition: "status == DRAFT"` en una `statePrecondition`
  > y `state: DISCONTINUED` en una `terminalState`. El generador aplica whitelist
  > estricta y rechaza ambos con error. La condición va en `description` (texto
  > legible para Fase 3); el estado terminal es implícito en el tipo. → 🔴 ERROR.

- **uniqueness sin `field` → 🟡 ALERTA.** El generador acepta la regla, pero no puede
  emitir una guardia proactiva completa (`findBy{Campo}` pre-check) y deja un TODO
  enriquecido en el handler. Declarar `field` siempre que el diseño conozca el campo
  único. El `field` puede referenciar una propiedad del **agregado raíz o de cualquier
  entidad hija** del mismo agregado (por ejemplo, `sku` de una entidad `ProductVariant`
  declarada en `entities[]`). Si el campo solo existe en una entidad hija, el generador
  lo valida igualmente.

  - **`constraintName` (opcional, solo en `type: uniqueness`)**: nombre físico del
    índice único en la base de datos (ej: `uk_category_name`). Si está presente:
    - Debe cumplir formato snake_case (`[a-z][a-z0-9_]*`) → si no, 🔴 ERROR.
    - `constraintName` en una rule que no sea `type: uniqueness` → 🔴 ERROR.
    - **`constraintName` requiere `field` declarado** — el generador necesita conocer
      la columna para generar la anotación `@Column(unique = true)` correcta →
      si hay `constraintName` sin `field`, 🔴 ERROR.
#### E2 — Aggregates: validaciones declarativas en `properties[].validations`

Vocabulario válido (whitelist) — claves procesadas por el generador (ver
`../ddd-step2-tactical-design/references/validation.md` para la referencia completa):
`notEmpty`, `minLength`, `pattern`, `min`, `max`, `positive`, `positiveOrZero`,
`negative`, `negativeOrZero`, `future`, `futureOrPresent`, `past`, `pastOrPresent`,
`minSize`, `maxSize`.

- Constraint con nombre fuera del whitelist → 🟡 ALERTA. El generador la ignora
  silenciosamente (no aborta), pero el efecto declarativo no se aplica — típicamente
  un typo o un nombre de otra plataforma (`email`, `url`, `notBlank`, `maxLength`).
  Casos típicos:
  - `email`, `url`: usar los tipos canónicos `Email` / `Url` — ya validan el formato.
  - `notBlank`: cubierto por `required: true` aplicado sobre tipos String.
  - `maxLength`: ya implícito en `String(n)`.
- `pattern` sobre propiedad con `type: Email` o `type: Url` → 🔵 SUGERENCIA: redundante, el tipo canónico ya valida.
- `min`/`max` sobre tipo no numérico → 🔴 ERROR.
- `minLength` sobre tipo no `String` → 🔴 ERROR.
- `minSize`/`maxSize` sobre tipo no `List` → 🔴 ERROR.
- `future` / `futureOrPresent` / `past` / `pastOrPresent` sobre tipo no temporal
  (`Date`, `DateTime`) → 🔴 ERROR.
- `negative` / `negativeOrZero` sobre tipo no numérico → 🔴 ERROR.
- `positive` y `negative` simultáneos en la misma propiedad → 🔴 ERROR (contradictorios).

#### E3 — Aggregates: relaciones de entidades hijas

- Toda `entities[]` declara `relationship` ∈ `{composition, aggregation}` y
  `cardinality` ∈ `{oneToOne, oneToMany}`.
  - Falta de cualquiera → 🔴 ERROR.
  - `manyToMany` (en cualquier lugar) → 🔴 ERROR: no soportado.

- **Relación con `softDelete` resolution**: si la entidad hija tiene `softDelete: true`
  pero el agregado raíz no, el generador requiere `relationship: aggregation`.
  Composición con softDelete divergente → 🟡 ALERTA.

- ID de entidades hijas: solo `Uuid` (otros tipos no soportados) → 🔴 ERROR.

#### E4 — Domain Events: `scope`, `partitionKey`, `payload.source`

- **`published[].scope`** ∈ `{internal, integration, both}`. Default: `both`.
  - Valor fuera del enum → 🔴 ERROR.
  - Evento con `scope: internal` referenciado en `system.yaml integrations` como
    contrato de salida → 🔴 ERROR (contradicción): debe ser `integration` o `both`.

- **`published[].version`**: entero ≥ 1. Default: 1.
  - Versión decrementada vs commit anterior → 🟡 ALERTA: posible breaking change accidental.

- **Bloque `broker:` en `published[]`** (opcional):
  - Claves válidas: `partitionKey`, `headers`, `retry`, `dlq`. Clave fuera de este set → 🔴 ERROR.
  - **`broker.partitionKey`** (string, solo Kafka): nombre de un campo declarado en `payload[]`.
    - Debe ser string — si es boolean u otro tipo → 🔴 ERROR.
    - El campo referenciado debe existir en `payload[]` → si no existe → 🔴 ERROR.
    - Tipo recomendado del campo: `Uuid`, `String`, `Integer` o `Long` → otro tipo produce 🟡 ALERTA.
    - Si el broker del build es RabbitMQ, se ignora silenciosamente (no genera error).
  - **`broker.headers`**: mapa string→string. Debe ser objeto (no lista) → si es lista → 🔴 ERROR.
  - **`broker.retry`**: claves válidas: `maxAttempts`, `backoff`, `initialMs`, `maxMs`. Actualmente validado y almacenado pero no propagado a ningún artefacto generado.
  - **`broker.dlq`**: claves válidas: `afterAttempts`, `routingKey`, `queueName`. `routingKey` y `queueName` sí se propagan a la topología del consumidor. `target` no existe — usar `routingKey` → si aparece `target` → 🔴 ERROR.

- **`consumed[].retry` y `consumed[].dlq`** — estos campos son **ignorados** por el generador.
  Si aparecen en el YAML, el generador emite un `GEN-WARN` pero NO genera ningún artefacto a partir de ellos.
  → 🟡 ALERTA al humano: indicar que los elimine del YAML y configure retry/DLQ en `system.yaml` o en los archivos de entorno.

- **`payload[].source`** ∈ `{aggregate, param, timestamp, constant}`.
  `auth-context` **NO es un valor válido** en el payload de un evento — el agregado debe ser
  agnóstico a la seguridad (INT-025). `derived` tampoco es válido hoy en payloads de eventos:
  el validador lo rechaza con BC-121. Si el valor es calculado, materializarlo antes como
  propiedad del agregado (`source: aggregate`) o pasarlo como parámetro del domain method
  (`source: param`).
  Campos auxiliares según source:
  | source | Campo auxiliar requerido |
  |---|---|
  | `aggregate` | `field` |
  | `param` | `param` (opcional; si se omite, el generador usa `name` del campo) |
  | `constant` | `value` |
  | `timestamp` | (ninguno) |
  | `auth-context` | ❌ **Prohibido — INT-025** (ver abajo) |
  - Combinación inconsistente → 🔴 ERROR.

- **INT-025 — `source: auth-context` en payload de evento → 🔴 ERROR.**
  Un campo de `domainEvents.published[].payload[]` que declara `source: auth-context`
  hace que el generador detenga la build. El agregado nunca puede resolver el contexto
  de seguridad — esa es responsabilidad de la capa de aplicación.
  - Corrección: cambiar a `source: param`, añadir el parámetro al `domainMethods[].params[]`
    del método que emite el evento, y resolver `SecurityContext` en el handler de aplicación.

- **INT-026 — `source: param` sin parámetro correspondiente en `domainMethods` → 🔴 ERROR.**
  Para cada campo del payload con `source: param`:
  - El nombre del parámetro resuelto es `field.param` si está declarado, o `field.name` si no.
  - Para cada `domainMethod` que declare `emits: <este-evento>` (o incluya el evento en `emits[]`):
    - ¿Existe en `domainMethods[].params[]` un parámetro cuyo `name` coincide con el nombre resuelto?
  - Si ningún `domainMethod` que emite el evento declara ese parámetro → 🔴 ERROR: el generador
    emitiría `null` silenciosamente en el evento publicado, causando pérdida de datos en runtime.
  - Corrección: añadir el parámetro en `domainMethods[].params[]` con el tipo correcto, o corregir
    el nombre del campo en el payload (`param:` o `name:`).

  > **Cómo verificar INT-026:** recopilar todos los eventos con al menos un campo `source: param`.
  > Para cada evento, recorrer todos los `aggregates[].domainMethods[]` que lo listan en `emits`.
  > Construir el conjunto de `params[].name` del método. Verificar que cada nombre de param
  > resuelto del payload esté en ese conjunto. Si hay múltiples métodos que emiten el mismo evento
  > (raro pero posible), el param debe estar en **todos** ellos — o declarar `param:` explícito
  > para apuntar al nombre correcto.

- **`EventMetadata` canónica**: NO declarar manualmente `eventId`, `eventType`, `eventVersion`, `occurredAt`, `sourceBc`, `correlationId`, `causationId` en `payload[]`. El generador los inyecta.
  - Declaración manual → 🟡 ALERTA: eliminar.

- **`allowHiddenLeak`**: si una propiedad con `hidden: true` aparece en el `payload[]`
  publicado en scope `integration` o `both` y el evento NO declara
  `allowHiddenLeak: true` → 🔴 ERROR (INT-021): exposición no autorizada de campo
  oculto. Opciones: (a) marcar `allowHiddenLeak: true` con justificación en
  `description`, (b) eliminar el campo del payload.

#### E5 — Errors: schema extendido

- **`code`**: SCREAMING_SNAKE_CASE. Otro formato → 🔴 ERROR.
- **`httpStatus`** whitelist: `400, 401, 402, 403, 404, 408, 409, 412, 415, 422,
  423, 429, 503, 504`. Fuera de whitelist → 🔴 ERROR.
- **`errorType`** (opcional): si está, debe ser PascalCase con sufijo `Error`. Si
  es PascalCase pero rompe ese patrón → 🔵 SUGERENCIA.
- **`kind`** ∈ `{business, infrastructure}`. `triggeredBy` (identificador completamente
  cualificado de la clase de excepción del runtime de la plataforma destino) solo
  permitido si `kind: infrastructure`. `triggeredBy` con `kind: business` → 🔴 ERROR.
- **`messageTemplate` + `args[]`**:
  - Si `messageTemplate` declara placeholders `{x}, {y}`, los nombres deben coincidir
    con los `args[].name`. Mismatch → 🔴 ERROR.
  - `args[]` sin `messageTemplate` → 🔵 SUGERENCIA: eliminar args huérfanos.
  - Si hay `args[]` presentes, `messageTemplate` es **obligatorio** → 🔴 ERROR si
    `args[]` no está vacío y `messageTemplate` está ausente.
  - `args[].name` debe ser camelCase (`[a-z][A-Za-z0-9_]*`). Otro formato → 🔴 ERROR.
  - `args[].name` duplicados dentro del mismo error → 🔴 ERROR.
- **`chainable: true`**: el `errorType` resultante se genera con capacidad de envolver
  la causa original (la excepción del runtime que disparó el error). No requiere
  validación adicional aquí.
- **`usedFor`** ∈ `{auto, manual}`. Default: auto.
- **`constraintName` en `errors[]` → 🔴 ERROR.** El validador aplica whitelist estricta
  a las claves de `errors[]`: `{code, httpStatus, description, message, title,
  errorType, chainable, usedFor, messageTemplate, args, kind, triggeredBy}`.
  `constraintName` no está en esa lista — es **detalle de infraestructura** (nombre
  físico del índice único en el almacenamiento) y va en
  `aggregates[].domainRules[].constraintName` cuando `type: uniqueness`. El generador
  empareja automáticamente el `errorCode` de la rule con su error y mapea la excepción
  de violación de integridad del runtime al error correcto. Esto cumple la regla #7 de
  AGENTS.md (separación intención/implementación).
- **`triggeredBy` apunta a clases de excepción del runtime de la plataforma destino**,
  no a domain rules. Solo válido si `kind: infrastructure`.

#### E6 — UseCases: nuevas capacidades

- **`returns:` en queries con `trigger.kind: http`**: **obligatorio**. Un query UC
  expuesto por HTTP sin `returns` hace que el generador no pueda construir el
  response body del endpoint → 🔴 ERROR.

- **`returns:` en commands**: omitir por defecto. Declarar solo si el OpenAPI del command
  tiene `responses.<2xx>.content.application/json`. Tipos válidos: `Void`, `Optional[X]`,
  o un VO/projection. Tipos canónicos crudos en commands → 🟡 ALERTA: usar `Optional[X]`
  o VO con nombre. Si el OpenAPI tiene body JSON y el UC no declara `returns`, o si
  declara `returns` pero el OpenAPI no tiene body JSON, hay drift de contrato → 🔴 ERROR.

- **`returns:` en queries — nombre del agregado a secas → 🔴 ERROR.** El generador
  solo reconoce `{AggregateName}Response` (ej: `CategoryResponse`, `ProductResponse`)
  como referencia al DTO del agregado; lo mapea a `{AggregateName}ResponseDto`.
  Escribir el nombre del agregado sin el sufijo `Response` (ej: `returns: Category`)
  genera un import a una clase `dtos.Category` que no existe y provoca un error de
  compilación en el proyecto destino. Corrección: `returns: CategoryResponse`.
  Lo mismo aplica a colecciones: `Page[Category]` → 🔴 ERROR; `Page[CategoryResponse]` ✅.
  Las projections nombradas (con nombre en `projections[]`) se usan directamente por
  su nombre sin sufijo — la convención `Response` aplica **solo** cuando se referencia
  el DTO principal del agregado, no una projection.

- **`derived_from` / `derivedFrom` en useCases → 🔴 ERROR.** El generador valida
  con whitelist estricta de claves en `useCases[]` y rechaza cualquier clave desconocida
  (regla #1 de AGENTS.md: el generador no toma decisiones de dominio; un typo silencioso
  como `triger:` no debe pasar desapercibido). Un UC ya queda identificado por su `id`
  y por `trigger.kind` + `trigger.operationId` (HTTP) o `trigger.event` (eventos); la
  documentación del origen va en `description:` o se enlaza vía `rules: [RULE-ID, ...]`.
  `derivedFrom` solo es válido en `aggregates[].domainMethods[]`,
  `repositories[].queryMethods[]`, `aggregates[].properties[]` (`source: derived`) y
  `projections[].properties[]`. No usar `source: derived` en `domainEvents[].payload[]`:
  el validador actual lo rechaza con BC-121.

- **`validations[]` (array)**: cada item con `id`, `expression`, `errorCode`, `description`.
  - `id` debe ser único dentro del UC — duplicados → 🔴 ERROR.
  - `errorCode` debe existir en `errors[]` → si no, 🔴 ERROR.
  - `expression` debe ser una expresión booleana sintácticamente válida en el
    lenguaje de implementación destino (operadores de igualdad/lógicos, invocaciones
    a métodos sobre variables en scope). Si parece pseudocódigo → 🟡 ALERTA: el
    generador la emite literalmente dentro de la guarda — verificar que sea
    interpretable por el compilador del lenguaje destino.

- **`lookups[]`**: cada entry con `param` + (`aggregate` o `nestedIn`) + `errorCode`.
  - `errorCode` y `notFoundError` declarados simultáneamente para el mismo param
    → 🔴 ERROR: son mutuamente excluyentes.
  - `errorCode` debe existir en `errors[]` con `httpStatus: 404`.
  - `lookups[]` y `notFoundError` en el mismo UC son mutuamente excluyentes →
    🔴 ERROR: usar `lookups[]` exclusivamente (notFoundError se trata como alias
    de compatibilidad hacia atrás — no declarar ambos).
  - `nestedIn` (cuando presente) debe tener la forma `<Aggregate>.<collectionField>`,
    donde `<Aggregate>` empieza con mayúscula y `<collectionField>` empieza con
    minúscula. Otro formato (ej: `"productItems"`, `"product.items.variants"`) →
    🔴 ERROR: el generador no puede resolver la ruta de la colección anidada.
  - Params duplicados en `lookups[]` → 🔴 ERROR.

- **`input.default`, `input.max`**:
  - `default` aplica solo a inputs `required: false`. Si `required: true` y `default`
    presente → 🔵 SUGERENCIA: redundante.
  - `max` solo en tipos numéricos o de tamaño (List, String). En otros → 🔴 ERROR.

- **`input[]` claves prohibidas (BC-012)** — cada entrada de `input[]` solo puede contener las claves: `name`, `type`, `required`, `source`, `loadAggregate`, `headerName`, `default`, `max`, `partName`, `maxSize`, `contentTypes`, `fields`. Para cada UC, verificar que ningún `input[]` declara claves fuera de ese set (ej. `description`, `example`, `serializedName`). Si existe una clave no permitida → 🔴 ERROR BC-012: indicar el UC (id), el nombre del input y la clave culpable. Eliminar la clave no permitida.

- **`input[].source` es obligatorio en toda entrada** — el generador rechaza con error de build cualquier input sin `source`. Ausente → 🔴 ERROR. Guía:
  - Commands HTTP (POST/PUT/PATCH): campos del JSON body → `source: body`.
  - Queries HTTP (GET): filtros en URL `?campo=valor` → `source: query`.
  - Segmentos de URL `/{id}` → `source: path` (siempre `required: true`).
  - Claims del JWT → `source: authContext`.
  - Header HTTP personalizado → `source: header` + `headerName`.
  - Formulario multipart → `source: multipart` + `type: File` + `partName`.

- **`input.source: header`** requiere `headerName`. Falta → 🔴 ERROR.

- **`pagination` block** (en queries):
  `{ defaultSize, maxSize, sortable: [...], defaultSort: { field, direction } }`.
  - `defaultSize > maxSize` → 🔴 ERROR.
  - `defaultSort.field` debe estar en `sortable[]` → si no, 🔴 ERROR.
  - `sortable[]` items deben ser propiedades del agregado o de la projection que
    retorna el UC. Item ajeno → 🔴 ERROR.
  - `direction` ∈ `{ASC, DESC}` — **mayúsculas estrictas**. El generador mapea
    el valor literalmente al identificador del enum de dirección de ordenamiento
    del runtime de la plataforma destino, sin normalización. `asc`/`desc` en
    minúsculas → 🔴 ERROR (regla #1 de AGENTS.md: el generador no normaliza inputs
    implícitamente para evitar typos silenciosos).

- **`fkValidations[].bc`** (cross-BC): si está, requiere `integrations.outbound[]`
  hacia ese BC (ver B23, ahora extendido).

- **`idempotency` block** (solo commands con `trigger.kind: http`): `{ header, ttl (ISO-8601), storage: cache }`.
  ⚠️ Los valores `database` y `redis` están **deprecados** — el generador los rechaza con error de build.
  - En queries → 🔴 ERROR.
  - En commands con `trigger.kind: event` → 🔴 ERROR. La deduplicación de eventos se diseña con `system.yaml infrastructure.reliability.consumerIdempotency: true`, no con `useCases[].idempotency`.
  - `ttl` no ISO-8601 → 🔴 ERROR.
  - `storage` ≠ `cache` → 🔴 ERROR.

- **`authorization` block**: `{ rolesAnyOf: [...], ownership: { field, claim,
  allowRoleBypass } }`.
  - `ownership.field` debe ser una propiedad del agregado cargado por el UC
    (requiere `loadAggregate: true` en algún input). Sin loadAggregate → 🔴 ERROR.
  - `ownership.claim` debe matchear un claim del JWT esperado (no validable aquí —
    documentar como supuesto).

- **`aggregates[]` + `steps[]` (multi-aggregate UCs)**: cada `step` con `aggregate`,
  `method`, `onFailure.compensate` opcional.
  - Cada `aggregate` listado debe existir en `aggregates[]` del BC.
  - Cada `method` debe existir en `aggregates[X].domainMethods[]` o ser
    `upsert`/`delete` para readModels.
  - Step sin compensación en UC con >1 aggregate y al menos un step puede fallar
    → 🟡 ALERTA: posible inconsistencia.

- **`bulk` block**: `{ itemType, maxItems ≥1, onItemError: continue|abort }`.
  - `itemType` debe ser el **nombre** de otro UC de `type: command` declarado en el
    mismo BC (el wrapper llama a ese command por cada ítem). Si no existe → 🔴 ERROR.
  - El UC referenciado por `itemType` no puede ser él mismo ni otro UC `bulk` → 🔴 ERROR.
  - Un UC con `bulk` no puede declarar `input[]` — la única entrada es la lista de ítems
    → 🔴 ERROR si `input[]` está presente.
  - `onItemError` fuera del enum → 🔴 ERROR.
  - `bulk` solo en commands → 🔴 ERROR si `type: query`.
  - `bulk` + `async` son mutuamente excluyentes → 🔴 ERROR si ambos presentes.
  - `bulk` + `aggregates[]` (multi-aggregate) son mutuamente excluyentes → 🔴 ERROR.

- **`async` block**: `{ mode: jobTracking|fireAndForget, statusEndpoint }`.
  - `mode: jobTracking` sin `statusEndpoint` → 🔴 ERROR.
  - `statusEndpoint` debe corresponder a un `operationId` GET del OpenAPI.
  - `async` solo en commands → 🔴 ERROR si `type: query`.
  - `async` + `bulk` son mutuamente excluyentes → 🔴 ERROR (ver `bulk` arriba).
  - `async` + `aggregates[]` (multi-aggregate) son mutuamente excluyentes → 🔴 ERROR.

- **Multipart inputs**: `type: File`, `source: multipart`, `partName`, `maxSize`,
  `contentTypes[]`.
  - `type: File` sin `source: multipart` → 🔴 ERROR.
  - `source: multipart` sin `partName` → 🔴 ERROR.
  - `contentTypes[]` items deben ser MIME types válidos.
  - Un UC no puede mezclar inputs `source: multipart` con inputs `source: body` —
    Spring no permite `@RequestPart` y `@RequestBody` en la misma request →
    🔴 ERROR. Enviar datos extra via `path`, `query` o `header`.

- **`returns: BinaryStream`**: solo en `type: query`. En commands → 🔴 ERROR.

- **`Range[T]` y `SearchText`**:
  - `Range[T]` requiere T ∈ `{Int, Long, Decimal, Date, DateTime}` → si no, 🔴 ERROR.
  - `SearchText` requiere `fields[]` no vacío con propiedades del agregado.

- **`trigger.kind: event`**: requiere `consumes` (nombre del evento), `fromBc`,
  y opcionalmente `filter` (expresión booleana). Falta `fromBc` → 🔴 ERROR.

- **`public: true`**: solo válido en `trigger.kind: http`. En `trigger.kind: event` no tiene efecto → 🔵 SUGERENCIA: eliminarlo para evitar confusión.
  - `public: true` + `authorization` declarados simultáneamente → 🟡 ALERTA: el generador emite warning y `public: true` gana (el bloque `authorization` se ignora). Eliminar `authorization` si la intención es un endpoint público.
  - `public: true` en un `type: command` → 🟡 ALERTA: los commands necesitan identidad del actor para auditoría. Solo aplicar a queries a menos que la escritura sea explícitamente anónima por diseño y esté justificada en la spec.

- **`cacheable` block**: solo válido en `type: query`. En commands → 🔴 ERROR (el generador lo rechaza).
  - `ttl` es obligatorio (ISO-8601, ej: `PT5M`, `PT1H`). Ausente → 🔴 ERROR.
  - `keyFields[]` y `cacheWhen[]` deben coincidir exactamente con nombres de campos en `input[]` del UC. Nombre que no existe en `input[]` → 🔴 ERROR.
  - `cacheable` sin `cacheProvider: redis` en `dsl-springboot.json` → 🔴 ERROR (el build aborta con mensaje explícito).

#### E7 — Repositories: whitelist de métodos y operadores

- **Operadores en `methods[].params[].operator`** whitelist:
  `EQ, LIKE_CONTAINS, LIKE_STARTS, LIKE_ENDS, GTE, LTE, IN`. Otros → 🔴 ERROR.

- **`returns` whitelist**: `void, Boolean, Int, Long, T, T?, List[T], Page[T],
  Slice[T], Stream[T]`. Otros → 🔴 ERROR.

- **`returns: Page[T]` requiere param paginable**: todo método con `returns: Page[T]`
  debe declarar en `params[]` **una** de estas dos formas:
  - Un param con `type: PageRequest` (o `name: pageable`) — opción recomendada
  - El par `{ name: page, type: Integer }` + `{ name: size, type: Integer }`
  Sin ninguna de las dos → 🔴 ERROR: el generador no puede construir la firma del
  método en el repositorio JPA (Spring Data exige `Pageable` como argumento).

- **`derivedFrom`** — whitelist exacta del reader (sin normalización de prefijos):
  `<RULE-ID>` literal (p. ej. `PRD-001`, **sin** prefijo `domainRule:`),
  `openapi:<operationId>`, o `implicit`. Si referencia un RULE-ID, ese ID debe
  existir en `aggregates[].domainRules[].id`. Cualquier otra forma
  (incluido `domainRule:PRD-001`) → 🔴 ERROR.

- **`derivedFrom: implicit` en métodos `findBy*`**: `implicit` significa "heredado
  directamente de `JpaRepository<T, ID>`" — válido solo para `findById`, `save`,
  `delete`, `count`, `saveAll`, `findAllById`. Los métodos `findBySlug`, `findByEmail`,
  `findByXxx` (cualquier finder distinto de `findById`) **NO** son heredados de
  JpaRepository — deben declararse en la interfaz JPA. El generador los trata como
  Spring Data derived queries incluso si dicen `implicit`, pero el valor semánticamente
  correcto es `openapi:<operationId>` o un `<RULE-ID>` de unicidad. Usar `implicit`
  en un `findBy*` distinto de `findById` → 🟡 ALERTA: funcionará, pero es semántica
  incorrecta; prefer `openapi:` o el ID de la regla de unicidad.

- **Multi-field finders**: `findByXAndY` requiere todos los params en el método.

- **Soft-delete + `delete(id)`**: si el agregado tiene `softDelete: true`, NO debe
  existir un `delete(Uuid): void` puro — debe ser `softDelete(Uuid): void`. Violación
  → 🔴 ERROR.

- **Orphan `delete(id)`**: agregado sin `softDelete` y sin domainRule
  `type: deleteGuard`, pero con método `delete(Uuid): void` → 🟡 ALERTA: posible
  borrado no protegido.

- **ReadModels — métodos prohibidos**: agregado con `readModel: true` no debe declarar
  `save({Aggregate})` ni `delete(Uuid)` — solo `findById`, `findBy{unique}`, y
  `upsert(...)`. Violación → 🔴 ERROR.

- **Phase 2 features**: `defaultSort`, `sortable[]`, `transactional: true` (la
  transaccionalidad se materializa en la anotación correspondiente del runtime
  destino). Verificar consistencia con `pagination` del UC asociado.
  - `defaultSort` y `sortable[]` **solo válidos en `queryMethods`** (no en `methods`).
    Declarados fuera de `queryMethods` → 🔴 ERROR.
  - `defaultSort.field` debe ser una propiedad del agregado (incluyendo
    `createdAt`, `updatedAt`, `deletedAt`, `id`). Campo ajeno → 🔴 ERROR: el
    generador produce código que referencia una columna inexistente.
  - `sortable[]` items deben ser propiedades del agregado o campos de auditoría
    (`createdAt`, `updatedAt`, `deletedAt`, `id`). Item ajeno → 🔴 ERROR.
  - Nombres de método duplicados dentro del mismo repositorio (entre `methods` y
    `queryMethods`) → 🔴 ERROR.

- **Phase 3 opt-ins**: `existsBy*`, `deleteBy*`, `bulkOperations`, `findByIdForUpdate`.
  - `deleteBy*` sobre agregado con `softDelete: true` → 🔴 ERROR (ver soft-delete arriba).
  - `findByIdForUpdate` requiere `concurrencyControl: optimistic` declarado en el
    agregado → 🟡 ALERTA si falta.

- **Auto-derivación desde `uniqueness`**: si `autoDerive: false` está declarado, el
  agente debe verificar que cada domainRule `type: uniqueness` tenga su `findBy*`
  manualmente declarado.

#### E8 — Projections: schema y restricciones

- **Alineación schema OpenAPI / internal-api ↔ projection name**: cuando un UC
  (en `{bc}.yaml`) declara `returns: <ProjectionName>`, y la operación correspondiente
  en `{bc}-open-api.yaml` o `{bc}-internal-api.yaml` tiene una respuesta
  `$ref: '#/components/schemas/<SchemaName>'`, el `<SchemaName>` **debe ser idéntico**
  a `<ProjectionName>`. Si difieren:
  - El generador usa el schema name para parametrizar `Query<R>` → `Query<SchemaNameDto>`
  - El controlador usa `uc.returns` → retorna `ProjectionName`
  - Java falla: tipos incompatibles en `dispatch(query)` → 🔴 COMPILE ERROR
  > **Regla**: si se renombra una projection en `{bc}.yaml`, actualizar también el
  > nombre del schema en el archivo OpenAPI / internal-api correspondiente.

- **Property keys whitelist**: solo `name, type, required, description, example,
  serializedName, derivedFrom`. Llaves fuera → 🔴 ERROR.

- **Sufijos prohibidos en nombres**: `Dto, Response, Request, Payload`. Cualquiera
  → 🔴 ERROR (G9): renombrar a algo semántico (`{Entity}Summary, {Entity}Detail`).

- **Empty projections**: `properties: []` → 🔴 ERROR (G13).

- **Inline `returns:`**: si un UC declara shape inline, el generador sintetiza
  `${UC}Result`. Verificar que no choque con un nombre ya en `projections[]`.

- **Aggregate como type en projection**: `properties[].type` no puede ser nombre de
  aggregate — usar `Uuid` con composición. Violación → 🔴 ERROR (G8).

- **Tipos canónicos extendidos**: `Date, Duration, BigInt, Json` válidos en projections.

- **`source` en projection**: si declarado, debe ser
  `aggregate:<Name>` o `readModel:<Name>` (G15). Otro formato → 🔴 ERROR.

#### E9 — Integrations: validators de plataforma (INT-001..INT-021)

- **INT-015 — oauth2-cc completeness**: si `auth.type: oauth2-cc`, requiere
  `tokenEndpoint` + `credentialKey`. Falta → 🔴 ERROR.

- **`auth.type` whitelist**: `none, api-key, bearer, oauth2-cc, mTLS`. Otro → 🔴 ERROR.

- **Resilience block**: `{ timeoutMs, connectTimeoutMs, retries: { maxAttempts, waitDuration (string con unidad: "500ms", "1s") }, circuitBreaker: { failureRateThreshold, waitDurationInOpenState (string con unidad: "30s") } }`.
  - `timeoutMs > connectTimeoutMs` recomendado → 🔵 SUGERENCIA si invertido.
  - `failureRateThreshold` ∈ [0, 100].
  - `retries.maxAttempts < 1` → 🔴 ERROR.
  - `retries.waitDuration` como entero sin unidad (ej: `500` en lugar de `"500ms"`) → 🔴 ERROR: el generador no lo procesa; el valor debe ser un string con unidad.
  - `circuitBreaker.waitDurationInOpenState` como entero sin unidad → 🔴 ERROR: mismo problema.
  - Campo `waitDurationMs` (con sufijo `Ms`) → 🔴 ERROR: nombre de campo incorrecto; el campo correcto es `waitDuration`.

- **Precedencia bc.yaml > system.yaml**: si una integración declara `auth` o
  `resilience` localmente, esa configuración prevalece sobre `system.yaml`.

- **External system referenced in integrations must declare `operations[]`**:
  si bc.yaml tiene `integrations.outbound[].name: {ext}` con `type: externalSystem`,
  ese `{ext}` debe estar en `system.yaml externalSystems[]` con `operations[]`
  declaradas → si falta, 🔴 ERROR (INT-008 / INT-009).

- **INT-016..INT-021 — cross-yaml AsyncAPI**:
  - Cada `domainEvents.published[]` debe tener canal en `{bc}-async-api.yaml`
    con `publish` declarado.
  - Cada `domainEvents.consumed[]` debe tener canal `subscribe`.
  - Schema del mensaje en AsyncAPI debe coincidir con `payload[]` del evento (campos
    + tipos). Mismatch → 🔴 ERROR.
  - Hidden field leak → ver E4.

- **INT-025 — `source: auth-context` en payload → 🔴 ERROR.** Ver E4 para detalle
  completo y corrección. Validación ejecutada también por el generador antes de producir código.

- **INT-026 — `source: param` sin param en `domainMethods` → 🔴 ERROR.** Ver E4 para
  el procedimiento de verificación y corrección. El generador detecta este error en build
  y detiene la generación para evitar pérdida silenciosa de datos en el evento publicado.

#### E10 — Projections persistentes (Local Read Model alimentado por eventos)

- **`projections[].persistent: true`** requiere bloque `source`:
  `source: { kind: event, event: <EventName>, from: <bc> }` + `keyBy: <field>` +
  `upsertStrategy: lastWriteWins | versionGuarded`.
  - Falta de cualquier campo → 🔴 ERROR.
  - Evento referenciado debe existir en `domainEvents.consumed[]` → si no, 🔴 ERROR.
  - `keyBy` debe ser propiedad del payload del evento → si no, 🔴 ERROR.
  - `upsertStrategy: versionGuarded` requiere campo `version` (o el campo señalado por `eventVersionField`) en el payload del evento → si no, 🔴 ERROR (el build falla al no encontrar el campo de versión).
  - `eventVersionField` (cuando declarado): debe coincidir exactamente con el nombre de una propiedad en `properties[]`. Si no existe → 🔴 ERROR.

- **`properties[]` — tipos escalares canónicos únicos:** el generador rechaza inmediatamente cualquier tipo no escalar. Para cada propiedad en `properties[]` de una projection `persistent: true`:
  - Tipo canónico escalar (`Uuid, String, String(n), Text, Email, Url, Integer, Long, Decimal, Boolean, Date, DateTime`) → ✅
  - `Money` (VO) → 🔴 ERROR: aplanar en `priceAmount: Decimal (precision:19, scale:4)` + `priceCurrency: String(3)`.
  - Cualquier otro VO del dominio → 🔴 ERROR: aplanar sus campos escalares como propiedades individuales.
  - Nombre de enum → 🔴 ERROR: usar `String(n)` y documentar que se almacena el `name()` del enum.
  - `List[T]` → 🔴 ERROR: no soportado en persistent projections; serializar como `String` si es imprescindible.
  - Tipos de colección genérica: `Map`, `Page`, `Slice`, `Stream` → 🔴 ERROR.

- **`additionalSources[]`:** cada entry `{ kind: event, event: <Name>, from: <bc>, updatesFields: [...] }`.
  - `keyBy` **nunca** puede aparecer en `updatesFields[]` → 🔴 ERROR.
  - Cada campo en `updatesFields[]` debe estar declarado en `properties[]` → si no, 🔴 ERROR.
  - El evento referenciado debe estar en `domainEvents.consumed[]` del BC → si no, 🔴 ERROR.
  - El evento referenciado debe incluir el campo `keyBy` en su `payload[]` del BC productor; si no, el partial updater descartará el mensaje silenciosamente en runtime sin error de build → 🟡 ALERTA: verificar el `payload[]` en el AsyncAPI del BC `from`.

- **AsyncAPI requerido:** aunque no hay use cases explícitos, todos los canales `subscribe` de los eventos fuente (principal y `additionalSources`) deben estar declarados en `{bc}-async-api.yaml`. Ausente → 🟡 ALERTA (el generador los necesita para construir la topología del broker).

#### E11 — Reliability infrastructure (cross-checked con system.yaml)

**E11.1 — Outbox**

- Si `system.yaml infrastructure.reliability.outbox: true`, todo evento publicado
  por este BC se persiste vía outbox. No requiere acción aquí, pero si el bc.yaml
  declara `broker.dlq` y outbox=false, alertar inconsistencia → 🟡 ALERTA.
- Si `system.yaml infrastructure.reliability.outboxRetentionDays` **no** está declarado
  y `outbox: true` → 🔵 SUGERENCIA: la tabla `outbox_event` crecerá indefinidamente en
  producción; recomendar añadir `outboxRetentionDays: 7` (o el valor apropiado) en `system.yaml`.

**E11.2 — Consumer Idempotency**

- Si `system.yaml infrastructure.reliability.consumerIdempotency: true`, todo UC
  con `trigger.kind: event` debe ser idempotente — verificar que no existan
  efectos secundarios no idempotentes. Si el UC carga agregado y aplica método,
  el dominio debe garantizar idempotencia (ej: chequeo de estado antes de mutar).

- Ningún UC con `trigger.kind: event` debe declarar `useCases[].idempotency`.
  Ese bloque es idempotencia de requests HTTP (`Idempotency-Key`), no de mensajes.
  Si aparece `idempotency: { header: eventId, ... }` en un event-triggered UC → 🔴 ERROR:
  eliminar el bloque y usar `consumerIdempotency: true` en `system.yaml`.

- **⚠️ LIMITACIÓN CRÍTICA — verificar siempre que `consumerIdempotency: true`:**
  El generador produce un `IdempotencyGuard.tryRecord()` que registra el `eventId`
  en `processed_event` con `Propagation.REQUIRES_NEW` **antes** de ejecutar el UC.
  Si el UC lanza una excepción después de ese punto, la fila en `processed_event`
  **permanece confirmada**. En el siguiente redelivery, la guardia descarta el mensaje.
  **El UC no se ejecutará nunca más para ese `eventId`.**

  Para cada UC con `trigger.kind: event` evaluar:

  | Clasificación del UC | Riesgo | Acción |
  |---|---|---|
  | Idempotente por naturaleza (upsert, verificación de estado previa a mutación, soft-delete ya aplicado) | Bajo | Sin acción adicional |
  | Lógica no trivial que puede fallar transitoriamente (llamadas externas, multi-repo) | Alto | Añadir `implementation: scaffold` y documentar en `{bc}-flows.md` la estrategia ante fallo permanente (compensación manual, alerta operacional) |
  | Paso de saga cuyo fallo deja el sistema en estado inconsistente | Crítico | `implementation: scaffold` obligatorio + documentar en flows.md el escenario de "primer intento fallido" y la compensación |

- Si `system.yaml infrastructure.reliability.processedEventRetentionDays` **no** está declarado
  y `consumerIdempotency: true` → 🔵 SUGERENCIA: la tabla `processed_event` crecerá
  indefinidamente en producción; recomendar añadir `processedEventRetentionDays: 14` (o el
  valor que supere el max-redelivery-timeout del broker) en `system.yaml`.

#### E12 — eventDtos[]: validación estructural

- **Keys whitelist por entry**: `name`, `sourceBc`, `properties`.
  - Key fuera de la whitelist → 🔴 ERROR: el reader aborta el build.

- **`name`**: PascalCase. Requerido. Sin duplicados en `eventDtos[]`.
  - Entry sin `name` → 🔴 ERROR.
  - Nombres duplicados → 🔴 ERROR.

- **`properties[]`**: requerido, no puede estar vacío.
  - Ausente o vacío → 🔴 ERROR.

- **Keys whitelist por propiedad**: `name`, `type`, `precision`, `scale`, `required`, `description`.
  - Key fuera de la whitelist → 🔴 ERROR.
  - Propiedad sin `name` o sin `type` → 🔴 ERROR.

- **`Decimal` requiere `precision` + `scale`**: igual que en `aggregates[].properties[]`.
  - `Decimal` sin ambos → 🔴 ERROR.

- **Resolución de tipos** en `eventDtos[].properties[]`:
  - Tipo canónico → ✅
  - Enum declarado en `enums[]` del mismo BC → ✅
  - Otro `eventDto` declarado en `eventDtos[]` del mismo BC → ✅
  - VO declarado en `valueObjects[]` del mismo BC → ✅
  - Tipo no resolvible → 🔴 ERROR: bloquea la generación de código.

- **`sourceBc`** (opcional): solo documentación. Verificar que el BC exista en `system.yaml boundedContexts[]`
  para detectar typos → 🔵 SUGERENCIA si no existe.

- **Cuándo `valueObjects[]` debería ser `eventDtos[]`** (ver B16):
  - Tipo compuesto de un BC externo declarado en `valueObjects[]` → 🟡 ALERTA:
    mover a `eventDtos[]` para no contaminar el modelo de dominio propio.

---

### Checklist D — Cuando arch/system/ Requiere Ajuste

Si durante la validación se detecta alguna de las siguientes situaciones:

1. bc.yaml declara una integración con un BC o sistema externo que no existe en system.yaml
2. bc.yaml publica/consume un evento no declarado como contrato en system.yaml
3. El diseño táctico descubrió una integración real que el Paso 1 omitió
4. Un nuevo agregado del BC es lo suficientemente significativo para elevarlo a system.yaml
5. Una contradicción entre bc.yaml y system.yaml que no puede resolverse sin cambiar el Paso 1

**Protocolo obligatorio:**

1. **DETENER** el análisis del BC inmediatamente
2. Mostrar al diseñador, de forma detallada:
   - Qué se encontró en el diseño táctico
   - Qué dice actualmente system.yaml
   - Exactamente qué cambio requeriría system.yaml (qué campo, qué valor, dónde)
   - Por qué el Paso 1 necesita actualizarse antes de continuar
3. Usar `vscode_askQuestions` (o en texto directo) para presentar la decisión:
   ```
   Header: "system.yaml requiere ajuste"
   Question: "El diseño táctico del BC [nombre] reveló una discrepancia con el Paso 1.
     [descripción concreta del problema]. ¿Cómo procedemos?"
   Options:
     - "Actualizar system.yaml primero, luego continuar con el refinamiento del BC"
     - "Revisar manualmente — no actualizar system.yaml aún"
   ```
4. Solo si el diseñador autoriza → propagar el cambio a system.yaml usando el patrón
   de edición mínima de `ddd-step1-refine` (replace_string_in_file quirúrgico)
5. No continuar con el refinamiento del BC hasta que la discrepancia esté resuelta

---

### Checklist F — Agnosticismo Tecnológico de Artefactos del BC

Validar que los artefactos tácticos declaren intención de dominio, contratos y decisiones
aprobadas, no detalles de implementación del generador ni de una tecnología destino.
Aplica a `{bc}.yaml`, `{bc}-spec.md`, `{bc}-flows.md`, OpenAPI/AsyncAPI y diagramas.

**F1 — Frameworks, anotaciones, clases y paquetes**
- Referencias a frameworks o librerías concretas (`Spring`, `JPA`, `Hibernate`, `Django`,
  `NestJS`, nombres de anotaciones, imports, paquetes o clases runtime) dentro de artefactos
  del BC → 🔴 ERROR si condicionan el diseño; mover a Fase 2/Fase 3 o convertir a una
  primitiva DSL.
- Excepción: cuando esta skill documenta capacidades del generador puede mencionar esas
  tecnologías, pero los artefactos generados para un BC no deben copiarlas.

**F2 — SQL físico y estructura de storage**
- SQL, nombres de tablas/columnas físicas, índices concretos, queries, constraints de una
  base de datos específica o detalles de ORM en `{bc}.yaml`/spec/flows → 🟡 ALERTA o 🔴
  ERROR si el generador quedaría atado a una tecnología.
- Son válidos los DSL primitives `unique`, `indexed`, `constraintName`, `readModel`,
  `persistent`, `keyBy`, `auditable`, `softDelete`, `relationship` y tipos canónicos,
  porque declaran intención o contrato de generación.

**F3 — Código o algoritmo imperativo en flows/spec**
- Pseudocódigo con orden de llamadas, nombres de métodos de framework, condicionales de
  lenguaje o lógica imperativa detallada en `flows.md` o `spec.md` → 🟡 ALERTA: reescribir
  como Given/When/Then y reglas observables de negocio.
- Los nombres de use cases, domain methods y repository methods del DSL sí son válidos si
  aparecen como identificadores de diseño trazables.

**F4 — Contratos públicos sin tipos de plataforma**
- OpenAPI/AsyncAPI no deben exponer tipos Java/TypeScript/SQL (`BigDecimal`, `LocalDateTime`,
  `UUID` de lenguaje, `List<T>`, `Map<String,Object>`). Usar tipos OpenAPI/AsyncAPI o tipos
  canónicos proyectados por el DSL.

---

### Checklist G — Completitud del bc.yaml v2 para Generación (Handoff Gate)

Verifica que el `{bc-name}.yaml` es auto-suficiente para la Fase 2 — que el generador puede
actuar sin leer otros archivos ni consultar al humano. Este checklist es el criterio de
aceptación para declarar el diseño táctico completo.

**G1 — Secciones obligatorias presentes y no vacías**

| Sección | Obligatoria | Vacío aceptable cuando |
|---------|-------------|------------------------|
| `enums[]` | Condicional | El BC no tiene ciclos de vida con estados |
| `valueObjects[]` | Condicional | Todos los campos son tipos canónicos primitivos |
| `eventDtos[]` | Condicional | El BC no consume eventos de otros BCs |
| `aggregates[]` | **Siempre** | Nunca — vacío es BC sin dominio modelado |
| `integrations` | Condicional | Solo en BC totalmente aislado (muy raro) |
| `domainEvents` | Condicional | Solo si el BC no publica ni consume eventos |
| `useCases[]` | **Siempre** | Nunca — sin UCs el generador no produce nada |
| `repositories[]` | **Siempre** | Nunca — sin repositorio no hay acceso a datos |
| `errors[]` | **Siempre** | Nunca — forman parte del contrato público |

- `aggregates[]` vacío o ausente → 🔴 ERROR: sin dominio no hay BC.
- `useCases[]` vacío o ausente → 🔴 ERROR: el generador no produce ningún artefacto sin UCs.
- `repositories[]` vacío o ausente → 🔴 ERROR: sin repositorio el generador no puede persistir.
- `errors[]` vacío o ausente → 🔴 ERROR: faltan los códigos de error del contrato público.
- `domainEvents` con `published[]` y `consumed[]` ambos vacíos, pero system.yaml declara eventos para este BC → 🟡 ALERTA: los eventos del diseño estratégico no están reflejados en el táctico.

**G2 — bc.yaml está en versión v2 (listo para generación)**

Verificar que las secciones de enriquecimiento de v2 están completas:
- `domainRules[].type` asignado en todas las reglas — sin `type` el generador no clasifica la regla → 🟡 ALERTA por cada regla sin tipo.
- `useCases[]` con todos los campos requeridos: `id`, `name`, `type`, `actor`, `trigger`, `aggregate` (cuando aplica), `implementation` → 🟡 ALERTA por cada UC incompleto.
- `repositories[]` derivados de las 4 fuentes (implicit, uniqueness, openapi GET params, crossAggregateConstraint) — verificar que ninguna fuente fue omitida → 🔵 SUGERENCIA si el análisis de fuentes parece incompleto.
- `errors[]` con `httpStatus` para todos los códigos de error usados en domainRules, notFoundError y fkValidations → 🔴 ERROR si falta algún código referenciado.

**G3 — `derived_from` en artefactos derivados sigue los 3 patrones del VISION.md**

El campo `derived_from` en `aggregates[].domainMethods[]`, `repositories[].queryMethods[]`,
`repositories[].methods[]`, `aggregates[].properties[]` y `projections[].properties[]`
debe seguir exactamente uno de estos patrones:

| Patrón | Significado | Ejemplos válidos |
|--------|-------------|------------------|
| `implicit` | Heredado de JpaRepository por convención DDD | `findById`, `save`, `delete`, `count` |
| `{RULE-ID}` | Generado por esta regla de dominio (ID literal de la regla, sin prefijo) | `PRD-RULE-003`, `CAT-RULE-001` |
| `openapi:{operationId}` | Generado por este operationId del OpenAPI del BC | `openapi:listProducts`, `openapi:getOrder` |

- `derived_from` con valor distinto de los 3 patrones → 🟡 ALERTA: trazabilidad rota — corregir o eliminar el campo.
- `derived_from: {RULE-ID}` donde el RULE-ID no existe en `aggregates[].domainRules[].id` → 🔴 ERROR: referencia rota.
- `derived_from: openapi:{operationId}` donde el operationId no existe en el OpenAPI del BC → 🔴 ERROR: referencia rota.
- `derived_from` en `useCases[]` → 🔴 ERROR: campo no válido en UCs; el validador lo rechaza.

---

### Resultado de la Fase 1B

| Estado | Criterio | Acción |
|--------|----------|--------|
| ✅ **Limpio** | 0 ERRORes, 0 ALERTAs | Proceder con el refinamiento o reportar diseño sano |
| ⚠️ **Con alertas** | 0 ERRORes, ≥1 ALERTAs | Reportar; ofrecer corregir antes de continuar |
| ❌ **Con errores** | ≥1 ERRORes | Corregir los errores **primero** o documentarlos como deuda antes de proceder |

---

## Fase 2: Entender el Cambio

### 2.1 Clasificar la solicitud

| Tipo | Ejemplos | Artefactos afectados |
|------|----------|----------------------|
| **Agregar/quitar/renombrar agregado** | Dividir Order en Order + OrderLine | bc.yaml, spec, flows, open-api, async-api, diagrams/ |
| **Agregar/quitar/modificar entidad** | Agregar OrderLine como entidad subordinada | bc.yaml, spec, flows, open-api (schemas) |
| **Agregar/quitar VO** | Reemplazar String por Email VO | bc.yaml, open-api (schema) |
| **Agregar/quitar/modificar domainRule** | Nueva restricción de unicidad | bc.yaml, open-api (errorCode), flows, repositorio |
| **Agregar/quitar/modificar useCase** | Nuevo UC de activación | bc.yaml, spec, flows, open-api o internal-api |
| **Modificar enum (transitions)** | Nueva transición de estado | bc.yaml, spec, flows, diagrams/{entity}-states.mmd |
| **Modificar integración** | Cambiar HTTP a LRM | bc.yaml, async-api (nuevo subscribe), diagrams/ |
| **Modificar contrato OpenAPI** | Nuevo endpoint, nuevo query param | open-api o internal-api, bc.yaml (repositorio, UC) |
| **Modificar contrato AsyncAPI** | Nuevo canal, renombrar evento | async-api, bc.yaml (domainEvents), system.yaml (si aplica → Checklist D) |
| **Modificar flows** | Agregar caso borde, corregir Given/When/Then | flows.md |
| **Cambio de flags de propiedad** | readOnly, hidden, unique, indexed | bc.yaml (+ open-api si afecta request/response) |

### 2.2 Preguntar solo cuando sea bloqueante

Usar `vscode_askQuestions` (o en texto directo) únicamente cuando:
- El cambio es ambiguo y puede resolverse de al menos dos formas estructuralmente distintas
- El cambio implica decisiones de negocio que el diseñador debe tomar
- El impacto es mayor al esperado y conviene alertar antes de proceder

Agrupa todas las preguntas en una sola llamada. No preguntar por detalles inferibles
razonablemente — documentarlos como supuestos y seguir.

**Situaciones donde siempre preguntar antes de ejecutar:**

| Situación | Tipo de pregunta |
|-----------|-----------------|
| Una entidad nueva podría ser VO o entidad | ¿Tiene identidad propia y necesita ser referenciada? |
| Una entidad podría ascender a agregado | ¿Tiene ciclo de vida y operaciones independientes? |
| Un cambio de integración podría requerir ajuste en system.yaml | Checklist D (siempre) |
| Un nuevo UC requiere nuevo endpoint: público o interno | ¿El consumidor es una persona/externo o un BC interno? |
| Eliminar un UC que tiene flujos y está referenciado en un enum | ¿Confirmar el impacto en cadena? |
| Un cambio de domainRule cambia el errorCode en OpenAPI | ¿El código de error es el correcto para el negocio? |

---

## Fase 3: Análisis Dual Pre-Cambio

Antes de ejecutar cualquier cambio, presentar brevemente:

```
**Voz de Negocio:** [qué dice el experto del dominio sobre esta solicitud]
**Voz de Ingeniería:** [qué dice el ingeniero sobre el impacto técnico]
**Tensión detectada:** [si las dos voces apuntan en direcciones distintas]
**Propuesta:** [qué se va a hacer y por qué]
**Archivos a editar:** [lista concisa]
```

Para cambios triviales (corrección de nombre, ajuste de descripción), condensar en una
línea antes de proceder. El formato completo es para cambios con implicaciones no obvias.

### Señales de alerta que siempre mencionar

Desde la **Voz de Negocio**:
- El cambio introduce un término que el negocio no usa en la operación real
- Se está modelando una regla de negocio como validación de aplicación (debería ser domainRule)
- El nuevo flujo cubre un camino feliz pero ignora un flujo de excepción que el negocio vive constantemente

Desde la **Voz de Ingeniería**:
- Una entidad nueva pasaría el test de las 3 preguntas → candidata a agregado
- El cambio requiere un nuevo método de repositorio no declarado
- Un UC nuevo no tiene flujo en flows.md y debería tener `implementation: scaffold`
- El cambio genera un nuevo evento no declarado en system.yaml → Checklist D
- Un campo calculado se expone en el request sin `readOnly: true`
- Se agrega un monto monetario como `number` en OpenAPI → OWASP A04

---

## Fase 4: Ejecutar los Cambios

### 4.1 Reglas de edición

- Usar `replace_string_in_file` o `multi_replace_string_in_file` para ediciones precisas
- **Nunca recrear un archivo completo** para un cambio puntual — editar solo lo necesario
- Mantener el orden de secciones del bc.yaml:
  `bc` → `type` → `description` → `enums` → `valueObjects` → `eventDtos` → `aggregates` →
  `integrations` → `domainEvents` → `useCases` → `repositories` → `errors`
- Mantener la estructura de cada sección (no reordenar listas no relacionadas al cambio)

### 4.2 Consistencia post-edición — verificar mentalmente

1. ¿Cada `triggeredBy` en enums referencia un UC-ID existente en `useCases[]`?
2. ¿Cada `emits` en UC tiene su entrada en `domainEvents.published[]`?
3. ¿Cada domainRule con `errorCode` tiene su response 4xx en el OpenAPI?
4. ¿Cada UC scaffold tiene ≥1 flujo en flows.md?
5. ¿Cada `notFoundError` existe en `errors[]` con `httpStatus: 404`?
6. ¿Los flags `unique`/`indexed` están actualizados si se agregaron/modificaron reglas o endpoints GET?
7. ¿El inventario de diagramas en `diagrams/` sigue siendo correcto?
8. ¿El canal de cada evento consumido en el AsyncAPI sigue coincidiendo con system.yaml?
9. ¿Algún cambio introduce una nueva integración o evento no declarado en system.yaml? → Checklist D

### 4.3 Cuándo regenerar un diagrama

| Tipo de cambio | Diagrama afectado |
|----------------|-------------------|
| Agregar/quitar entidad o VO | `{bc-name}-diagram-domain-model.mmd` |
| Agregar/quitar/renombrar UC | `{bc-name}-diagram.mmd` |
| Agregar/quitar enum value o transition | `{bc-name}-diagram-{entity}-states.mmd` |
| Agregar/quitar operación outbound | `{bc-name}-diagram-{op-kebab}-seq.mmd` (crear o eliminar) |
| Agregar readModel aggregate | `{bc-name}-diagram-{readmodel-kebab}-sync-seq.mmd` (crear) |
| Cambio de nombre del BC | Todos los diagramas |

Regenerar solo los diagramas afectados. No regenerar los que no cambian.

---

## Fase 5: Propagación a system.yaml y BCs Vecinos

Después de aplicar cambios al BC, **siempre** verificar:

### 5.1 ¿Necesita actualizarse system.yaml?

| Cambio en bc.yaml | ¿Requiere system.yaml? |
|-------------------|------------------------|
| Nuevo evento publicado no declarado en system.yaml | Sí → Checklist D |
| Nueva integración hacia BC vecino no en system.yaml | Sí → Checklist D |
| Agregado renombrado que aparece en system.yaml | Sí → actualizar `aggregates[].root` en system.yaml |
| Cambio de flag interno (readOnly, indexed, etc.) | No |
| Cambio de domainRule interno | No |
| Nuevo UC, flow o diagrama | No |

### 5.2 ¿Necesita actualizarse algún BC vecino ya diseñado?

Verificar si existen otros BC diseñados en `arch/` que se integren con este BC:

| Cambio en este BC | Impacto en BC vecino |
|------------------|----------------------|
| Evento renombrado (nombre en domainEvents.published) | Actualizar `domainEvents.consumed[].name` y AsyncAPI subscribe del BC vecino |
| Canal de evento cambiado | Actualizar canal en AsyncAPI subscribe del BC vecino |
| Endpoint interno renombrado (internal-api) | Actualizar `integrations.outbound[].operations[].name` del BC que lo consume |
| Agregado raíz renombrado | Actualizar referencias `references:` en bc.yaml de BCs vecinos |

Si los cambios en BCs vecinos son extensos (afectan 3+ archivos), **preguntar al usuario**
si prefiere propagación automática o revisión manual.

---

## Fase 6: Resumen Post-Ejecución

### Modo Validación Standalone

1. **Estado general del BC** — ✅ Limpio / ⚠️ Con alertas / ❌ Con errores
2. **Informe diagnóstico completo** — resultado de Fase 1B con todos los hallazgos
3. **Correcciones aplicadas** — lista de problemas corregidos (si el usuario autorizó)
4. **Correcciones pendientes** — problemas no aplicados con su severidad
5. **Próxima acción sugerida** — si hay errores, qué corregir primero; si está limpio,
   verificar cobertura de UCs scaffold o avanzar a Fase 3 (implementación)

### Modo Refinamiento

1. **Pre-validación** — hallazgos preexistentes detectados (si aplica)
2. **Qué cambió** — lista concisa de cambios aplicados
3. **Artefactos editados** — qué archivos se tocaron y por qué
4. **Propagación** — si se actualizó system.yaml o BCs vecinos; si hay deuda pendiente
5. **Impacto en el diseño** — consecuencias del cambio (nuevos UCs requeridos, flujos faltantes, etc.)
6. **Próxima decisión sugerida** — qué debería revisar el diseñador a continuación

---

## Principios que Guían el Refinamiento

**Cambio mínimo suficiente.** Editar solo lo que cambia. Un archivo no mencionado en el
análisis de impacto no se toca.

**Las invariantes del negocio son sagradas.** Si el usuario propone un cambio que elimina
una domainRule que protege una invariante real, alertar explícitamente y proponer alternativa.

**El Paso 1 es la fuente de verdad estratégica.** Ningún cambio en bc.yaml puede contradecir
system.yaml sin pasar primero por el Checklist D y autorización explícita del diseñador.

**Scaffold sin flujo es deuda inaceptable.** Todo UC que necesite `implementation: scaffold`
debe tener su flujo en flows.md antes de cerrar el refinamiento. Si el usuario pide marcar
algo como scaffold pero no hay flujo, crear el flujo mínimo (happy path + casos borde) o
notificar la deuda explícitamente.

**Preguntar siempre ante ambigüedad de diseño.** Si una entidad podría ser VO o entidad,
si un campo podría ser readOnly o no, si un flujo tiene una excepción dudosa — nunca asumir.
Presentar las opciones con sus trade-offs y dejar que el diseñador decida.
