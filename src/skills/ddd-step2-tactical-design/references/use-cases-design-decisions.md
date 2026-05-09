# Guía de Decisiones — `useCases[]`

Esta guía responde **cuándo y por qué** elegir cada mecanismo disponible en `useCases[]`.
No describe el schema (eso está en `bc-yaml-guide.md` y `bc-yaml-schema.md`); describe el
**razonamiento de diseño** que lleva a elegir uno u otro.

---

## §1 — `notFoundError` vs `lookups[]`

Ambos resuelven el mismo problema: cargar un agregado antes de ejecutar la lógica y
lanzar un error si no existe. Son **mutuamente excluyentes**.

| Criterio | `notFoundError` | `lookups[]` |
|---|---|---|
| Número de agregados a cargar | Uno (el agregado principal) | Varios — uno por entry |
| Flexibilidad de errores | Un código para todo el UC | Un error por cada lookup individual |
| Agregados anidados (entidades hijas) | No soportado | `nestedIn: Aggregate.collection` |
| Compatibilidad con `loadAggregate: true` | El `input[]` con `loadAggregate: true` carga el principal | Los `lookups[]` sustituyen `loadAggregate: true` |

### Cuándo usar `notFoundError`

Un único agregado cargado por `loadAggregate: true`, error uniforme si no existe.

```yaml
# UC que solo carga Product
input:
  - name: productId
    type: Uuid
    source: path
    loadAggregate: true
notFoundError: [PRODUCT_NOT_FOUND]
```

### Cuándo usar `lookups[]`

Dos o más agregados distintos, cada uno con su propio error.

```yaml
# UC que necesita Order + PaymentMethod, errores distintos
lookups:
  - param: orderId
    aggregate: Order
    errorCode: ORDER_NOT_FOUND
  - param: paymentMethodId
    aggregate: PaymentMethod
    errorCode: PAYMENT_METHOD_NOT_FOUND
# input[] SIN loadAggregate — los lookups son la carga
input:
  - name: orderId
    type: Uuid
    source: path
  - name: paymentMethodId
    type: Uuid
    source: body
```

### Cuándo usar `lookups[].nestedIn`

El objeto a cargar no es el root del agregado, sino una entidad hija.

```yaml
lookups:
  - param: orderId
    aggregate: Order
    errorCode: ORDER_NOT_FOUND
  - param: lineId
    nestedIn: Order.lines      # entidad OrderLine dentro de Order
    errorCode: ORDER_LINE_NOT_FOUND
```

**Regla:** `notFoundError` y `lookups[]` no coexisten en el mismo UC.
Si hay más de un error posible de "no encontrado", usar siempre `lookups[]`.

---

## §2 — `fkValidations[]`: tres rutas de generación

`fkValidations[]` valida que un UUID referenciado exista antes de ejecutar la lógica.
El generador elige el mecanismo automáticamente según el contexto.

### Ruta 1 — mismo BC (campo `bc` ausente o igual al BC actual)

El generador invoca el repositorio local directamente.

```yaml
fkValidations:
  - aggregate: Category
    param: categoryId
    error: CATEGORY_NOT_FOUND
    # sin bc: → el generador invoca categoryRepository.findById(categoryId).isEmpty()
```

**Código generado (handler):**
```java
if (categoryRepository.findById(command.categoryId()).isEmpty()) {
    throw new CategoryNotFoundError();
}
```

### Ruta 2 — BC externo + Local Read Model (LRM)

Cuando el agregado referenciado vive en otro BC **y** existe una proyección local
(`readModel: true`) alimentada por eventos del BC propietario, el generador usa el
repositorio local del LRM — sin llamada HTTP.

**Condiciones:** el agregado en `fkValidations[].aggregate` tiene `readModel: true`
en los `aggregates[]` de **este** BC, y su `sourceBC` apunta al BC externo.

