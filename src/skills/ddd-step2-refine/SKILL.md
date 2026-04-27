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
- Cada `fkValidations[].notFoundError`, ¿existe en `errors[]`?
  - notFoundError de FK sin entrada en errors[] → 🔴 ERROR

**B7 — UC scaffold → flujo dedicado en flows.md**
- Cada UC con `implementation: scaffold`, ¿tiene ≥1 flujo en flows.md que lo cubra?
  - UC scaffold sin flujo → 🔴 ERROR: Fase 3 (implementación) no tendrá especificación ejecutable

**B8 — useCases[].emits → domainEvents.published[]**
- Cada valor no-null en `useCases[].emits`, ¿existe en `domainEvents.published[].name`?
  - Evento emitido en UC sin entrada en published → 🔴 ERROR

**B9 — UC event-triggered → domainEvents.consumed[]**
- Cada UC con `trigger.kind: event`, ¿tiene `trigger.event` en `domainEvents.consumed[]`?
  - Evento en trigger sin entrada en consumed → 🔴 ERROR

**B10 — Repositories: métodos derivados**
- Cada domainRule `type: uniqueness` o propiedad `unique: true` en el agregado raíz,
  ¿tiene su `findBy{campo}` en el repositorio del agregado?
- Cada query param en un `GET /{recursos}` del OpenAPI, ¿tiene su método de listado
  con ese param en el repositorio?
  - Método de repositorio faltante → 🟡 ALERTA

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
| `domainEvents.published[].payload[].type` | ¿Existe en `enums[]` o `valueObjects[]`? |
| `domainEvents.consumed[].payload[].type` | ¿Existe en `enums[]` o `valueObjects[]`? |
| `repositories[].methods[].params[].type` | ¿Existe en `enums[]`, `valueObjects[]` o agregados del BC? |
| `repositories[].methods[].returns` | ¿El tipo base (sin `?`, `[]` o `Page[...]`) está declarado? |

- Tipo referenciado que no existe en `enums[]` ni `valueObjects[]` ni es canónico → 🔴 ERROR: bloquea la generación de código. Declarar el VO/enum faltante con sus propiedades.

**B17 — Sintaxis Java genérica prohibida**

El generador parsea los tipos literalmente. Cualquier uso de sintaxis Java con ángulos (`<>`) produce fallos silenciosos en generación:

| Patrón prohibido | Corrección | Error que produce |
|---|---|---|
| `returns: Page<X>` | `returns: Page[X]` | `startsWith('Page[')` falla → no genera `@Query`, Spring Data no puede derivar `list...` → error en runtime |
| `returns: List<X>` | `returns: List[X]` | tipo no reconocido → campo generado como `Object` |
| `type: Enum<X>` | `type: X` (nombre del enum directamente) | tipo no resuelto → compilación falla |
| `type: List<X>` | `type: List[X]` | ídem List<X> |

Buscar en todo el YAML: `/<[A-Z]` (apertura de ángulo seguida de mayúscula). Cada ocurrencia → 🔴 ERROR: corregir antes de pasar al generador.
- Patrón típico: `OrderLineSummary`, `CartItemSnapshot`, `ProductRef` en payloads de eventos — son VOs implícitos que deben declararse explícitamente.

**B18 — domainEvents.published: payload obligatorio**
- Para cada evento en `domainEvents.published[]`:
  - ¿Tiene `payload[]` con al menos un campo?
  - ¿Incluye el ID del agregado raíz (`{aggregate}Id: Uuid`)?
  - ¿Incluye `occurredAt: DateTime`?
  - Evento sin `payload` (campo ausente o lista vacía) → 🔴 ERROR: el consumidor no puede actuar sin datos — rompe el contrato del evento
  - Evento con payload pero sin `occurredAt` → 🟡 ALERTA: sin timestamp el consumidor no puede ordenar eventos ni detectar llegadas fuera de orden

**B19 — domainEvents.consumed: UC o `acknowledgeOnly: true` + payload**
- Para cada evento en `domainEvents.consumed[]`:
  - ¿Existe un UC en `useCases[]` con `trigger.kind: event` y `trigger.event` igual al `name` de este evento?
  - Si no hay UC: ¿tiene `acknowledgeOnly: true`?
  - Evento consumido sin UC **y** sin `acknowledgeOnly: true` → 🔴 ERROR: gap de diseño — el generador no puede crear el handler y la intención es ambigua. Opciones: (a) añadir un UC con la lógica de dominio correspondiente, o (b) marcar `acknowledgeOnly: true` si el BC solo necesita suscribirse sin ejecutar lógica (típico en acuses de compensación de saga)
