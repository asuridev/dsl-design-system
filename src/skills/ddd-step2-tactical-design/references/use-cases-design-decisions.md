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
    allowRoleBypass: true    # los ADMIN saltan el check de ownership
```

**Criterio:**
- `rolesAnyOf` solo → control de acceso grueso basado en el rol del usuario.
- `permissionsAnyOf` solo → control fino cuando los roles no son suficientes
  (diferentes usuarios del mismo rol tienen permisos distintos).
- Ambos → el usuario debe cumplir los dos (AND). Usar cuando el permiso de negocio
  es más restrictivo que el rol asignado.
- `ownership` → el recurso debe pertenecer al usuario autenticado (multi-tenant,
  self-service). `allowRoleBypass: true` si los admins deben poder actuar sobre
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
  storage: redis               # database (default) | redis
```

**Reglas:**
- Usar `redis` cuando la ventana de idempotencia es corta y el volumen es alto (mejor
  rendimiento). Usar `database` si los datos deben sobrevivir reinicios o el volumen
  es bajo.
- No declarar `idempotency` en queries — son operaciones de lectura; la idempotencia
  no aplica.
- No declarar `idempotency` en comandos disparados por eventos (`trigger.kind: event`) —
  la idempotencia de mensajes se gestiona en la capa de messaging (no en el handler).

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