```yaml
# En este BC: agregado local que es una proyección
aggregates:
  - name: CustomerSnapshot
    readModel: true
    # ... propiedades sincronizadas desde events del BC customers

fkValidations:
  - aggregate: CustomerSnapshot
    param: customerId
    error: CUSTOMER_NOT_FOUND
    # No se declara bc: — el aggregate existe localmente como readModel
```

**Código generado:** `customerSnapshotRepository.findById(command.customerId()).isEmpty()`

### Ruta 3 — BC externo sin LRM → `ServicePort`

Cuando el BC referenciado es externo y **no** hay LRM local, el generador produce
una llamada HTTP a través de un puerto.

**Condiciones:** `fkValidations[].bc` nombra un BC diferente **y** ese agregado no
está declarado localmente como `readModel: true`.

```yaml
fkValidations:
  - aggregate: Supplier
    param: supplierId
    bc: suppliers              # BC externo, sin LRM en este BC
    error: SUPPLIER_NOT_FOUND
```

**Artefactos generados:**
- `application/ports/SuppliersServicePort.java` — interfaz con método `existsSupplier(UUID)`
- El generador NO genera la implementación HTTP — Fase 3 la implementa
- Si ya existe un puerto `integrations.outbound[]` para ese BC, lo reutiliza sin generar duplicado

**Regla importante:** declarar `bc: <nombre>` en `fkValidations[]` **exige** que
`integrations.outbound[]` tenga una entrada para ese BC. El validador lanza INT-006 si
la integración no está declarada.

### Tabla de decisión rápida

| ¿Dónde vive el agregado? | ¿Hay LRM local? | Ruta | Qué genera |
|---|---|---|---|
| Mismo BC | — | 1 | `repo.findById().isEmpty()` inline |
| Otro BC | Sí (`readModel: true`) | 2 | `lrmRepo.findById().isEmpty()` inline |
| Otro BC | No | 3 | `{Bc}ServicePort.java` con `exists*()` |

---

## §3 — `validations[]`: expresiones de negocio, no código Java

`validations[]` declara **pre-condiciones** adicionales que el handler debe verificar
antes de invocar el método de dominio. Son distintas de `domainRules`: las reglas del
dominio viven en el agregado y son invariantes universales; las `validations[]` del UC
son verificaciones de entrada que aplican solo en el contexto de ese use case.

**La propiedad `expression` es siempre lenguaje natural.** El generador emite un
`// TODO` con el texto de la expresión, y Fase 3 lo implementa en Java.

```yaml
validations:
  - id: VAL-001
    expression: "el total del pedido debe ser mayor que cero"
    errorCode: ORDER_AMOUNT_INVALID
    description: "Rechazar pedidos con importe cero o negativo"
  - id: VAL-002
    expression: "el límite de crédito del cliente no ha sido excedido"
    errorCode: CREDIT_LIMIT_EXCEEDED
    description: "Verificar disponibilidad de crédito antes de confirmar"
```

**Código generado (handler):**
```java
// TODO useCase(UC-ORD-003, validations[VAL-001]): enforce `el total del pedido debe ser mayor que cero` and throw new OrderAmountInvalidError() on violation. // Rechazar pedidos con importe cero o negativo
// TODO useCase(UC-ORD-003, validations[VAL-002]): enforce `el límite de crédito del cliente no ha sido excedido` and throw new CreditLimitExceededError() on violation. // Verificar disponibilidad de crédito antes de confirmar
```

**Cuándo añadir `validations[]`:**
- La condición require acceso a datos externos (repositorio, servicio, authContext) que
  solo el handler puede resolver — el dominio no los tiene disponibles.
- La condición es específica del UC (no una invariante del agregado que aplique siempre).
- La condición cruza múltiples agregados o datos de sesión.

**Cuándo NO usar `validations[]`:**
- La condición es una invariante del agregado → usar `domainRules[]` en el agregado.
- La condición es verificable con los datos ya presentes en el comando → `domainRules[]`.
- La condición es simplemente "el campo no puede ser null" → `required: true` en `input[]`.

---