- Para cada evento en `domainEvents.consumed[]` que tiene un UC asociado (`trigger.kind: event`):
  - ¿Tiene `payload[]` con al menos un campo?
  - Evento consumido con UC pero sin `payload` (campo ausente o lista vacía) → 🔴 ERROR: el generador no puede construir el message handler sin saber qué campos leer del mensaje — falla en tiempo de generación de código
  - Verificar que el payload incluye al mínimo:
    - Para **saga handlers** (`sagaStep` presente): el ID del agregado que el UC carga del repositorio (ej: `orderId: Uuid`) + `occurredAt: DateTime`
    - Para **LRM handlers** (UC sobre agregado `readModel: true`): todos los campos que la proyección necesita replicar → comparar con el `payload[]` del evento correspondiente en `domainEvents.published[]` del BC fuente
    - Para cualquier otro event-triggered UC: el ID del agregado afectado + campos usados en la lógica del UC + `occurredAt: DateTime`
  - Payload incompleto que falta el ID del agregado a cargar → 🔴 ERROR: el handler no puede ejecutar `repositoryMethod: findById`
  - Payload incompleto en LRM handler (faltan campos que la proyección usa) → 🔴 ERROR: la proyección quedará desincronizada — el dato que el LRM no recibe en el evento tendrá que buscarlo en el BC fuente (acoplamiento sincrónico encubierto)
- Para cada evento con `acknowledgeOnly: true`:
  - ¿Tiene `payload[]` declarado?
  - Evento `acknowledgeOnly` con payload → 🔵 SUGERENCIA: el payload no tiene efecto (no hay handler) — eliminarlo evita confusión en el lector del diseño

**B20 — repositories.list: params sin mapeo a propiedad necesitan `filterOn` y `operator`**
- Para cada método en `repositories[].methods[]` de tipo listado (`returns: Page[...]` o `List[...]`):
  - Para cada param cuyo `name` no coincide con ninguna propiedad del agregado raiz (típicamente: `search`, `q`, `query`, `keyword`):
    - ¿Tiene `filterOn[]` con al menos una propiedad que exista en el agregado?
    - ¿Tiene `operator` con un valor válido (`EQ`, `LIKE_CONTAINS`, `LIKE_STARTS`, `LIKE_ENDS`, `GTE`, `LTE`, `IN`)?
    - Param sin `filterOn` → 🔴 ERROR: el generador no puede inferir sobre qué columna(s) aplica el filtro — gap de diseño que produce código incorrecto o incompleto.
    - `filterOn` presente pero sin `operator` → 🔴 ERROR: el operador es parte del predicado; sin él el generador no puede construir la cláusula WHERE.
    - Verificar además que el UC asociado tenga `implementation: scaffold` si `filterOn`/`operator` no están declarados.

**B21 — `countBy`/`listBy` con calificador `Active` en agregados `softDelete: true`**
- Para cada método en `repositories[].methods[]` cuyo nombre contiene el calificador `Active` (ej: `countActiveByX`, `listActiveByY`):
  - ¿El agregado asociado tiene `softDelete: true`?
  - ¿El agregado tiene una propiedad `status` con un valor `ACTIVE`?
  - Si el agregado tiene `softDelete: true` pero **no** tiene campo `status`: el calificador `Active` es ambiguo → 🔴 ERROR. El generador infiere `status = 'ACTIVE'` pero la columna no existe. Renombrar el método usando `NonDeleted` (ej: `countNonDeletedByCustomerId`) para que el generador derive `deleted_at IS NULL`.
  - Si el agregado tiene `softDelete: true` **y** tiene campo `status`: 🟡 ALERTA. El calificador es ambiguo — clarificar si el predicado filtra por `status = 'ACTIVE'`, por `deleted_at IS NULL`, o por ambos. Elegir un nombre que exprese sin ambigüedad la intención.

**B22 — `fkValidations` sobre campos con `source: authContext`**
- Para cada UC con `fkValidations[]` no vacío:
  - Para cada entrada en `fkValidations[]`, localizar la propiedad `field` en el agregado del UC.
  - ¿Esa propiedad tiene `source: authContext`?
  - Si tiene `source: authContext`: la validación de FK es redundante — el campo viene del `SecurityContext` (ya validado por autenticación) y nunca del request body. El generador generará un puerto (`{Bc}ServicePort`) sin adaptador implementador → Spring falla en startup. → 🔴 ERROR: eliminar la entrada `fkValidations[]` del UC y, si `notFoundError` solo era referenciado desde esa FK, eliminar también la entrada de `errors[]`.

**B23 — `fkValidations[].bc` sin entrada en `integrations.outbound`**
- Para cada UC con `fkValidations[]` no vacío:
  - Para cada entrada, ¿el valor de `bc` coincide con algún `bc` en `integrations.outbound[]`?
  - Si `fkValidations[].bc == "X"` pero no hay entrada en `integrations.outbound` con `bc: X`: el generador produce `XServicePort` (interfaz) pero ningún `@Component` la implementa → Spring no puede satisfacer la dependencia en startup. → 🔴 ERROR. Opciones: (a) declarar la integración outbound hacia `X` en `integrations` si la comunicación HTTP real existe, o (b) eliminar la `fkValidation` si la validación es innecesaria.
  - **Excepción:** si `bc` referencia el mismo BC (`bc == bc actual`) o es un agregado local del mismo BC — en ese caso no se necesita `integrations.outbound`.

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
  - Comando con response body → 🟡 ALERTA
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
3. Usar `vscode_askQuestions` para presentar la decisión:
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

Usar `vscode_askQuestions` únicamente cuando:
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
  `bc` → `type` → `description` → `enums` → `valueObjects` → `aggregates` →
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