## §4 — `rules[]`: pistas para el generador, no lógica en el handler

`rules[]` enumera los RULE-IDs que se evalúan **dentro del método de dominio** que el
UC invoca. No genera código en el handler — genera comentarios guía (`// Validate:`,
`// Side effects:`) dentro del cuerpo del método de dominio en el agregado.

```yaml
rules: [PRD-RULE-001, PRD-RULE-002]
```

**Lo que genera en el agregado (no en el handler):**
```java
public void activate() {
    // Validate: PRD-RULE-001 — A product can only be activated if it has a name,
    //           a valid price greater than zero, and at least one image.
    // TODO: implement guard
    // Side effects: PRD-RULE-004 — Append activation entry to AuditLog
}
```

**Criterio de diseño:**
- Enumerar solo las reglas que la Fase 3 debe implementar dentro del método de dominio.
- Las reglas `uniqueness` y `deleteGuard` ya generan código en el repositorio — no es
  necesario listarlas en `rules[]` del UC.
- Si un UC no invoca ninguna regla de dominio significativa, usar `rules: []`.

---

## §5 — `implementation: scaffold` vs `full`

| Valor | Cuándo usarlo | Qué genera |
|---|---|---|
| `full` | Todos los parámetros del método de dominio se pueden resolver desde `input[]`, `outgoingCalls[]` o constantes. El generador puede producir código ejecutable. | Handler completo sin TODOs en el flujo principal |
| `scaffold` | Hay parámetros no resolvibles, lógica no trivial, o `validations[]` que requieren acceso a datos que el generador no puede inferir. | Handler con `// TODO` en los puntos de extensión, `throw new UnsupportedOperationException()` |

**Regla práctica:** si el `domainMethod` tiene parámetros que no vienen directamente de
`input[]` y no están cubiertos por `outgoingCalls[]`, es `scaffold`.

Si todos los parámetros del método están cubiertos → `full`.
Si hay `validations[]` complejas → puede seguir siendo `full` si el resto es completo;
los TODO de validaciones se emiten siempre independientemente del valor de `implementation`.

---

## §6 — Multi-aggregate: `aggregates[]` + `steps[]`

### Restricción fundamental: mismo BC, misma transacción

`aggregates[]` + `steps[]` solo es válido cuando **todos los agregados viven en el mismo
Bounded Context y en la misma base de datos**. El generador envuelve los steps en una
única transacción `@Transactional` — esto solo funciona si el hilo de ejecución puede
acceder a todos los repositorios bajo el mismo `DataSource`.

**Cuándo usarlo:**

```yaml
# UC que modifica Order e Invoice en la misma transacción DB
aggregates: [Order, Invoice]
steps:
  - aggregate: Order
    method: confirm
  - aggregate: Invoice
    method: emit
    onFailure:
      compensate: Order.revertConfirmation
```

Usar cuando:
- La operación necesita modificar dos o más agregados de forma atómica.
- Ambos/todos los agregados pertenecen a este BC.
- El negocio requiere consistencia fuerte (todo o nada).

**Cuándo NO usarlo:**
- Si algún agregado pertenece a otro BC → usar **Saga** en `system.yaml`.
- Si la consistencia eventual es aceptable → usar eventos de dominio entre UCs.
- Si solo hay un agregado → usar `aggregate: Name` (singular).

### Patrón alternativo para cross-BC

Cuando la operación involucra BCs distintos:
1. Declarar una `saga` en `system.yaml` con sus `steps` y `compensation`.
2. Cada step de la saga corresponde a un UC en su BC respectivo con `sagaStep:` declarado.
3. El generador produce handlers con `sagaStep` y el orquestador de saga en la capa de infraestructura.

---

## §7 — `async`: cuándo ejecutar en background

| Modo | Cuándo usarlo | Qué genera |
|---|---|---|
| `jobTracking` | Operación larga (>2s, potencialmente minutos). El cliente necesita saber si terminó y consultar el resultado. | Endpoint inicial que devuelve `jobId`. Endpoint de estado `statusEndpoint`. Handler asíncrono con `AsyncJobExecutor`. |
| `fireAndForget` | Operación larga donde el cliente no necesita confirmación de resultado (notificaciones, procesos de fondo). | Endpoint que responde `202 Accepted`. Handler asíncrono sin endpoint de estado. |
| (ausente) | Operación sincrónica estándar. Responde en el mismo request. | Handler síncrono estándar. |

**Criterio de elección:**
- ¿Necesita el cliente saber si terminó? → `jobTracking`
- ¿Solo necesita saber que se inició? → `fireAndForget`
- ¿Responde en <2s en condiciones normales? → síncrono (sin `async`)

---

## §8 — Autorización: `rolesAnyOf` vs `permissionsAnyOf` vs combinados

El generador acepta tres formas de autorización en un UC:

```yaml
# Solo por rol — cualquiera de los roles puede ejecutar el UC
authorization:
  rolesAnyOf: [ADMIN, MANAGER]

# Solo por permiso — más granular que el rol
authorization:
  permissionsAnyOf: [products.activate, catalog.manage]

# Combinado — el usuario DEBE tener el rol Y el permiso (AND lógico)
authorization:
  rolesAnyOf: [OPERATOR]
  permissionsAnyOf: [products.activate]

# Con restricción de ownership — además del rol, el recurso debe pertenecer al usuario
authorization:
  rolesAnyOf: [CUSTOMER]
  ownership:
    field: customerId        # campo del agregado o del comando
    claim: sub               # claim del JWT que identifica al usuario
    allowRoleBypass:         # lista de roles que pueden actuar sobre recursos ajenos
      - ROLE_ADMIN
```

**Criterio:**
- `rolesAnyOf` solo → control de acceso grueso basado en el rol del usuario.
- `permissionsAnyOf` solo → control fino cuando los roles no son suficientes
  (diferentes usuarios del mismo rol tienen permisos distintos).
- Ambos → el usuario debe cumplir los dos (AND). Usar cuando el permiso de negocio
  es más restrictivo que el rol asignado.
- `ownership` → el recurso debe pertenecer al usuario autenticado (multi-tenant,
  self-service). `allowRoleBypass: [ROLE_ADMIN]` si los admins deben poder actuar sobre
  recursos de cualquier usuario.

---

## §9 — `outgoingCalls[]` vs `fkValidations[]`

Ambos implican llamadas a otros sistemas, pero tienen propósitos distintos.

| Criterio | `fkValidations[]` | `outgoingCalls[]` |
|---|---|---|
| Propósito | Verificar existencia (¿existe este ID?) | Obtener datos necesarios para el método de dominio |
| Resultado | Lanza error si no existe. Ningún dato adicional. | Retorna un valor que se inyecta en el método como parámetro (`bindsTo`) |
| Ejemplo | "¿Existe el Supplier con supplierId?" | "Dame los precios actuales del catálogo para estos productIds" |
| Cuándo usar | Validación de FK antes de ejecutar la lógica | El método de dominio necesita datos externos para computar |

```yaml
# fkValidations: verificar que el producto exista
fkValidations:
  - aggregate: Product
    param: productId
    error: PRODUCT_NOT_FOUND

# outgoingCalls: obtener precios actuales para usarlos en el método
outgoingCalls:
  - port: CatalogPort
    method: validateProductsAndPrices
    params: [cartId]
    bindsTo: catalogPrices    # → domainMethods[checkout].params[catalogPrices]
```

---

## §10 — Queries: `loadAggregate` (Path A) vs name-matching (Path B)

Cuando el generador procesa una query, elige la estrategia de acceso a datos:

| Path | Condición | Mecanismo |
|---|---|---|
| A | Un `input[]` tiene `loadAggregate: true` | `repository.findById(id)` directo |
| B | Ningún `input[]` tiene `loadAggregate: true` | Cruce de nombres de `input[]` con `repositories[aggregate].queryMethods` |

**Path A** → query por ID (GetProduct, GetOrder por ID).

**Path B** → query con filtros (ListProducts, ListOrders por estado y fecha):
- El generador cruza los nombres de `input[]` del UC contra los `params` de cada
  `queryMethod` en el repositorio para identificar el método a invocar.
- Los nombres de los `input[]` deben coincidir exactamente con los nombres de los `params`
  del `queryMethod`. Si hay discrepancia, el generador lanza un warning de resolución.

**Regla:** una query con `loadAggregate: true` no declara `queryMethods` en el repositorio
para ese acceso — solo necesita `findById` (que es implícito). Solo usar `queryMethods`
para Path B.

---

## §11 — Idempotencia: cuándo y cómo

Usar `idempotency` cuando el comando puede ejecutarse más de una vez por retries del
cliente y eso produciría efectos duplicados (pagos, confirmaciones de pedido, altas de
entidad única).

```yaml
idempotency:
  header: Idempotency-Key      # header HTTP que el cliente envía
  ttl: PT24H                   # tiempo que se recuerda el resultado (ISO-8601)
  storage: cache               # ÚNICO valor válido — database y redis están deprecados y rechazados
```

**Reglas:**
- Usar siempre `storage: cache`. Los valores `database` y `redis` están **deprecados** — el generador los rechaza con error de build. El provider concreto de caché (Redis, Caffeine, etc.) se configura en `dsl-springboot.json` con la clave `cacheProvider`, no en el YAML de diseño.
- No declarar `idempotency` en queries — son operaciones de lectura; la idempotencia
  no aplica.
- No declarar `idempotency` en comandos disparados por eventos (`trigger.kind: event`) —
  la idempotencia de mensajes se gestiona a nivel de sistema con `consumerIdempotency: true`
  en `system.yaml` (no en el handler del UC).

---

## §12 — `bulk`: operaciones en lote

Usar `bulk` cuando el cliente necesita aplicar la misma operación a múltiples ítems
en una sola llamada HTTP, y el manejo de errores parciales es relevante.

```yaml
bulk:
  itemType: ActivateProductItem   # VO o projection que representa un ítem del lote
  maxItems: 500                   # máximo de ítems por request
  onItemError: continue           # continue (procesar el resto) | abort (rollback todo)
```

**`continue`** → procesamiento best-effort. Cada ítem se intenta; los errores se coleccionan
y se devuelven en el response sin abortar el lote. Útil cuando el negocio acepta éxito parcial.

**`abort`** → transacción todo-o-nada. Si un ítem falla, se hace rollback de todos.
Usar cuando la consistencia del lote completo es obligatoria.

---

## §13 — Cuándo añadir `input[].default` y `input[].max`

`default` → el servidor aplica este valor si el cliente no envía el campo. Útil para
parámetros de paginación (`limit`, `page`, `size`) y filtros opcionales con valor
preferido.

`max` → cap superior que el servidor hace cumplir independientemente de lo que envíe
el cliente. Obligatorio para cualquier parámetro que controle volumen de datos devuelto
(protección contra abuso / performance).

```yaml
input:
  - name: limit
    type: Integer
    source: query
    required: false
    default: 20        # si el cliente no envía limit, devolver 20 ítems
    max: 100           # nunca devolver más de 100 aunque el cliente pida 500
```

Usar siempre `default` + `max` juntos para parámetros de paginación manual
(cuando no se usa el tipo `PageRequest` como parámetro completo).

---

## §14 — `returns` en queries: formato correcto

El valor de `returns` en un use case de tipo `query` debe seguir estas reglas para
evitar errores de compilación en el proyecto generado:

| Intención | Valor correcto | Valor incorrecto |
|---|---|---|
| Retornar el DTO completo del agregado | `ProductResponse` | ~~`Product`~~ (genera import inválido) |
| Retornar una projection nombrada | `ProductSummary` | — |
| Retornar colección paginada del DTO del agregado | `Page[ProductResponse]` | ~~`Page[Product]`~~ |
| Retornar colección paginada de projection | `Page[ProductSummary]` | — |
| Retornar lista sin paginar | `List[ProductSummary]` | — |
| Retornar resultado opcional | `Optional[ProductDetail]` | — |
| Descargar un archivo | `BinaryStream` | — |

**Regla clave:** escribir solo el nombre del agregado (`Category`, `Product`) en `returns`
de un query **falla silenciosamente en el diseño y produce un error de compilación en el
proyecto generado**. El generador solo reconoce `{AggregateName}Response` como referencia al
DTO del agregado; lo mapea a `{AggregateName}ResponseDto`.

```yaml
# ✅ Correcto
returns: ProductResponse
returns: Page[ProductResponse]
returns: ProductSummary

# ❌ Incorrecto — genera import inválido en el proyecto destino
returns: Product
returns: Page[Product]
```

**Commands** también pueden declarar `returns` cuando el endpoint devuelve un body:
- `returns: Uuid` → retorna el ID del recurso creado (convención para `201 Created` con body)
- `returns: ProductResponse` → retorna el estado actualizado
- Sin `returns` → void (para `204 No Content` o `201 Created` sin body)

> **Regla práctica:** si el OpenAPI del BC declara `responses.2xx.content.application/json`
> en un command, declarar `returns`. Si no hay body en la respuesta, omitir `returns`.

---

## §15 — `pagination.direction`: mayúsculas obligatorias

El campo `direction` en el bloque `defaultSort` de `pagination` debe ser `ASC` o `DESC`
en **mayúsculas estrictas**. El generador mapea el valor literalmente al identificador
del enum de dirección del runtime destino sin normalización.

```yaml
# ✅ Correcto
pagination:
  defaultSize: 20
  maxSize: 100
  sortable: [createdAt, name]
  defaultSort:
    field: createdAt
    direction: DESC         # mayúsculas obligatorias

# ❌ Incorrecto — aborta el build
pagination:
  defaultSort:
    direction: desc         # minúsculas → ERROR
    direction: Desc         # mixto → ERROR
```

---

## §16 — `public: true`: cuándo declararlo

Marca el endpoint como completamente público: no requiere JWT ni verificación de identidad.
Solo válido para `trigger.kind: http`.

| Señal | Decisión |
|---|---|
| El endpoint es de solo lectura y no expone datos personalizados (catálogo público, landing page, lookup de países) | ✅ `public: true` |
| El endpoint es un webhook receiver que autentica por firma de payload, no por JWT | ✅ `public: true` (verificación de firma implementada manualmente en Fase 3) |
| El endpoint requiere cualquier forma de identidad del usuario | ❌ Omitir — usar `authorization` |
| El UC tiene `trigger.kind: event` | ❌ No aplica — en eventos no tiene efecto |

**Reglas de consistencia:**
- `public: true` y `authorization` son mutuamente excluyentes. Si ambos están presentes,
  `public: true` gana y el generador emite warning. Eliminar `authorization` si la intención
  es un endpoint público.
- `public: true` en un command (`type: command`) requiere justificación explícita en
  `{bc-name}-spec.md` — los commands normalmente necesitan identidad del actor para auditoría.

---

## §17 — `cacheable`: cuándo declararlo en un query

Solo válido para `type: query` con `trigger.kind: http`. Genera `@Cacheable` en el handler
y configuración de `RedisCacheManager`. **Requiere `cacheProvider: redis` en `dsl-springboot.json`
— el build falla si falta.**

| Señal | Decisión |
|---|---|
| Query sobre datos estáticos o de muy baja frecuencia de cambio (catálogos, árboles de categorías, listas de países) | ✅ `cacheable: { ttl: PT1H }` |
| Query que retorna detalles de una entidad por ID (lectura frecuente, escritura poco frecuente) | ✅ `cacheable: { ttl: PT5M, keyFields: [entityId] }` |
| Query sobre datos de usuario o que cambian con alta frecuencia | ❌ Omitir |
| UC de tipo `command` | ❌ Prohibido — el generador lo rechaza con error |
| UC con `trigger.kind: event` | ❌ No aplica |

```yaml
cacheable:
  ttl: PT5M            # obligatorio — ISO-8601 duration
  keyFields: [id]      # opcional — campos del input[] usados como clave de caché
  cacheWhen: [id]      # opcional — solo cachear si estos campos no son nulos
```

> **`cacheWhen`:** usar solo cuando el query tiene parámetros opcionales cuya ausencia cambia
> radicalmente el scope del resultado (ej: `SearchProductsByCategory` solo se cachea cuando
> `categoryId` no es nulo). Los campos de `keyFields` y `cacheWhen` deben coincidir
> con nombres declarados en `input[]`.

---

## §18 — Diseño de use cases cuando `consumerIdempotency: true`

Cuando `system.yaml` activa `infrastructure.reliability.consumerIdempotency: true`,
el generador produce una guardia de deduplicación (`IdempotencyGuard`) que registra el
`eventId` en la tabla `processed_event` **en una transacción separada (`REQUIRES_NEW`)
antes de despachar el use case**. Esto tiene una consecuencia crítica de diseño:

**Si el use case falla después de que `IdempotencyGuard.tryRecord()` confirma:**
- La fila `(handlerId, eventId)` persiste en `processed_event` aunque el UC no completó.
- El broker reentregará el mensaje, pero la guardia lo descartará silenciosamente.
- **El use case no se ejecutará en el siguiente reintento.**

Por eso, los use cases con `trigger.kind: event` deben diseñarse con esto en mente:

| Señal en el use case | Acción de diseño recomendada |
|---|---|
| El UC llama a sistemas externos (HTTP, otras BDs) que pueden fallar transitoriamente | Marcar `implementation: scaffold` — documentar en flows.md que el UC debe ser tolerante a fallos |
| El UC escribe en múltiples repositorios en la misma transacción | `implementation: scaffold` — Fase 3 debe garantizar que cada escritura sea idempotente o que la primera sea suficiente |
| El UC es un paso de saga y su fallo dejaría el sistema inconsistente | Documentar en `{bc-name}-flows.md` el comportamiento ante fallo permanente y si existe compensación manual |
| El UC es naturalmente idempotente (ej: upsert de proyección, actualización de estado que verifica el estado actual) | No requiere acción especial — el diseño ya garantiza que re-ejecutar produce el mismo resultado |

> **En resumen:** con `consumerIdempotency: true`, el primer intento fallido de un use case
> disparado por evento es potencialmente el último. Los use cases con `trigger.kind: event`
> deben ser **internamente resilientes**, no depender de una nueva entrega del mismo mensaje
> para corregir un fallo previo.

---

## §19 — `derivedFrom` / `derived_from`: prohibido en `useCases[]`

**No declarar `derivedFrom` ni `derived_from` como campo de un use case.** El generador
rechaza claves desconocidas en `useCases[]` y el build falla.

La trazabilidad del UC ya viene dada por:
- Su `id` (`UC-XXX-NNN`)
- `trigger.kind` + `trigger.operationId` (HTTP) o `trigger.consumes` (eventos)
- `rules: [RULE-ID, ...]` para enlazar a reglas de dominio

`derivedFrom` solo es válido en otros contextos:

| Contexto válido | Cómo declararlo |
|---|---|
| Método de repositorio derivado de una regla | `repositories[].queryMethods[].derivedFrom: PRD-RULE-002` |
| Método de repositorio derivado de un operationId | `repositories[].queryMethods[].derivedFrom: openapi:listProducts` |
| Propiedad de agregado computada | `aggregates[].properties[].source: derived` con `derivedFrom` y `expression` |
| Propiedad de projection computada | `projections[].properties[].derivedFrom: [campo1, campo2]` |
| Campo de payload de evento derivado | `domainEvents.published[].payload[].source: derived` |
