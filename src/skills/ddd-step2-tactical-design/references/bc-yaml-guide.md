# Guía de `{bc-name}.yaml` — Diseño Táctico (Paso 2)

`{bc-name}.yaml` es la **fuente de verdad táctica de un Bounded Context**. Lo genera el
agente `design-bounded-context` durante el Paso 2. Es el input principal que un generador
de código consume para producir entidades, repositorios, use cases, APIs y esquemas de base
de datos. Como el `system.yaml`, es technology-agnostic: no menciona frameworks ni librerías.

El archivo se ubica en `arch/{bc-name}/{bc-name}.yaml`.

---

## Estructura general

Las secciones aparecen siempre en este orden:

```
bc              → identificador del BC
type            → clasificación DDD
description     → propósito del BC
enums           → tipos con valores cerrados (estados, clasificaciones)
valueObjects    → tipos de valor compuestos
projections     → shapes de lectura (retornos de queries no 1:1 con agregados)
aggregates      → modelo del dominio (entidades, reglas, propiedades)
useCases        → operaciones que el BC expone o reacciona
repositories    → contratos de acceso a datos
errors          → catálogo de errores del dominio
integrations    → dependencias del BC hacia afuera y hacia adentro
domainEvents    → eventos publicados y consumidos
```

---

## Cabecera del BC

```yaml
bc: catalog
type: core
description: >
  Manages the lifecycle of products and categories, from initial draft creation
  through activation, price changes, and final discontinuation.
```

| Campo | Tipo | Descripción |
|---|---|---|
| `bc` | kebab-case | Debe coincidir exactamente con el `name` del BC en `system.yaml`. |
| `type` | `core` \| `supporting` \| `generic` | Clasificación DDD, igual a la declarada en `system.yaml`. |
| `description` | texto (inglés) | 1–2 oraciones. Derivar del campo `purpose` de `system.yaml`. |

---

## `enums` — Tipos enumerados

Hay dos clases de enums:

### Enum de ciclo de vida (estados)

Modela las transiciones válidas de un agregado. Cada valor de estado declara las
transiciones posibles, qué las dispara y qué evento emite.

```yaml
enums:

  - name: ProductStatus
    description: Lifecycle states of a Product aggregate.
    values:
      - value: DRAFT
        description: Product is being prepared, not yet visible to customers.
        transitions:
          - to: ACTIVE
            triggeredBy: UC-PRD-004 ActivateProduct
            condition: PRD-RULE-001             # gate: bloquea la transición si no se cumple
            rules: [PRD-RULE-001, PRD-RULE-002]  # todas las reglas evaluadas en el UC
            emits: ProductActivated
          - to: DISCONTINUED
            triggeredBy: UC-PRD-005 DiscontinueProduct
            condition: none
            rules: []
            emits: ProductDiscontinued

      - value: ACTIVE
        description: Product is live and available for purchase.
        transitions:
          - to: DISCONTINUED
            triggeredBy: UC-PRD-005 DiscontinueProduct
            condition: none
            rules: []
            emits: ProductDiscontinued

      - value: DISCONTINUED
        description: Product is permanently retired. No further transitions.
        transitions: []   # estado terminal — sin salidas
```

**Campos de una transición:**

| Campo | Tipo | Descripción |
|---|---|---|
| `to` | SCREAMING_SNAKE | Estado destino. |
| `triggeredBy` | `UC-ID NombreUC` | Use case que dispara la transición. |
| `condition` | `RULE-ID` o `none` | La regla que actúa como **puerta de entrada**: si no se cumple, la transición falla y se lanza el `errorCode` de esa regla. Siempre un ID o `none`, nunca texto libre. |
| `rules` | lista de RULE-ID | **Todas** las reglas evaluadas durante la ejecución del use case para esta transición. Incluye la `condition` más cualquier regla adicional (`sideEffect`, `uniqueness`, etc.). Omitir si vacío. |
| `emits` | PascalCase o `null` | Evento de dominio emitido al completar la transición. |

> **`condition` vs `rules`:** `condition` es la única regla que actúa como puerta de entrada — bloquea la transición si no se cumple. `rules` es el conjunto completo evaluado durante el use case: puede coincidir con `condition` cuando hay una sola regla, o ser un superconjunto cuando hay varias. En el ejemplo de arriba: `PRD-RULE-001` es el gate (¿puede activarse el producto?); `PRD-RULE-002` también se evalúa en el mismo use case (unicidad de SKU) pero no es el gate de la transición.

### Enum de clasificación simple

Sin ciclo de vida — solo un conjunto cerrado de valores.

```yaml
  - name: ImageType
    description: Classification of product image by its role.
    values:
      - value: MAIN
        description: Primary product image shown in listings.
      - value: GALLERY
        description: Additional image shown in the product detail gallery.
      - value: THUMBNAIL
        description: Small format image for compact views.
```

---

## `valueObjects` — Objetos de valor

Un Value Object es un tipo compuesto definido por sus propiedades, sin identidad propia.
Ejemplos canónicos: `Money`, `Slug`, `ShippingAddress`, `DateRange`.

> **Regla clave — qué va en `valueObjects[]` y qué en `eventDtos[]`:**
> - `valueObjects[]` → conceptos **del dominio propio** de este BC. Tienen semántica, invariantes y razón de ser dentro del negocio de este BC (ej: `Money`, `ShippingAddress`).
> - `eventDtos[]` → shapes que **llegan de eventos externos** y no pertenecen al dominio propio. Se usan solo como carriers de datos entrantes (ej: `OrderLineSnapshot` que viene del BC `orders`).
> Confundirlos contamina el modelo de dominio con conceptos ajenos.

```yaml
valueObjects:

  - name: Money
    description: >
      Represents an exact monetary amount with its currency.
      Modeled as a VO to guarantee that amount and currency always travel together
      and that precision is never lost through floating-point representation.
    properties:
      - name: amount
        type: Decimal
        precision: 19
        scale: 4
        required: true
        description: Exact monetary amount as a decimal string.
      - name: currency
        type: String(3)
        required: true
        description: ISO 4217 currency code (e.g. COP, USD, EUR).
```

### Tipos canónicos disponibles para propiedades

| Tipo | Descripción | Notas |
|---|---|---|
| `Uuid` | Identificador único | Siempre para campos `id` y referencias. |
| `String` | Texto sin límite | Usar solo si la longitud es realmente desconocida. |
| `String(n)` | Texto con máximo n caracteres | Preferir sobre `String` cuando se conoce el límite. |
| `Text` | Texto largo | Descripciones, contenido HTML, notas. |
| `Integer` | Entero 32 bits | Cantidades, contadores. |
| `Long` | Entero 64 bits | Contadores muy grandes, timestamps Unix. |
| `Decimal` | Decimal de precisión exacta | Siempre usar con `precision` y `scale`. |
| `Boolean` | Verdadero / falso | |
| `Date` | Fecha sin hora | Fecha de nacimiento, vencimiento. |
| `DateTime` | Fecha y hora UTC | Timestamps de eventos y auditoría. |
| `Email` | Email validado | Genera validación automática. |
| `Url` | URL absoluta validada | |
| `Money` | VO monetario | Siempre declarar como Value Object, no como primitivo. |

---

## `eventDtos` — Shapes de eventos externos

Declara los tipos de objetos complejos que llegan en `consumed[].payload[]` de otros BCs.
El generador los produce como Java `record` en `application.dtos.incoming/` — **no** en `domain.valueobject/`.

### ¿Cuándo usar `eventDtos[]`?

Cuando el payload de un evento consumido incluye un campo con un tipo que es un objeto compuesto
(no un primitivo como `Uuid`, `String`, `Integer`) y ese objeto **no tiene significado semántico
propio en el dominio de este BC** — solo existe porque lo envió el BC productor.

Ejemplos típicos: `OrderLineSnapshot`, `ProductSnapshot`, `AddressSnapshot`.

**Diferencia con `valueObjects[]`:**

| Criterio | `valueObjects[]` | `eventDtos[]` |
|---|---|---|
| ¿Tiene invariantes propias del dominio? | Sí (`Money` siempre tiene currency) | No — solo carrier de datos |
| ¿Tiene semántica en el negocio de ESTE BC? | Sí | No — viene del BC productor |
| ¿Tiene lógica de validación? | Sí — se valida en constructor | No — solo deserialización |
| ¿Dónde genera el código? | `domain.valueobject/` — clase final | `application.dtos.incoming/` — Java record |

```yaml
eventDtos:

  - name: OrderLineSnapshot          # PascalCase — ej: OrderLineSnapshot, ProductSnapshot
    sourceBc: orders                 # BC que publica el evento (solo documentación)
    properties:
      - name: productId
        type: Uuid
      - name: quantity
        type: Integer
      - name: unitPrice
        type: Money                  # puede referenciar valueObjects[] del dominio propio
```

### Tipos permitidos en `eventDtos[].properties[]`

| Tipo | Resolución |
|---|---|
| Tipos canónicos (`Uuid`, `String`, `Decimal`, `Money`, …) | Via `mapType()` normal |
| Enum declarado en `enums[]` de este BC | Importa desde `domain.enums` |
| Otro `eventDto` de este mismo BC | Mismo paquete, sin import |
| VO declarado en `valueObjects[]` de este BC | Importa desde `domain.valueobject` |

### Referencia en `domainMethods` y `useCases`

Cuando un use case event-triggered recibe un `eventDto` en su `input[]`, se usa igual que un VO:

```yaml
useCases:
  - id: uc-billing-001
    name: GenerateInvoice
    type: command
    trigger:
      kind: event
      event: OrderPlaced
    input:
      - name: lines
        type: List[OrderLineSnapshot]   # resuelve contra eventDtos[]
```

Y el `domainMethod` del agregado también usa el mismo tipo:

```yaml
domainMethods:
  - name: generate
    params:
      - name: lines
        type: List[OrderLineSnapshot]   # resuelve contra eventDtos[] → genera import correcto
```

---

## `projections` — Shapes de lectura

Una proyección es un shape de lectura que **no existe como estado del dominio** — nunca vive
como propiedad de un agregado o entidad. Su único rol es tipificar el `returns` de un use
case de tipo `query`.

**Regla de clasificación:**

| Pregunta | Respuesta → Dónde va |
|---|---|
| ¿El tipo vive como propiedad de un agregado/entidad? | `valueObjects[]` |
| ¿El tipo solo aparece en `returns` de queries? | `projections[]` (nombrado) o inline |
| ¿El mismo shape lo retornan ≥2 UCs, o tiene nombre semántico en el negocio? | `projections[]` nombrado |
| ¿Shape simple de un único UC? | Lista inline en `returns` del UC |

```yaml
projections:

  # Proyección para listados: subconjunto del agregado sin campos pesados
  - name: ProductSummary
    description: >
      Lightweight view of a product for listing endpoints. Excludes description
      and images to keep list payloads lightweight.
    properties:
      - name: id
        type: Uuid
        required: true
      - name: name
        type: String(200)
        required: true
      - name: price
        type: Money
        required: true
      - name: status
        type: ProductStatus
        required: true
      - name: categoryId
        type: Uuid
        required: true

  # Proyección para integración interna: shape mínimo para un contrato BC-a-BC
  - name: ProductPriceSnapshot
    description: >
      Authoritative price captured at query time. Used by the orders BC at checkout
      to prevent OWASP A04 monetary fraud through stale or manipulated prices.
    properties:
      - name: productId
        type: Uuid
        required: true
      - name: price
        type: Money
        required: true
```

Referenciadas desde `returns` del use case:

```yaml
returns: Page[ProductSummary]      # colección paginada
returns: ProductPriceSnapshot      # objeto simple
returns: ProductDetail             # detalle completo
```

`returns` inline para shapes simples de un único UC:

```yaml
- id: UC-INT-001
  name: ValidateProductAndSnapPrice
  type: query
  ...
  returns:
    - name: productId
      type: Uuid
    - name: price
      type: Money
```

**Naming:** el nombre expresa **qué es el dato**, no cómo se transfiere.
- Prohibidos: `*Response`, `*Dto`, `*Request`, `*Payload`
- Correctos: `ProductSummary`, `ProductDetail`, `ProductPriceSnapshot`, `OrderLineSummary`

---

## `aggregates` — Modelo del dominio

El núcleo del archivo. Cada agregado es una unidad de consistencia con su raíz, propiedades,
entidades internas, reglas de negocio y — opcionalmente — sus flags especiales.

```yaml
aggregates:

  - name: Product
    root: Product
    auditable: true
    description: >
      Central entity of the catalog BC. Represents a sellable item with its
      commercial information and lifecycle status. Its invariant is that price
      and category are always valid before activation.
```

### Flags del agregado

| Flag | Descripción |
|---|---|
| `auditable: true` | El generador inyecta `createdAt` y `updatedAt` automáticamente. No declararlos como propiedades. |
| `softDelete: true` | Borrado lógico. El generador inyecta `deletedAt` (nullable). Todos los `findAll` filtran `deletedAt IS NULL`. El endpoint DELETE mapea a `softDelete(id)`. |
| `readModel: true` | Agregado de proyección local (Local Read Model). Alimentado por eventos de otro BC. El generador no genera endpoints de escritura. Requiere `sourceBC` y `sourceEvents`. |

### Propiedades

```yaml
    properties:
      - name: id
        type: Uuid
        required: true
        description: Unique identifier of the product.

      - name: name
        type: String(200)
        required: true
        description: Commercial name of the product.

      - name: sku
        type: String(100)
        required: true
        unique: true          # genera índice UNIQUE en DB
        description: Stock-keeping unit code. Unique across the catalog.

      - name: status
        type: ProductStatus   # referencia al enum declarado arriba
        required: true
        readOnly: true
        defaultValue: DRAFT   # valor inicial en la factory del agregado

      - name: categoryId
        type: Uuid
        required: true
        references: Category
        relationship: association
        cardinality: manyToOne
        description: Reference to the category this product belongs to.

      - name: price
        type: Money           # referencia al Value Object
        required: true
        description: Current selling price of the product.

      - name: slug
        type: String(200)
        required: true
        readOnly: true
        description: URL-friendly identifier derived from the name. Computed server-side.
```

**Campos de una propiedad:**

| Campo | Descripción |
|---|---|
| `name` | camelCase. **No usar palabras reservadas de Java/SQL/JPQL** como nombre de propiedad (`default`, `class`, `case`, `new`, `order`, `group`, `user`, `key`, `value`, `level`, `desc`, `asc`…): el generador las emite como identificadores Java y rutas JPQL/columnas, y romperían la compilación o la query. Para **banderas booleanas** usar el prefijo `is`/`has`: `isDefault`, `isActive`, `isVerified` (nunca `default`, `active`, `verified`). |
| `type` | Tipo canónico, enum propio, o Value Object. |
| `required` | `true` \| `false`. |
| `unique` | `true` → índice UNIQUE en DB y método `findBy{Campo}` en el repositorio. |
| `indexed` | `true` → índice no-unique en DB (para campos de búsqueda frecuente). |
| `references` | Nombre del agregado referenciado (para asociaciones). |
| `relationship` | `association` (referencia por ID, sin embeber). |
| `cardinality` | `manyToOne` \| `oneToOne`. |
| `bc` | BC propietario del agregado referenciado (solo en asociaciones cross-BC). |

### Flags de visibilidad de propiedades

| Flag | Significado | Caso de uso |
|---|---|---|
| `readOnly: true` | Server-generated. Excluida de requests, incluida en responses y DB. Requiere `defaultValue` o `source`. | `status`, `slug`, `createdBy` |
| `hidden: true` | Write-only. Incluida en requests, excluida de responses. Persiste en DB. | `password`, `pin`, tokens secretos |
| `internal: true` | Solo en DB. Excluida de requests y responses. | `attemptCount`, `retryCount`, flags internos |

**`defaultValue` para campos `readOnly`:**
- `defaultValue: DRAFT` → valor literal en la factory
- `defaultValue: now()` → `DateTime.now(UTC)` resuelto en el application service
- `source: authContext` → inyectado desde el contexto de autenticación

### Entidades internas (composición)

Las entidades solo existen dentro del agregado. Su ciclo de vida pertenece al root.

```yaml
    entities:
      - name: ProductImage
        relationship: composition
        cardinality: oneToMany
        description: Images associated with the product.
        properties:
          - name: id
            type: Uuid
            required: true
          - name: url
            type: Url
            required: true
          - name: type
            type: ImageType
            required: true
          - name: sortOrder
            type: Integer
            required: true
```

> **`immutable: true`** en una entidad indica que solo permite INSERT, no UPDATE ni DELETE.
> Útil para `PriceHistory`, `AuditLog`, `EventLog`.

### Reglas de dominio

Las invariantes que el sistema debe hacer cumplir siempre, independientemente del actor.

```yaml
    domainRules:
      - id: PRD-RULE-001
        type: statePrecondition
        errorCode: PRODUCT_NOT_ACTIVATABLE
        description: >
          A product can only be activated if it has a name, a valid price greater
          than zero, and at least one image.

      - id: PRD-RULE-002
        type: uniqueness
        errorCode: PRODUCT_SKU_ALREADY_EXISTS
        description: >
          SKU must be unique across all products in the catalog, regardless of status.

      - id: PRD-RULE-003
        type: deleteGuard
        errorCode: PRODUCT_CANNOT_BE_DELETED
        description: >
          A product can only be physically deleted if it is in DRAFT status.
```

**Tipos de regla:**

| Tipo | Qué genera el generador |
|---|---|
| `statePrecondition` | Guard en el método de dominio que verifica la condición antes de transicionar. |
| `uniqueness` | Índice UNIQUE en DB + método `findBy{Campo}` en el repositorio. |
| `terminalState` | Documenta que el estado no tiene salidas; sin método de transición. |
| `sideEffect` | **Ninguno** — el generador no emite código para esta regla (`emptyResult()`). Es una anotación de diseño: documenta la intención del efecto secundario para Fase 3. Implementar manualmente en el handler o vía evento de dominio con `emits`. |
| `deleteGuard` | Guard en el use case de delete + método `delete` en el repositorio. |
| `crossAggregateConstraint` | Método de query en el repositorio del otro agregado. |

---

## `domainMethods` — Métodos de dominio del agregado

Cada agregado declara en `domainMethods` sus métodos de comportamiento invocables por commands.
Esta sección es la **fuente de verdad** para parámetros, retornos y eventos de commands.
Las queries **no referencian** `domainMethods`.

Se declara dentro del agregado, después de `domainRules`. Solo en agregados que **no** son `readModel: true`.
Agregados con `readModel: true` usan `upsert` / `delete` como valores especiales de `method` en el UC
— esos son operaciones de repositorio directo, no métodos de dominio, y no se declaran aquí.

```yaml
aggregates:
  - name: Product
    ...
    domainMethods:
      - name: activate
        params: []           # omitir si el método no recibe parámetros externos
        returns: void
        emits: ProductActivated

      - name: discontinue
        params: []
        returns: void
        emits: ProductDiscontinued

      - name: updatePrice
        params:
          - name: newPrice
            type: Money
        returns: void
        emits: ProductPriceUpdated

  - name: Cart
    ...
    domainMethods:
      - name: create
        params:
          - name: customerId
            type: Uuid
        returns: Cart        # tipo del agregado cuando el método es una factory (creación)
        emits: null

      - name: checkout
        params:
          - name: addressSnapshotId
            type: Uuid
          - name: catalogPrices
            type: List[ProductPriceSnapshot]  # VO declarado en valueObjects[] del BC consumidor
        returns: void
        emits: OrderPlaced
```

**Propiedades de `domainMethods`:**

| Campo | Obligatorio | Descripción |
|---|---|---|
| `name` | sí | camelCase. Referenciado desde `useCases[].method` en commands. |
| `params` | no (omitir si vacío) | Parámetros del método. El generador los resuelve desde `input[]`, `outgoingCalls[]` y constantes en la Fase 3. |
| `params[].name` | sí | camelCase. |
| `params[].type` | sí | Tipo DSL del parámetro. |
| `returns` | sí | `void` si no devuelve nada; tipo del agregado para factories (ej: `Cart`). |
| `emits` | sí | Evento de dominio publicado tras la ejecución exitosa. `null` si no emite. |

---

## `useCases` — Operaciones del BC

Cada use case es una operación con nombre, actor, trigger, y comportamiento definido.
Hay tres tipos según su naturaleza y trigger.

### Command disparado por HTTP

```yaml
useCases:

  - id: UC-PRD-004
    name: ActivateProduct
    type: command
    actor: operator
    trigger:
      kind: http
      operationId: activateProduct
    aggregate: Product
    method: activate              # → aggregates[Product].domainMethods[activate]
    input: []                     # activate() no recibe parámetros externos
    rules: [PRD-RULE-001]
    notFoundError: [PRODUCT_NOT_FOUND]
    fkValidations: []
    implementation: full

  - id: UC-PRD-003
    name: UpdateProductPrice
    type: command
    actor: operator
    trigger:
      kind: http
      operationId: updateProductPrice
    aggregate: Product
    method: updatePrice           # → aggregates[Product].domainMethods[updatePrice]
    input:
      - name: id
        type: Uuid
        required: true
        source: path
        loadAggregate: true       # carga Product via repository.findById(id)
      - name: newPrice
        type: Money
        required: true
        source: body
    rules: []
    notFoundError: [PRODUCT_NOT_FOUND]
    fkValidations: []
    implementation: full

  - id: UC-ORD-005
    name: CheckoutCart
    type: command
    actor: customer
    trigger:
      kind: http
      operationId: checkoutCart
    aggregate: Cart
    method: checkout              # → aggregates[Cart].domainMethods[checkout]
    input:
      - name: cartId
        type: Uuid
        required: true
        source: path
        loadAggregate: true       # carga Cart via repository.findById(cartId)
      - name: addressSnapshotId
        type: Uuid
        required: true
        source: body
    rules: [ORD-RULE-001]
    notFoundError: [CART_NOT_FOUND, CUSTOMER_ADDRESS_SNAPSHOT_NOT_FOUND]
    fkValidations:
      - aggregate: CustomerAddressSnapshot
        param: addressSnapshotId
        error: CUSTOMER_ADDRESS_SNAPSHOT_NOT_FOUND
    outgoingCalls:
      - port: CatalogPort
        method: validateProductsAndPrices
        params: [cartId]
        bindsTo: catalogPrices    # → domainMethods[checkout].params[catalogPrices]
    implementation: full          # outgoingCalls cubre catalogPrices — todos los params resolvibles
```

### Query disparada por HTTP

```yaml
  # Query por ID (Path A: loadAggregate)
  - id: UC-PRD-001
    name: GetProduct
    type: query
    actor: operator
    trigger:
      kind: http
      operationId: getProduct
    aggregate: Product
    input:
      - name: id
        type: Uuid
        required: true
        source: path
        loadAggregate: true       # Path A: el generador invoca findById(id) directamente
    returns: ProductDetail        # nombre en projections[]. Para retornar el DTO completo del agregado: {AggregateName}Response (ej: ProductResponse). NO usar el nombre del agregado a secas.
    rules: []
    notFoundError: [PRODUCT_NOT_FOUND]
    implementation: full

  # Query con filtros y paginación (Path B: name matching)
  - id: UC-PRD-002
    name: ListProducts
    type: query
    actor: operator
    trigger:
      kind: http
      operationId: listProducts
    aggregate: Product
    input:
      - name: status
        type: ProductStatus
        required: false
        source: query
      - name: page
        type: PageRequest
        required: false
        source: query
    returns: Page[ProductSummary]
    rules: []
    implementation: full
```

> **Path A vs Path B:** Cuando un `input[]` tiene `loadAggregate: true`, el generador usa **Path A**
> (`repository.findById`). Cuando ningún `input[]` tiene `loadAggregate: true`, el generador usa **Path B**
> (cruza los nombres de `input[]` contra `repositories[aggregate].queryMethods` para identificar el método).

### Command disparado por evento

```yaml
  - id: UC-ORD-012
    name: CancelOrderOnStockFailed
    type: command
    actor: system
    trigger:
      kind: event
      event: StockReservationFailed
      channel: inventory.stock.reservation.failed
    aggregate: Order
    method: cancel                # → aggregates[Order].domainMethods[cancel]
    input:
      - name: orderId
        type: Uuid
        required: true
        source: event.orderId
        loadAggregate: true       # carga Order via repository.findById(orderId)
    rules: [ORD-RULE-005]
    notFoundError: [ORDER_NOT_FOUND]
    fkValidations: []
    implementation: scaffold      # TODO: reason = constante STOCK_RESERVATION_FAILED

  # LRM event handler (upsert de proyección)
  - id: UC-ORD-019
    name: HandleAddressCreated
    type: command
    actor: system
    trigger:
      kind: event
      event: AddressCreated
      channel: customers.address.created
    aggregate: CustomerAddressSnapshot  # readModel: true
    method: upsert                      # operación de repositorio directo — no en domainMethods
    input:
      - name: addressId
        type: Uuid
        required: true
        source: event.addressId
      - name: customerId
        type: Uuid
        required: true
        source: event.customerId
    rules: []
    fkValidations: []
    implementation: full
```

**Campos de un use case:**

| Campo | Obligatorio | Descripción |
|---|---|---|
| `id` | sí | `UC-{ABREV}-{NNN}`. La abreviatura es del BC (ej: `PRD`, `ORD`, `CAT`). |
| `name` | sí | PascalCase. Nombre descriptivo de la operación. |
| `type` | sí | `command` (modifica estado) \| `query` (solo lectura). |
| `actor` | sí | `customer` \| `operator` \| `driver` \| `system`. |
| `trigger.kind` | sí | `http` (llamada API) \| `event` (mensaje del broker). |
| `trigger.operationId` | si `kind: http` | `operationId` exacto del OpenAPI. |
| `trigger.event` | si `kind: event` | Nombre del evento consumido. |
| `trigger.channel` | si `kind: event` | Canal AsyncAPI del evento. |
| `aggregate` | sí | Agregado sobre el que actúa el use case. |
| `method` | si `type: command` | Nombre del método de dominio. Resuelto como `aggregates[aggregate].domainMethods[method]`. **Ausente en queries.** Para `readModel: true`: `upsert` o `delete` (operaciones de repositorio directo). |
| `input` | no (omitir si vacío) | Parámetros externos que recibe el handler (evento, HTTP, authContext). |
| `input[].source` | sí | `event.{campo}` \| `path` \| `query` \| `body` \| `authContext`. |
| `input[].loadAggregate` | no | `true` activa `findById(param)` antes de invocar el método (commands) o como Path A (queries). Un único param por UC puede declararlo; tipo `Uuid`. |
| `returns` | si `type: query` + `kind: http`; o command HTTP con response JSON | Nombre en `projections[]`, `{AggregateName}Response` para el DTO completo del agregado, o lista inline de propiedades. **Nunca el nombre del agregado a secas.** En commands se omite por defecto; solo declararlo si el OpenAPI declara `responses.<2xx>.content.application/json` y debe coincidir con ese schema. |
| `rules` | sí | Lista de RULE-IDs evaluados dentro del use case. `[]` si no aplica ninguna. |
| `notFoundError` | no | Lista de códigos lanzados cuando la entidad no existe. Siempre lista: `[ERROR_CODE]`. Omitir cuando no aplica. |
| `fkValidations` | si `type: command` | Lista de validaciones de FK. `[]` si no hay FK. |
| `fkValidations[].aggregate` | sí | Agregado cuya existencia se valida. |
| `fkValidations[].param` | sí | Nombre del `input[]` que contiene el UUID de FK. |
| `fkValidations[].error` | sí* | Código de error si el FK no existe. Campo preferido. |
| `fkValidations[].notFoundError` | no | Alias aceptado por el validador para el mismo código de error. No usar junto con `error` en la misma entrada. |
| `outgoingCalls` | no | Llamadas explícitas a puertos externos. Omitir si no hay. |
| `outgoingCalls[].port` | sí | Nombre del puerto. Debe existir en `integrations.outbound[]`. |
| `outgoingCalls[].method` | sí | Método del puerto a invocar. |
| `outgoingCalls[].params` | no | Nombres de `input[]` pasados al puerto. Omitir si ninguno. |
| `outgoingCalls[].bindsTo` | sí | Parámetro de `domainMethods[method].params` al que se asigna el resultado. |
| `implementation` | sí | `full`: todos los params resolvibles. `scaffold`: TODOs para params no resolvibles. |
| `sagaStep` | no | Solo si es paso o compensación de una Saga declarada en `system.yaml`. |

---

## `repositories` — Contratos de acceso a datos

Declara los métodos que el dominio necesita para leer y escribir sus agregados. Son
interfaces del dominio — el generador produce la implementación concreta (interfaz JPA +
`RepositoryImpl` que traduce entre dominio y JPA).

### Propiedades de nivel de repositorio

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `aggregate` | PascalCase | ✅ | Nombre del agregado. Debe coincidir con un agregado declarado en `aggregates[]`. |
| `queryMethods` | lista | no | Métodos de lectura con filtros múltiples. Generan `@Query` JPQL inline. Fuente de verdad para el Path B de resolución de queries. |
| `methods` | lista | no | Métodos con firma directa: `findById`, `findBy{Campo}`, `countBy*`, `save`, `delete`, `existsBy*`. |
| `bulkOperations` | `true` / omitido | no | Cuando `true`, expone `saveAll(List<T>)`, `findAllById(List<UUID>)` y `count()` en el puerto de dominio. Usar en commands de importación masiva o casos de uso con `bulk:`. |
| `autoDerive` | `true` / `false` | no | Default `true`. Cuando `true`, el generador deriva automáticamente `findBy{Campo}` desde cada `domainRules[].type: uniqueness`. Poner `false` solo cuando ya declaraste el método manualmente con una firma diferente. |

---

### `queryMethods` — métodos de lectura con filtros (Path B)

Son la fuente de verdad para el **Path B**: cuando un query UC no tiene `loadAggregate: true`,
el generador cruza los nombres de `input[]` del UC contra los `params` de cada `queryMethod`
para identificar unívocamente el método a invocar. El generador produce una `@Query` JPQL
inline con condiciones `IS NULL OR` para cada parámetro opcional.

> **Separación estricta:** `queryMethods` son de solo lectura con filtros múltiples.  
> Los métodos point-lookup (`findById`, `findBy{Campo}`) y los de escritura (`save`, `delete`, `count`)  
> van siempre en `methods`. **Un método de listado con parámetros de filtro NUNCA va en `methods`.**

#### Propiedades de un `queryMethod`

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | camelCase | ✅ | Convenciones: `list` (filtros opcionales + paginación), `listBy{Param}` (un param obligatorio), `search{Aggregate}s` (búsqueda semántica). |
| `params` | lista | ✅ | Parámetros de filtro. Ver tabla de campos de param abajo. |
| `returns` | tipo retorno | ✅ | Ver tabla de tipos de retorno abajo. |
| `derivedFrom` | string | no | Origen del método. Ver valores válidos abajo. |
| `defaultSort` | objeto | no | Ordenación por defecto en retornos `List[T]`. Campos: `field` (camelCase, atributo del agregado) y `direction` (`ASC` o `DESC`). **No aplica a `Page[T]`** — el orden lo controla `Pageable.sort` en runtime. |
| `sortable` | lista camelCase | no | Campos por los que puede ordenarse. Se validan contra las propiedades del agregado. |

#### Campos de un `param` de `queryMethod`

| Campo | Descripción |
|---|---|
| `name` | camelCase. Si el nombre coincide con una propiedad del agregado, el generador infiere el predicado `EQ` automáticamente. |
| `type` | Tipo canónico. `List[T]` activa el operador `IN` por defecto. |
| `required` | `false` para filtros opcionales. Omitir (o `true`) para params obligatorios. |
| `filterOn` | Array de propiedades del agregado que filtra este param. **Requerido cuando el nombre del param no corresponde a ninguna propiedad del agregado** (ej: `search`, `q`, `keyword`). Sin este campo el generador no puede derivar el predicado. |
| `operator` | Operador SQL del predicado. **Obligatorio cuando `filterOn` está presente.** |

#### Operadores disponibles

| Operador | SQL generado | Cuándo usar |
|---|---|---|
| `EQ` | `field = :param` | Filtro exacto por estado, ID, booleano. Default implícito cuando el nombre mapea a una propiedad. |
| `LIKE_CONTAINS` | `LOWER(field) LIKE LOWER(CONCAT('%', :param, '%'))` | Búsqueda libre en texto, case-insensitive. El más común para campos de búsqueda. |
| `LIKE_STARTS` | `LOWER(field) LIKE LOWER(CONCAT(:param, '%'))` | Autocompletado con prefijo. |
| `LIKE_ENDS` | `LOWER(field) LIKE LOWER(CONCAT('%', :param))` | Sufijo. |
| `GTE` | `field >= :param` | Rango inferior (precio mínimo, fecha desde). |
| `LTE` | `field <= :param` | Rango superior (precio máximo, fecha hasta). |
| `IN` | `field IN :param` | Filtro multi-valor. El tipo del param debe ser `List[T]`. |

```yaml
repositories:

  - aggregate: Order
    queryMethods:

      - name: listByCustomerId      # filtros opcionales + paginación
        params:
          - name: customerId
            type: Uuid
            required: true          # el campo obligatorio que define el scope
          - name: status
            type: OrderStatus
            required: false         # filtro opcional
          - name: page
            type: PageRequest
            required: false
        returns: "Page[Order]"
        defaultSort:
          field: createdAt
          direction: DESC
        sortable:
          - createdAt
          - totalAmount
        derivedFrom: openapi:listOrders

      - name: searchProducts        # búsqueda semántica con rango de precios
        params:
          - name: searchTerm
            type: String
            required: false
            filterOn: [name, sku]   # filtra sobre Product.name Y Product.sku
            operator: LIKE_CONTAINS
          - name: minPrice
            type: Decimal
            required: false
            filterOn: [priceAmount] # nombre de columna JPA (Money expandida)
            operator: GTE
          - name: maxPrice
            type: Decimal
            required: false
            filterOn: [priceAmount]
            operator: LTE
          - name: statusList
            type: List[ProductStatus]
            required: false
            filterOn: [status]
            operator: IN
          - name: page
            type: PageRequest
            required: true
        returns: "Page[Product]"
        derivedFrom: openapi:searchProducts

      - name: findActiveByCustomerId # lookup puntual por estado + campo
        params:
          - name: customerId
            type: Uuid
            required: true
        returns: "Cart?"
        derivedFrom: openapi:getCart
```

`find{Qualifier}By{Field}` es válido cuando `{Qualifier}` resuelve a un literal del enum de estado del agregado (`status` o `*Status`) o a soft delete (`Deleted`, `NonDeleted`, `NotDeleted`). Ejemplo: `findActiveByCustomerId` sobre `CartStatus.ACTIVE` genera `status = 'ACTIVE' AND customerId = :customerId`. `{Field}` debe existir en el agregado raíz. Retornos válidos: `T?`, `List[T]`, `Page[T]`.

`{Qualifier}` también resuelve a una **bandera booleana** del agregado: si existe una propiedad `Boolean` llamada `is{Qualifier}` (p. ej. `isDefault`), el generador deriva `is{Qualifier} = true AND {field} = :{field}`. Aplica a `find/count/exists/search{Qualifier}By{Field}`; los prefijos `Non`/`Not` niegan la bandera (`= false`). Ejemplo: `findDefaultByCustomerId` sobre la propiedad `isDefault` → `isDefault = true AND customerId = :customerId`. **La propiedad debe llamarse `isDefault`, nunca `default`** (palabra reservada de Java/JPQL). Los calificadores de estado y soft-delete tienen prioridad sobre el booleano.

---

### `methods` — métodos point-lookup, escritura y conteo

Los métodos en `methods` tienen firma directa. Incluyen los métodos implícitos (`findById`, `save`)
que el generador crea en todo repositorio, los derivados de `domainRules` y los métodos
explícitos adicionales necesarios.

```yaml
    methods:

      # ─ Método implícito de lectura por ID (siempre presente)
      - name: findById
        params:
          - name: id
            type: Uuid
        returns: "Product?"
        derivedFrom: implicit

      # ─ Derivado de regla de unicidad (autoDerive genera esto si no se declara)
      - name: findBySku
        signature: "findBySku(String(100)): Product?"
        derivedFrom: PRD-RULE-002

      # ─ Derivado de crossAggregateConstraint (cuenta dependientes en otro agregado)
      - name: countNonDeletedByCategoryId  # usar NonDeleted, no Active, en agregados softDelete
        params:
          - name: categoryId
            type: Uuid
        returns: Int
        derivedFrom: PRD-RULE-005

      # ─ Lookup por estado + campo (Qualifier resuelve contra ProductStatus.ACTIVE)
      - name: findActiveByCategoryId
        params:
          - name: categoryId
            type: Uuid
            required: true
        returns: "List[Product]"
        derivedFrom: implicit

      # ─ Método de existencia (Phase 3 opt-in: para guards de deduplicación)
      - name: existsBySkuAndIdNot
        params:
          - name: sku
            type: String(100)
            required: true
          - name: id
            type: Uuid
            required: true
        returns: Boolean
        derivedFrom: PRD-RULE-002

      # ─ Persistencia (siempre presente)
      - name: save
        params:
          - name: entity
            type: Product
        returns: void
        derivedFrom: implicit

      # ─ Eliminación (solo si hay regla deleteGuard)
      - name: delete
        params:
          - name: id
            type: Uuid
        returns: void
        derivedFrom: PRD-RULE-003
```

#### Sintaxis de `signature` (alternativa concisa a `params`/`returns`)

`"methodName(param1Type, param2Name?: param2Type): ReturnType"`

Útil para métodos con un solo parámetro donde el nombre no agrega valor. Ejemplo:
- `"findBySku(String(100)): Product?"` — equivale a `params: [{name: sku, type: String(100)}] + returns: Product?`
- `"existsByEmail(Email): Boolean"`

---

### `derivedFrom` — origen del método

| Valor | Qué significa | Cuándo usarlo |
|---|---|---|
| `implicit` | El generador crea este método en todo repositorio. No requiere declaración explícita en el diseño. | `findById` y `save` siempre. |
| `RULE-ID` | El método existe porque una regla de dominio lo requiere. El ID literal apunta a la regla en `domainRules[]`. | `uniqueness` → `findBy{Campo}`; `deleteGuard` → `delete`; `crossAggregateConstraint` → `countBy{Campo}`. |
| `openapi:{operationId}` | El método existe porque un endpoint del OpenAPI necesita ese acceso a datos. | Queries con filtros (`queryMethods`). |

---

### Tipos de retorno disponibles

| Tipo de retorno | Java | Cuándo usarlo |
|---|---|---|
| `T?` | `Optional<T>` | Nullable — el método puede no encontrar el registro. Siempre en `findById` y `findBy{Campo}`. |
| `Page[T]` | `Page<T>` | Listado paginado con total (UI de tabla con contador). Requiere param `PageRequest`. |
| `Slice[T]` | `Slice<T>` | Listado paginado sin total. Más eficiente: no ejecuta `COUNT(*)`. Para scroll infinito o cursor paginado. |
| `Stream[T]` | `Stream<T>` | Procesamiento incremental de volúmenes masivos (exports, batch). **No usar en handlers HTTP** — Spring cierra la sesión JPA antes de que el stream se consuma. |
| `List[T]` | `List<T>` | Lista completa sin paginación. Solo cuando el volumen está acotado por diseño (ej: líneas de un pedido). |
| `Boolean` | `boolean` | Para `existsBy*`. Verificar existencia sin cargar el objeto. |
| `Long` | `long` | Conteos grandes (`saveAll` count, contadores estadísticos). |
| `Int` | `int` | Conteos pequeños. Para `countBy*` derivados de `crossAggregateConstraint`. |
| `void` | `void` | Para `delete` y `save` (sin retorno). |

---

### Convenciones de naming

| Método | Cuándo usarlo |
|---|---|
| `findById` | Siempre. Busca por la PK del agregado. Derivado implícito — no necesita declaración si `autoDerive: true`. |
| `findBy{Campo}` | Campo con `unique: true` en el agregado o regla `uniqueness`. Retorna `{Aggregate}?`. |
| `existsBy{Campo}` | Guard de deduplicación o verificación de existencia sin cargar la entidad. |
| `list` | Query con filtros opcionales y paginación. Siempre en `queryMethods`. |
| `listBy{Param}` | Query filtrada por un único parámetro **obligatorio** (ej: `listByCustomerId`). Siempre en `queryMethods`. |
| `search{Aggregates}` | Búsqueda semántica con múltiples filtros opcionales y texto libre. Siempre en `queryMethods`. |
| `find{Flag}By{Campo}` | Lookup puntual por bandera booleana + campo. `{Flag}` ↔ propiedad `Boolean` `is{Flag}` del agregado (ej: `findDefaultByCustomerId` sobre `isDefault` → `isDefault = true AND customerId = :customerId`). `Non`/`Not` niegan. La propiedad debe ser `isDefault`, **nunca `default`**. |
| `countBy{Campo}` | Cuenta instancias que referencian otro agregado. Para reglas `crossAggregateConstraint`. |
| `countNonDeletedBy{Campo}` | Igual que `countBy{Campo}` pero agrega `deleted_at IS NULL`. **Usar en vez de `countActiveBy{Campo}`** — el calificador `Active` es ambiguo sin campo `status` explícito. |
| `count{Qualifier}{Aggregates}By{Campo}` | Cuenta instancias filtradas por un literal del enum de status. **Solo un calificador simple** (`Active`, `Draft`, `Non{Literal}`…). Calificadores compuestos (`ActiveDraft`) no son válidos — el build falla. Para "todos excepto X" usar `Non{X}`: `countNonDiscontinuedProductsByCategoryId` → `WHERE status <> 'DISCONTINUED' AND categoryId = :categoryId`. |
| `save` | Siempre. INSERT o UPDATE del agregado. Derivado implícito. |
| `delete` | Solo si hay regla `deleteGuard`. Eliminación física. |

---

### Restricciones en agregados `readModel: true`

Un repositorio de `readModel: true` solo puede declarar:
- `findById` y `findBy{unique}` en `methods`
- `upsert` — operación especial de escritura (sin `save` ni `delete`)

**Nunca declarar `save` ni `delete` en un readModel.** Los readModels se hidratan
exclusivamente vía event-triggered use cases con `method: upsert`. El generador rechaza
`save` y `delete` en un repositorio cuyo agregado es `readModel: true`.

---

### Ejemplo completo con `bulkOperations` y `autoDerive`

```yaml
repositories:

  - aggregate: Product
    bulkOperations: true    # expone saveAll(List<Product>), findAllById(List<UUID>), count()
    autoDerive: true        # default — genera findBySku desde PRD-RULE-002 automáticamente
                            # poner false solo si ya declaraste findBySku con firma diferente

    queryMethods:           # ← métodos con filtros van AQUÍ, no en methods

      - name: list
        params:
          - name: status
            type: ProductStatus
            required: false
          - name: search
            type: String
            required: false
            filterOn: [name, sku]
            operator: LIKE_CONTAINS
          - name: page
            type: PageRequest
            required: true
        returns: "Page[Product]"
        defaultSort:
          field: createdAt
          direction: DESC
        sortable: [createdAt, name, priceAmount]
        derivedFrom: openapi:listProducts

    methods:                # ← solo point-lookup, escritura y conteo van AQUÍ

      - name: findById
        params:
          - name: id
            type: Uuid
        returns: "Product?"
        derivedFrom: implicit

      # findBySku se genera automáticamente desde PRD-RULE-002 (autoDerive: true)
      # Si se declara manualmente, autoDerive lo ignora para este campo

      - name: countNonDeletedByCategoryId
        params:
          - name: categoryId
            type: Uuid
        returns: Int
        derivedFrom: PRD-RULE-005

      - name: save
        params:
          - name: entity
            type: Product
        returns: void
        derivedFrom: implicit

      - name: delete
        params:
          - name: id
            type: Uuid
        returns: void
        derivedFrom: PRD-RULE-003
```

---

## `errors` — Catálogo de errores del dominio

Un error por cada violación posible del dominio. El generador produce clases de excepción
Java tipadas que el `HandlerExceptions` global convierte en respuestas HTTP estructuradas.

> **Regla de completitud:** todo `errorCode` referenciado en `domainRules[].errorCode`,
> `notFoundError`, `lookups[].errorCode`, `fkValidations[].error`, `fkValidations[].notFoundError` o `validations[].errorCode`
> DEBE existir en esta sección. El generador falla si hay un código referenciado sin declarar.

> **Clave prohibida:** `constraintName` **no puede aparecer en `errors[]`**. El validador
> rechaza cualquier clave fuera de la whitelist. El constraint de DB va en
> `aggregates[].domainRules[].constraintName` (junto a la regla `uniqueness`).

---

### Propiedades de un error

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `code` | SCREAMING_SNAKE_CASE | ✅ | Identificador único del error en el BC. |
| `httpStatus` | integer (whitelist) | ✅ | Código HTTP de la respuesta. Ver tabla completa abajo. |
| `description` | texto libre | no | Descripción técnica interna. Se emite como **Javadoc** en la clase de error generada. Añadir siempre que el código no sea autoexplicativo. Ayuda al equipo de Fase 3 a entender cuándo lanzar el error. |
| `message` | texto | no | Mensaje de error para el usuario final (cuando no hay parámetros dinámicos). |
| `title` | texto | no | Título corto de la respuesta de error (visible al cliente en la respuesta JSON). |
| `errorType` | PascalCase + `Error` | no | Override del nombre de la clase Java. Por defecto el generador deriva el nombre mecánicamente del `code` (`PRODUCT_NOT_FOUND` → `ProductNotFoundError`). Usar solo cuando el código es críptico o el nombre derivado es incorrecto. |
| `messageTemplate` | string con `{argName}` | ✅ si `args` declarado | Mensaje parametrizado. Los placeholders `{argName}` son reemplazados en runtime con los `args`. |
| `args` | lista | no | Parámetros del `messageTemplate`. Cada entry: `name` (camelCase) + `type` (tipo Java: `String`, `UUID`, `Integer`, `BigDecimal`, etc.). |
| `chainable` | `true` / `false` | no | Default: `false`. Cuando `true`, genera un constructor adicional `(Throwable cause)` en la clase. Usar cuando el error envuelve una excepción de infraestructura (timeout, conexión, BD) y el stack trace de la causa original debe preservarse en los logs. |
| `kind` | `business` / `infrastructure` | no | Default: `business`. `infrastructure` activa la lógica de `triggeredBy`. |
| `triggeredBy` | FQN o nombre simple de clase Java | solo si `kind: infrastructure` | La clase de excepción JVM que el `HandlerExceptions` global traduce a este error de dominio. El generador registra un `@ExceptionHandler` para esta excepción. |
| `usedFor` | `auto` / `manual` | no | Default: `auto`. El generador emite una advertencia si ningún artefacto del YAML referencia el `code`. Usar `manual` para suprimir esta advertencia cuando el error se lanza manualmente en código de Fase 3 (sin declaración en `domainRules`, `notFoundError`, etc.). |

---

### `httpStatus` — valores soportados (whitelist exacta)

Solo se aceptan los siguientes 14 valores. Cualquier otro abortará el build.

| Código | Significado | Cuándo usarlo en el dominio |
|---|---|---|
| `400` | Bad Request | Request inválido sintácticamente. Errores de validación del esquema. |
| `401` | Unauthorized | El usuario no está autenticado. |
| `402` | Payment Required | La operación requiere pago previo. |
| `403` | Forbidden | El usuario no tiene permisos sobre este recurso. |
| `404` | Not Found | El recurso no existe. **El más común para entidades no encontradas.** |
| `408` | Request Timeout | La operación tardó demasiado. |
| `409` | Conflict | Conflicto de estado: SKU duplicado, email ya registrado, estado incompatible. |
| `412` | Precondition Failed | Precondición no cumplida (ETag, versión, estado requerido que no es el actual). |
| `415` | Unsupported Media Type | Tipo de archivo no soportado (uploads). |
| `422` | Unprocessable Entity | Regla de negocio violada. **El más común para errores de dominio** (`statePrecondition`, `crossAggregateConstraint`). |
| `423` | Locked | El recurso está bloqueado temporalmente (procesamiento en curso). |
| `429` | Too Many Requests | Rate limit o cuota excedida. |
| `503` | Service Unavailable | Dependencia externa no disponible (gateway de pago, servicio externo). |
| `504` | Gateway Timeout | Timeout en una llamada a dependencia externa. |

> **Regla práctica:** 404 para "no existe", 409 para "existe pero está en conflicto",
> 422 para "existe pero la operación no puede ejecutarse por una regla de negocio",
> 503/504 para errores de infraestructura externa.

---

### Cuándo usar cada propiedad avanzada

#### `description` — Javadoc de la clase de error

Siempre añadir `description` cuando:
- El código no es autoexplicativo (`RULE_VLD_004`, `CAT_001`, etc.)
- El error se puede confundir con otro de código similar
- Hay matices importantes sobre cuándo lanzarlo vs otros errores del mismo `httpStatus`

```yaml
  - code: PRODUCT_CANNOT_BE_ACTIVATED
    httpStatus: 422
    description: >
      A product can only be activated if it has a name, a valid price greater than zero,
      and at least one image. Thrown by the activate() domain method guard.
    message: The product is missing required fields for activation.
```

#### `messageTemplate` + `args` — cuando el mensaje necesita datos dinámicos

Usar cuando el mensaje de error debe incluir información contextual del request (el valor
que causó el conflicto, el ID del recurso no encontrado, el límite superado, etc.).

```yaml
  - code: PRODUCT_SKU_ALREADY_EXISTS
    httpStatus: 409
    messageTemplate: "A product with SKU '{sku}' already exists in the catalog."
    args:
      - name: sku
        type: String
    description: Uniqueness constraint violation on the product SKU field.
```

El generador produce un constructor Java parametrizado:
```java
public ProductSkuAlreadyExistsError(String sku) {
    super("A product with SKU '" + String.valueOf(sku) + "' already exists in the catalog.",
          "PRODUCT_SKU_ALREADY_EXISTS", 409, new Object[]{ sku });
}
```

> **Cuando no hay datos dinámicos:** usar `message` (texto fijo). No declarar `args` sin `messageTemplate`.

#### `chainable: true` — para errores de infraestructura que envuelven una causa

Usar cuando el error en el dominio corresponde a una falla de una dependencia externa
y es crítico preservar el stack trace original en los logs para debugging.

```yaml
  - code: PAYMENT_GATEWAY_UNAVAILABLE
    httpStatus: 503
    description: The payment gateway returned an unexpected error or timed out.
    chainable: true
```

Genera un constructor adicional:
```java
public PaymentGatewayUnavailableError(Throwable cause) {
    super("PAYMENT_GATEWAY_UNAVAILABLE", cause);
}
// Uso en el adaptador:
// throw new PaymentGatewayUnavailableError(feignException);
```

#### `kind: infrastructure` + `triggeredBy` — mapeo de excepciones JVM a errores de dominio

Usar cuando una excepción técnica lanzada por el runtime (Hibernate, Feign, JPA) debe
traducirse automáticamente en un error de dominio estructurado, sin que Fase 3 deba
escribir un try/catch en cada handler.

El `HandlerExceptions` global registra un `@ExceptionHandler` para la clase indicada.

```yaml
  - code: DATABASE_CONSTRAINT_VIOLATION
    httpStatus: 409
    kind: infrastructure
    triggeredBy: org.springframework.dao.DataIntegrityViolationException
    chainable: true
    description: >
      Triggered reactively when a concurrent insert violates a DB unique constraint.
      Complements the proactive guard generated from uniqueness domainRules.
```

> **Restricción:** `triggeredBy` solo es válido cuando `kind: infrastructure`. El build
> falla si `triggeredBy` está presente sin `kind: infrastructure`. El mismo `triggeredBy`
> no puede mapearse a dos errores distintos en el mismo BC.

#### `usedFor: manual` — errores lanzados solo desde código de Fase 3

Usar para errores que NO aparecen en ningún `domainRule`, `notFoundError`, `lookups[]`,
`fkValidations[]` ni `validations[]` — se lanzan exclusivamente desde código manual
en handlers, adaptadores o sagas.

Sin `usedFor: manual`, el generador emite una advertencia de "error huérfano" que podría
indicar un error de diseño (código declarado pero nunca referenciado).

```yaml
  - code: SAGA_COMPENSATION_FAILED
    httpStatus: 503
    usedFor: manual
    description: >
      Thrown manually from the saga orchestrator when the compensation step also fails.
      Not wired to any domain rule — thrown from infrastructure-level saga code in Fase 3.
```

---

### Ejemplo completo de la sección `errors`

```yaml
errors:

  # Error básico (sin propiedades avanzadas)
  - code: PRODUCT_NOT_FOUND
    httpStatus: 404
    title: Product Not Found
    message: The requested product does not exist in the catalog.
    description: Thrown when a product lookup by ID returns no result.

  # Error con estado de precondición
  - code: PRODUCT_CANNOT_BE_ACTIVATED
    httpStatus: 422
    title: Product Cannot Be Activated
    message: The product cannot be activated because it is not in DRAFT status.
    description: State precondition violation for the activate transition.

  # Error con mensaje parametrizado (SKU que causó el conflicto)
  - code: PRODUCT_SKU_ALREADY_EXISTS
    httpStatus: 409
    title: SKU Already Exists
    messageTemplate: "A product with SKU '{sku}' already exists in the catalog."
    args:
      - name: sku
        type: String
    description: Uniqueness constraint violation on the product SKU field.

  # Error de tipo de archivo
  - code: INVALID_IMAGE_TYPE
    httpStatus: 415
    title: Unsupported Image Type
    message: Only PNG, JPEG, and WebP image files are accepted for product images.
    description: Thrown when an uploaded product image has an unsupported MIME type.

  # Error de infraestructura con mapeo reactivo (excepción JVM → error de dominio)
  - code: CATALOG_SERVICE_UNAVAILABLE
    httpStatus: 503
    kind: infrastructure
    triggeredBy: feign.FeignException
    chainable: true
    title: Catalog Service Unavailable
    message: The catalog service is temporarily unavailable. Please retry later.
    description: >
      Thrown when the Feign client receives a non-2xx response or connection error
      from the catalog service. The FeignException is preserved as cause in the log.

  # Error lanzado manualmente desde código de saga (sin domainRule que lo referencie)
  - code: STOCK_RESERVATION_FAILED
    httpStatus: 503
    usedFor: manual
    description: >
      Thrown manually from the order saga orchestrator when inventory returns a
      reservation failure. Not wired to any domain rule in this BC's YAML.
```

---

## `integrations` — Dependencias del BC

Declara de qué depende este BC (`outbound`) y quién depende de él (`inbound`). Complementa
el `system.yaml` con detalle operacional — los nombres de operaciones aquí deben coincidir
exactamente con los `contracts` declarados en las integraciones de `system.yaml`.

La sección tiene dos subsecciones fijas:

| Subsección | Qué declara |
|---|---|
| `outbound` | BCs o sistemas externos a los que este BC llama. Uno por dependencia. |
| `inbound` | BCs que llaman a este BC para consumir sus endpoints. Uno por consumidor. |

---

### `outbound` — dependencias que este BC consume

Campos de cada entrada `outbound`:

| Campo | Descripción |
|---|---|
| `name` | kebab-case. Nombre del BC o sistema externo al que se llama. Debe existir en `system.yaml` como `boundedContext` o `externalSystem`. |
| `type` | `internalBc` si es un BC del mismo sistema; `externalSystem` si es un servicio de terceros. |
| `pattern` | Relación de integración: `customerSupplier` (el proveedor dicta el contrato) \| `acl` (este BC traduce el modelo externo — obligatorio para `externalSystem`) \| `conformist` (este BC adopta el modelo del proveedor tal cual). |
| `protocol` | Mecanismo de transporte: `http` \| `grpc` \| `message-broker`. |
| `description` | Por qué este BC necesita llamar al otro y qué obtiene de él. |
| `operations` | Lista de operaciones que se invocan en el BC/sistema externo. |

Campos de cada `operation` en `outbound`:

| Campo | Descripción |
|---|---|
| `name` | camelCase. Debe coincidir exactamente con el string declarado en `contracts` de `system.yaml` para esta integración. |
| `description` | Qué retorna o qué efecto produce esta operación. |
| `triggersOn` | UC-ID del use case de este BC que dispara la llamada (ej: `UC-PRD-001`). |
| `responseEvents` | Opcional. Eventos emitidos por este BC como consecuencia de la respuesta recibida. |

```yaml
integrations:

  outbound:

    # Dependencia sincrónica hacia otro BC interno
    - name: inventory
      type: internalBc
      pattern: customerSupplier   # inventory dicta el contrato
      protocol: http
      description: >
        catalog calls inventory to read current stock status and expose
        isAvailable on product GET responses.
      operations:
        - name: getStockItem             # coincide con contracts en system.yaml
          description: Returns current stock status (available: boolean) for a product.
          triggersOn: UC-PRD-001         # el use case ListProducts dispara esta llamada

    # Dependencia hacia un sistema externo (siempre ACL)
    - name: payment-gateway
      type: externalSystem
      pattern: acl                # ACL traduce el modelo externo — obligatorio para externos
      protocol: http
      description: >
        catalog uses payment-gateway to validate card tokens before activating
        premium products. ACL prevents gateway DTOs from leaking into the domain.
      operations:
        - name: validateCardToken
          description: Validates that a card token is still active and chargeable.
          triggersOn: UC-PRD-004
```

---

### `inbound` — consumidores que llaman a este BC

Campos de cada entrada `inbound`:

| Campo | Descripción |
|---|---|
| `name` | kebab-case. Nombre del BC que consume los endpoints de este BC. |
| `type` | Siempre `internalBc` — los sistemas externos no declaran `inbound` (ellos llaman a nuestro BC, no al revés). |
| `pattern` | Generalmente `customerSupplier` — este BC es el supplier. |
| `protocol` | Mecanismo de transporte. Casi siempre `http`. |
| `description` | Qué consume el BC llamante y para qué lo usa. |
| `operations` | Lista de endpoints de **este BC** que el consumidor invoca. |

Campos de cada `operation` en `inbound`:

| Campo | Descripción |
|---|---|
| `name` | camelCase. Nombre del endpoint. Coincide con el `operationId` en el OpenAPI de este BC y con el `contract` en `system.yaml`. |
| `definedIn` | Archivo OpenAPI o AsyncAPI donde está definido el endpoint (ej: `catalog-open-api.yaml`). |
| `endpoint` | Método HTTP y ruta del endpoint (ej: `POST /api/catalog/v1/products/validate`). |

```yaml
  inbound:

    - name: orders
      type: internalBc
      pattern: customerSupplier   # este BC (catalog) es el supplier
      protocol: http
      description: >
        orders calls catalog to validate product existence and snapshot
        current prices before confirming a new order.
      operations:
        - name: validateProductsAndPrices   # operationId en catalog-open-api.yaml
          definedIn: catalog-open-api.yaml
          endpoint: POST /api/catalog/v1/products/validate

        - name: getProductById
          definedIn: catalog-open-api.yaml
          endpoint: GET /api/catalog/v1/products/{id}
```

> **Relación con `system.yaml`:** cada `operation.name` en `outbound` e `inbound` debe
> aparecer como string en `contracts` de la integración correspondiente en `system.yaml`.
> Si hay discrepancia, el Paso 2 es incoherente con el Paso 1.

---

## `domainEvents` — Eventos publicados y consumidos

Declara los mensajes de dominio que este BC envía al broker (`published`) y los que
recibe y procesa (`consumed`). Son la fuente de verdad para el `{bc-name}-async-api.yaml`
que se genera en el Paso 2.

La sección tiene dos subsecciones fijas:

| Subsección | Qué declara |
|---|---|
| `published` | Eventos que este BC emite cuando ocurre algo significativo en el dominio. |
| `consumed` | Eventos emitidos por otros BCs que este BC escucha y procesa. |

---

### `published` — eventos que este BC emite

Campos de cada evento publicado:

| Campo | Descripción |
|---|---|
| `name` | PascalCase en tiempo pasado. Describe qué ocurrió (ej: `ProductActivated`, `OrderConfirmed`). Debe coincidir con el `name` en `contracts` de `system.yaml` para las integraciones `channel: message-broker` donde este BC es el `from`. |
| `description` | Cuándo se emite, qué transición o acción lo dispara, y qué efecto produce en los BCs consumidores. |
| `payload` | Lista de campos que viajan con el evento. Ver reglas del payload más abajo. |

Campos de cada campo del `payload`:

| Campo | Descripción |
|---|---|
| `name` | camelCase. Nombre del campo. |
| `type` | Tipo canónico (`Uuid`, `String`, `DateTime`, `Money`, etc.). |
| `required` | `true` \| `false`. Omitir si siempre es requerido (se asume `true`). |

```yaml
domainEvents:

  published:

    - name: ProductActivated
      description: >
        Emitted when a product transitions from DRAFT to ACTIVE status via
        UC-PRD-004. Triggers StockItem creation in inventory BC.
      version: 1                    # opcional (default 1). Incrementar ante cambios breaking del payload.
      scope: integration            # internal | integration | both (default both).
                                    # integration: solo BCs externos. internal: solo listeners del mismo BC.
                                    # both: ambos (más conservador cuando hay duda).
      broker:                       # opcional — hints para el publicador
        partitionKey: productId     # Kafka: garantiza orden de eventos del mismo producto
        dlq:                        # whitelist estricta: afterAttempts, routingKey, queueName
          afterAttempts: 3
          routingKey: dead.catalog.product-activated   # RabbitMQ
          # queueName: catalog.product-activated.dlq  # Kafka (alternativa)
      payload:
        - name: productId           # siempre incluir el ID del agregado
          type: Uuid
          required: true
          # source: aggregate es el default — se puede omitir cuando el nombre coincide con el campo del agregado
        - name: name
          type: String(200)
          required: true
          source: aggregate         # explícito: toma this.getName() del agregado
        - name: categoryId          # FK que el consumidor puede necesitar sin hacer lookup
          type: Uuid
          required: true
        - name: price               # snapshot del precio en el momento del evento
          type: Money
          required: true
        - name: createdBy           # campo readOnly+source:authContext en el agregado
          type: String(200)
          required: true
          source: aggregate         # el agregado ya lo tiene (no usar source: auth-context — PROHIBIDO aqui)
          field: createdBy          # field es necesario si el nombre del campo del payload difiere del agregado

    - name: ProductPriceUpdated
      description: >
        Emitted when UC-PRD-006 successfully updates the price. Consumed by
        orders BC to re-validate cart totals.
      scope: both                   # listeners internos (invalidar caché interna) + BCs externos
      allowHiddenLeak: false        # default false. Solo true cuando un campo hidden: true del agregado
                                   # DEBE viajar en el payload por motivo justificado (datos de auditoría
                                   # cifrada para consumidor interno). Siempre documentar la excepción.
      payload:
        - name: productId
          type: Uuid
          required: true
        - name: newPrice
          type: Money
          required: true
          source: param             # newPrice viene del parámetro del domainMethod updatePrice(newPrice: Money)
                                    # ⚠️ INT-026: newPrice DEBE existir en domainMethods[updatePrice].params[]
        - name: previousPrice
          type: Money
          required: false
          source: aggregate         # previousPrice es un campo del agregado (price antes de la mutación)
          field: price              # field: el nombre del campo en el agregado es 'price', no 'previousPrice'
        - name: updatedAt
          type: DateTime
          required: true
          source: timestamp         # Instant.now() al momento de emitir el evento
        - name: discountCode
          type: String(50)
          required: false
          source: constant
          value: "PROMO2024"       # valor literal fijo (obligatorio cuando source: constant)

    - name: ProductDiscontinued
      description: >
        Emitted when a product reaches DISCONTINUED status. Triggers StockItem
        closure in inventory BC.
      # ⚠️ NO declarar en payload[]: eventId, eventType, eventVersion, occurredAt, sourceBc,
      #    correlationId, causationId. El generador los inyecta como EventMetadata automáticamente.
      payload:
        - name: productId
          type: Uuid
          required: true
```

---

### Reglas del payload de `published`

| `source:` | Significado | Campo auxiliar requerido |
|---|---|---|
| `aggregate` (default) | `this.get{Field}()` del agregado raíz | `field:` si el nombre del payload difiere del campo en el agregado |
| `param` | Parámetro del `domainMethod` | `param:` (alias opcional si el nombre difiere) ⚠️ INT-026: el param DEBE existir en `domainMethods[method].params[]` |
| `timestamp` | `Instant.now()` al momento de emitir | — |
| `constant` | Valor literal fijo | `value: "{literal}"` — **obligatorio** |
| `derived` | **No soportado en payloads de eventos por el validador actual (`BC-121`)** | Materializar el valor en el agregado y emitirlo con `source: aggregate`, o resolverlo antes y emitirlo con `source: param` |
| `auth-context` | ⚠️ **PROHIBIDO** (INT-025 — aborta el build) | — |

---

### `consumed` — eventos de otros BCs que este BC procesa

**Dos formas disponibles:**
- **Forma A (sin `command:`):** Solo declarar `name` + `sourceBc` + `description`. El generador localiza automáticamente el UC con `trigger.kind: event, consumes: {name}`. Preferida cuando hay UC formal.
- **Forma B (con `command: {UCName}`):** Binding explícito con `payload[]`. Para compensadores de saga, adaptadores legacy o cuando se necesita `queueKey`/`topicKey`/`filterExpr`.

Campos de cada evento consumido:

| Campo | Descripción |
|---|---|
| `name` | PascalCase en tiempo pasado. Nombre del evento tal como lo publica el BC emisor. Debe coincidir con el `name` en `contracts` de `system.yaml`. |
| `sourceBc` | kebab-case. BC que publica este evento. **Validado contra `system.yaml`** — INT-007 si no coincide. |
| `producer` | Opcional. Solo Javadoc en el listener. Útil si el publicador efectivo difiere del BC registrado en `system.yaml`. |
| `description` | Qué efecto produce este evento en este BC. |
| `command` | Solo Forma B. Nombre del UC handler. Activa el binding explícito. |
| `queueKey` | Solo Forma B. Override del routing-key RabbitMQ (default: derivado del nombre del evento). |
| `topicKey` | Solo Forma B. Override del topic Kafka (default: derivado del nombre del evento). |
| `filterExpr` | Solo Forma B. Expresión Java booleana — si `false`, el listener descarta el mensaje sin error. |
| `payload` | Solo Forma B. Campos que llegan con el evento. Deben reflejar el payload del BC emisor. |

```yaml
  consumed:

    # Evento con UC — el BC ejecuta lógica de dominio al recibirlo
    - name: StockUpdated
      sourceBc: inventory       # validado contra system.yaml — INT-007 si no coincide
      producer: inventory       # OPCIONAL — solo Javadoc. Útil si el publicador efectivo
                                # es distinto al BC registrado en system.yaml.
      description: >
        Updates the isAvailable flag on the CatalogProductSnapshot local read
        model when inventory reports a stock status change. Triggers UC-CAT-010.
      # ⚠️ NO declarar retry ni dlq — el generador los ignora con GEN-WARN.

    # ── Forma B (con `command:`) ──────────────────────────────────────────────
    # Binding explícito. Usar para compensadores de saga o cuando se necesita
    # routing/filter personalizado. Requiere `payload[]`.
    - name: OrderPlaced
      sourceBc: orders
      description: >
        Reserves stock for each line of the new order (saga step, no formal UC).
      command: ReserveStockForOrder   # ACTIVADOR Forma B — nombre del UC handler
      queueKey: orders.order.placed   # override del routing-key RabbitMQ
      # topicKey: orders.order.placed # alternativa para Kafka
      filterExpr: "payload.totalLines > 0"  # descarta pedidos sin líneas (expresión Java booleana)
      payload:
        - name: orderId
          type: Uuid
          required: true
        - name: lines
          type: List[OrderLineSnapshot]  # declarado en eventDtos[] de este BC
          required: true


```

---

### Forma A vs Forma B: cuándo usar cada una

| Criterio | Forma A (sin `command:`) | Forma B (con `command:`) |
|---|---|---|
| Hay UC formal con `trigger.kind: event` | ✅ Preferida | ❌ Innecesaria |
| Compensador de saga o handler sin UC formal | ❌ No aplica | ✅ Obligatoria |
| El routing-key/topic difiere de la convención estándar | ❌ No soportado | ✅ `queueKey`/`topicKey` |
| Filtrar mensajes según contenido del payload | ❌ No soportado | ✅ `filterExpr` |

> **`sourceBc` vs `producer`:** `sourceBc` es validado por el generador contra `system.yaml` (INT-007 si no coincide) — siempre declarar. `producer` es solo Javadoc en el listener — solo añadir cuando el publicador efectivo es diferente al BC registrado en `system.yaml`.

---

### Reglas del payload

1. **Siempre incluir `productId` (o el ID del agregado)** — el consumidor necesita saber de qué entidad habla el evento.
2. **NO declarar `eventId`, `eventType`, `eventVersion`, `occurredAt`, `sourceBc`, `correlationId` ni `causationId` en `payload[]`** — forman parte de `EventMetadata` y el generador los inyecta automáticamente como la primera sección de cada registro de evento. Declararlos produce conflicto (el generador los filtra con un WARN de deprecación). El consumidor accede a ellos vía `event.metadata().occurredAt()` etc.
3. **Incluir todos los datos que el consumidor necesita sin hacer lookups posteriores** — si el consumidor necesita consultar el BC publicador para completar el procesamiento, falta información en el payload.
4. **No incluir datos internos** — el payload es un contrato público. No exponer campos `internal: true` ni datos que no tengan sentido fuera del BC.
5. **Usar snapshots para valores que cambian** — si el precio de un producto puede cambiar, el evento `OrderPlaced` debe incluir `unitPrice` como snapshot, no solo `productId`.
6. **Tipos complejos en `payload[]` → declararlos en `eventDtos[]`** — si un campo del payload es un objeto compuesto (ej: `OrderLineSnapshot`, `ProductSnapshot`), declara ese tipo en `eventDtos[]` de este BC. El generador resuelve el import correctamente a `application.dtos.incoming`. **No declarar estos shapes externos en `valueObjects[]`** — contaminaría el modelo de dominio propio.

---

## Convenciones de nombres

| Elemento | Convención | Ejemplo |
|---|---|---|
| `bc` (valor) | kebab-case | `catalog`, `orders`, `payments` |
| Enum name | PascalCase + rol | `ProductStatus`, `OrderStatus` |
| Enum values | SCREAMING_SNAKE | `DRAFT`, `ACTIVE`, `PENDING_PAYMENT` |
| VO name | PascalCase + sustantivo | `Money`, `Slug`, `ShippingAddress` |
| Aggregate / Entity name | PascalCase + sustantivo | `Product`, `OrderLine` |
| Property name | camelCase | `categoryId`, `unitPrice` |
| Domain rule ID | `{ABREV}-RULE-{NNN}` | `PRD-RULE-001`, `ORD-RULE-003` |
| UC ID | `UC-{ABREV}-{NNN}` | `UC-PRD-004`, `UC-CAT-001` |
| Event name | PascalCase + pasado | `ProductActivated`, `OrderConfirmed` |
| Error code | SCREAMING_SNAKE | `PRODUCT_NOT_FOUND`, `ORDER_ALREADY_CONFIRMED` |

**Abreviaturas estándar:**

| BC | Abreviatura |
|---|---|
| `catalog` | `CAT` / `PRD` |
| `orders` | `ORD` |
| `inventory` | `INV` |
| `payments` | `PAY` |
| `customers` | `CUS` |
| `notifications` | `NOT` |
| `dispatch` | `DSP` |

---

## Relación con otros artefactos del Paso 2

| Artefacto | Relación con `{bc-name}.yaml` |
|---|---|
| `{bc-name}-open-api.yaml` | Los `useCases[trigger.operationId]` deben coincidir con los `operationId` del OpenAPI. |
| `{bc-name}-async-api.yaml` | Los eventos en `domainEvents.published` y `domainEvents.consumed` deben tener su canal en el AsyncAPI. |
| `{bc-name}-spec.md` | Narrativa de los mismos use cases, en prosa. |
| `{bc-name}-flows.md` | Los flujos Given/When/Then derivan de los `domainRules` y `useCases`. |
| `system.yaml` | `bc`, `type` y los eventos en `domainEvents` deben ser consistentes con `boundedContexts` e `integrations`. |

---

## Características avanzadas soportadas por el generador

Esta sección recoge el vocabulario extendido que el generador acepta hoy.
Todo lo aquí descrito es opcional: úsalo solo cuando aporte valor concreto al diseño.
Cualquier clave fuera de las whitelist que se documentan aquí será rechazada por el
generador.

### Aggregates

#### `concurrencyControl: optimistic`

```yaml
aggregates:
  - name: Order
    root: Order
    auditable: true
    concurrencyControl: optimistic   # único valor admitido
```

Activa control de concurrencia optimista (vector de versión persistido). Único valor
admitido es `optimistic` — declararlo solo cuando se necesite proteger contra updates
concurrentes (típico en agregados con muchas escrituras).

#### `softDelete: true`

```yaml
aggregates:
  - name: Product
    softDelete: true                 # inyecta deletedAt + filtra automáticamente
```

El generador inyecta `deletedAt` (nullable), filtra automáticamente todos los `findAll`
y `findById` por `deletedAt IS NULL`, y mapea el endpoint DELETE a `softDelete(id)`.
Para repositorios con métodos como `countByStatus`, declarar la versión soft-delete
mediante el qualifier:

```yaml
repositories:
  - aggregate: Product
    methods:
      - name: countNonDeletedByStatus
        softDelete: true             # excluye filas con deletedAt != null
```

#### `validations[]` — vocabulario soportado (whitelist)

Solo estas claves son procesadas. Cualquier otra es ignorada o produce error:

`notEmpty` · `minLength` · `pattern` · `min` · `max` · `positive`
· `positiveOrZero` · `negative` · `negativeOrZero` · `future` · `futureOrPresent`
· `past` · `pastOrPresent` · `minSize` · `maxSize`.

```yaml
- name: sku
  type: String(32)
  validations:
    - notEmpty: true
    - minLength: 3
    - pattern: "^[A-Z0-9-]+$"

- name: quantity
  type: Integer
  validations:
    - positive: true

- name: tags
  type: List[String]
  validations:
    - minSize: 1
    - maxSize: 10
```

`maxLength` no se declara explícitamente: ya está implícito en `String(n)`. Para semánticas
ya cubiertas por tipos canónicos (email, url) usar los tipos `Email`, `Url` (validan en
su constructor). Ver `references/validation.md` para la referencia completa del vocabulario.

**Validations en value objects propagan al agregado** que los usa como `type` —
no repetir las constraints en el agregado.

#### `domainRules[].type` — whitelist y campos requeridos

```yaml
domainRules:
  # Unicidad — opcional constraintName
  - id: PRD-001
    type: uniqueness
    field: sku
    errorCode: PRODUCT_SKU_DUPLICATED
    constraintName: idx_product_sku       # opcional, snake_case

  # Precondición de estado — la condición va en description, no en un campo "condition"
  - id: PRD-002
    type: statePrecondition
    description: A product can only be activated from DRAFT status.
    errorCode: PRODUCT_NOT_DRAFT

  # Estado terminal — el estado es implícito en el tipo; sin campo "state"
  - id: PRD-003
    type: terminalState
    description: A discontinued product cannot transition to any other status.
    errorCode: PRODUCT_DISCONTINUED

  # Side effect — sin error visible al cliente
  - id: PRD-004
    type: sideEffect
    description: Append entry to PriceHistory when price changes

  # Guard de borrado — requiere targetAggregate y targetRepositoryMethod
  - id: PRD-005
    type: deleteGuard
    targetAggregate: OrderLine
    targetRepositoryMethod: existsByProductId
    errorCode: PRODUCT_HAS_ORDERS

  # Constraint cruzado — requiere targetAggregate, field, expectedStatus
  - id: ORD-001
    type: crossAggregateConstraint
    targetAggregate: Product
    field: status
    expectedStatus: ACTIVE
    errorCode: PRODUCT_NOT_ACTIVE
```

#### Entidades hijas — `relationship` + `cardinality`

```yaml
entities:
  - name: ProductImage
    relationship: composition          # composition | aggregation
    cardinality: oneToMany             # oneToOne | oneToMany — manyToMany NO soportado
    properties:
      - name: id
        type: Uuid                      # IDs de entidades hijas: solo Uuid
```

`manyToMany` no es soportado. IDs de entidades hijas: solo `Uuid`.

---

### Domain events — capacidades extendidas

```yaml
domainEvents:
  published:
    - name: OrderConfirmed
      version: 1                            # entero ≥ 1, default 1
      scope: integration                    # internal | integration | both — default both
      payload:
        - { name: orderId, type: Uuid, source: aggregate, field: id }
        - { name: customerId, type: Uuid, source: aggregate, field: customerId }
        - { name: amount, type: Decimal, source: aggregate, field: total.amount }
        - { name: occurredOn, type: DateTime, source: timestamp }
        - { name: source, type: String, source: constant, value: "orders-bc" }
        - { name: triggeredBy, type: Uuid, source: aggregate, field: createdBy }
        # Si discount es un valor calculado, materializarlo primero en una propiedad
        # del agregado y publicarlo con source: aggregate, o resolverlo antes y
        # pasarlo al domainMethod para emitirlo con source: param.
      broker:
        partitionKey: customerId            # campo del payload usado como key
        headers:
          x-event-type: order.confirmed
        retry:
          maxAttempts: 5
          backoff: exponential              # fixed | exponential
          initialMs: 200
          maxMs: 5000
        dlq:
          afterAttempts: 5
          routingKey: orders.order.confirmed.dead    # routing key del DLX hacia la DLQ
          queueName: orders-confirmed-poison         # nombre físico de la DLQ (opcional; default = routingKey)

    - name: OrderConfirmedInternal
      scope: internal                       # solo se publica por bus interno (no broker)
      payload: [...]

    - name: ProductPriceChanged
      scope: both
      allowHiddenLeak: true                 # opt-in: permite que un campo hidden:true
                                            # del agregado aparezca en el payload de un
                                            # evento integration/both
      payload:
        - { name: oldPrice, type: Decimal, source: aggregate, field: priceCost }  # hidden

  consumed:
    - name: PaymentCaptured
      fromBc: payments
      channel: payments.payment.captured
      payload:
        - { name: paymentId, type: Uuid }
        - { name: amount, type: Money }
```

#### `payload[].source` — whitelist

| `source` | Campos auxiliares | Significado |
|---|---|---|
| `aggregate` | `field` | valor de una propiedad del agregado |
| `param` | `param` | parámetro de entrada del use case que emite el evento |
| `timestamp` | — | momento de emisión (timestamp del runtime destino) |
| `constant` | `value` | literal estático |
| `derived` | no soportado en payloads de eventos | materializar el valor como propiedad del agregado (`source: aggregate`) o resolverlo antes (`source: param`) |

> `source: auth-context` está prohibido en payloads de eventos (`INT-025`). Para publicar
> el actor autenticado, declarar una propiedad o input con `source: authContext` y emitirla
> desde el agregado con `source: aggregate` o pasarla al método de dominio como `source: param`.

#### `EventMetadata` canónica (NO declarar manualmente)

El generador inyecta automáticamente: `eventId`, `eventType`, `eventVersion`, `occurredAt`, `sourceBc`, `correlationId`, `causationId`. Declararlos manualmente en `payload[]` produce conflicto.

---

### Errors — schema extendido

```yaml
errors:
  # Caso simple — código + mensaje + status
  - code: PRODUCT_NOT_FOUND
    httpStatus: 404                          # whitelist (ver abajo)
    message: "Product not found"

  # Con plantilla parametrizada
  - code: PRICE_OUT_OF_RANGE
    httpStatus: 422
    messageTemplate: "Price {value} is out of allowed range [{min}, {max}]"
    args:
      - { name: value, type: Decimal }
      - { name: min, type: Decimal }
      - { name: max, type: Decimal }

  # Override de la clase de error generada
  - code: ORDER_INVALID_STATE
    httpStatus: 409
    message: "Order in invalid state"
    errorType: OrderInvalidStateError        # PascalCase, sufijo Error

  # Encadenamiento de causa
  - code: PAYMENT_GATEWAY_FAILED
    httpStatus: 503
    message: "Payment gateway unreachable"
    chainable: true                          # habilita envolver la causa original
    kind: infrastructure
    triggeredBy: payment.gateway.RetryableException  # identificador de clase de excepción del runtime destino — solo si kind: infrastructure

  # Relacionado con un domainRule de tipo uniqueness
  # (el constraintName va en domainRules[type: uniqueness], NO aquí)
  - code: PRODUCT_SKU_DUPLICATED
    httpStatus: 409
    message: "SKU already exists"

  # Manualmente lanzado (sin auto-mapeo desde domainRule)
  - code: CUSTOM_FAILURE
    httpStatus: 422
    message: "Custom failure"
    usedFor: manual                          # auto (default) | manual
```

#### `httpStatus` — whitelist

`400, 401, 402, 403, 404, 408, 409, 412, 415, 422, 423, 429, 503, 504`.

Cualquier valor fuera de esta lista es rechazado. Los nuevos statuses (402, 408, 412,
415, 423, 429, 503, 504) se mapean al manejador genérico de error de dominio del runtime
destino.

#### `kind` y `triggeredBy`

- `kind: business` (default) — error de regla de dominio.
- `kind: infrastructure` — error de capa técnica. Habilita `triggeredBy: <identificador
  de clase de excepción del runtime destino>` para documentar la causa raíz.
- `triggeredBy` solo es válido si `kind: infrastructure`.

---

### UseCases — capacidades extendidas

#### `returns` — whitelist

| Tipo de UC | `returns` válidos |
|---|---|
| Command | `Void`, `Optional[X]`, `<VO>`, `<projection>` |
| Query | `{AggregateName}Response`, `<projection>`, `Page[{AggregateName}Response]`, `Page[<projection>]`, `Slice[X]`, `List[X]`, `BinaryStream` |

> **⚠ Convención obligatoria:** para retornar el DTO del agregado completo en una query,
> usar siempre **`{AggregateName}Response`** (ej: `CategoryResponse`, `ProductResponse`).
> El generador mapea `{AggregateName}Response` → `{AggregateName}ResponseDto`.
> Escribir el nombre del agregado a secas (ej: `Category`) genera un import a una clase
> `dtos.Category` que no existe → error de compilación en el proyecto destino.

#### `validations[]` — pre-condiciones declarativas

```yaml
useCases:
  - name: confirmOrder
    type: command
    validations:
      - id: VAL-001
        expression: "el total del pedido debe ser mayor que cero"
        errorCode: ORDER_AMOUNT_INVALID
        description: "Rechazar pedidos con importe cero o negativo"
```

Cada validación se traduce a un `// TODO` en el handler, que Fase 3 implementa en Java.
`expression` es **siempre lenguaje natural** — nunca escribir código Java aquí.
Ver criterios de cuándo añadir `validations[]` en `references/use-cases-design-decisions.md §3`.

#### `lookups[]` — resolución de entidades antes de ejecutar

```yaml
lookups:
  - param: orderId
    aggregate: Order
    errorCode: ORDER_NOT_FOUND
  - param: lineId
    nestedIn: Order.lines               # entidad hija
    errorCode: ORDER_LINE_NOT_FOUND
```

**Mutuamente excluyente con `notFoundError`** — usar `lookups[]` cuando hay más de un
agregado a cargar o cuando los errores son distintos por agregado. Los `input[]` de un
UC con `lookups[]` **no llevan** `loadAggregate: true` — los lookups son el mecanismo
de carga. Ver criterios completos en `references/use-cases-design-decisions.md §1`.

#### `input[]` — campos extendidos

```yaml
input:
  - name: limit
    type: Integer
    default: 50                          # valor por defecto si null
    max: 100                             # cap superior
  - name: tenantId
    type: String
    source: header                       # body (default) | query | path | header | multipart
    headerName: X-Tenant-Id
```

#### `pagination` (queries)

```yaml
pagination:
  defaultSize: 20
  maxSize: 100
  sortable:
    - createdAt
    - total
  defaultSort:
    field: createdAt
    direction: DESC                      # ASC | DESC
```

#### `fkValidations[].bc` — validación cross-BC

```yaml
fkValidations:
  - field: customerId
    bc: customers                        # BC externo sin LRM → genera {Bc}ServicePort
    aggregate: Customer
    errorCode: CUSTOMER_NOT_FOUND
```

El generador elige el mecanismo según el contexto:
- **Sin `bc`** (o mismo BC) → `repo.findById().isEmpty()` inline.
- **`bc` externo + LRM local** (`aggregate` declarado con `readModel: true` en este BC) → repositorio del LRM.
- **`bc` externo sin LRM** → genera `CustomersServicePort.java` con `existsCustomer(UUID)`.

En cualquier caso cross-BC, **exige** entrada en `integrations.outbound[]` para ese BC.
Ver tabla de decisión completa en `references/use-cases-design-decisions.md §2`.

#### `idempotency` (commands HTTP)

Este bloque solo aplica a commands con `trigger.kind: http`. No declararlo en UCs
disparados por eventos (`trigger.kind: event`), ni siquiera usando `header: eventId`:
la idempotencia de mensajes se configura en `system.yaml` con
`infrastructure.reliability.consumerIdempotency: true`.

```yaml
idempotency:
  header: Idempotency-Key
  ttl: PT24H                             # ISO-8601 duration
  storage: cache                         # ÚNICO valor válido — database y redis están deprecados
```

#### `authorization`

```yaml
authorization:
  rolesAnyOf: [ADMIN, MANAGER]
  ownership:
    field: customerId                    # campo del agregado/comando
    claim: sub                           # claim del JWT
    allowRoleBypass:                     # lista de roles que pueden saltarse el ownership check
      - ROLE_ADMIN
```

#### Multi-aggregate — `aggregates[]` + `steps[]`

**Restricción:** solo válido cuando **todos los agregados viven en este BC** (misma DB,
misma transacción `@Transactional`). Para operaciones que involucran BCs distintos,
usar Saga en `system.yaml`.

```yaml
aggregates: [Order, Invoice]
steps:
  - aggregate: Order
    method: confirm
  - aggregate: Invoice
    method: emit
    onFailure:
      compensate: Order.revertConfirmation
```

Ver criterios detallados en `references/use-cases-design-decisions.md §6`.

#### `bulk` — operaciones en lote

```yaml
bulk:
  itemType: ConfirmOrderItem
  maxItems: 1000
  onItemError: continue                  # continue | abort
```

#### `async` — ejecución asíncrona

```yaml
async:
  mode: jobTracking                      # jobTracking | fireAndForget
  statusEndpoint: /api/orders/jobs/{jobId}
```

#### Multipart (subida de ficheros)

```yaml
input:
  - name: invoice
    type: File
    source: multipart
    partName: invoice
    maxSize: "5MB"                 # string con unidad B|KB|MB|GB — NUNCA bytes crudos (5242880 → BC-024)
    contentTypes: [application/pdf, image/png]
```

#### `Range[T]` y `SearchText`

```yaml
input:
  - name: priceRange
    type: Range[Decimal]                 # genera priceFrom + priceTo
  - name: query
    type: SearchText
    fields: [name, description, sku]     # multi-columna LIKE_CONTAINS
```

#### `trigger.kind: event`

```yaml
trigger:
  kind: event                            # http (default) | event
  consumes: PaymentCaptured
  fromBc: payments
  filter: "amount > 1000"  # opcional
```

---

### Repositories — capacidades extendidas

#### `operator` por param — whitelist

`EQ` (default) · `LIKE_CONTAINS` · `LIKE_STARTS` · `LIKE_ENDS` · `GTE` · `LTE` · `IN`.

```yaml
methods:
  - name: searchProducts
    params:
      - { name: query, type: String, required: false, filterOn: [name, sku] }       # ⇒ LIKE_CONTAINS
      - { name: priceFrom, type: Decimal, required: false, operator: GTE }
      - { name: priceTo, type: Decimal, required: false, operator: LTE }
      - { name: statuses, type: List[ProductStatus], required: false, operator: IN }
    returns: Page[Product]
```

Sin `operator` declarado: `filterOn` ⇒ `LIKE_CONTAINS`; resto ⇒ `EQ`.

#### `returns` — whitelist

`void` · `Boolean` · `Int` · `Long` · `T` · `T?` · `List[T]` · `Page[T]` · `Slice[T]` · `Stream[T]`.

#### `derivedFrom`

```yaml
- name: findBySku
  derivedFrom: domainRule:PRD-001         # uniqueness rule
- name: validateProductsAndPrices
  derivedFrom: openapi:validateProductsAndPrices
- name: findByName
  derivedFrom: implicit                   # auto-derivado por análisis del UC
```

#### Phase 3 opt-ins

```yaml
- { name: existsBySku, returns: Boolean }
- { name: deleteByStatus, returns: Long, transactional: true }
- name: bulkActivate
  bulkOperations: true
- name: findByIdForUpdate                 # SELECT ... FOR UPDATE
```

#### Soft-delete qualifier

```yaml
- name: countNonDeletedByStatus
  softDelete: true                        # excluye deletedAt != null
```

#### Read models — restricción

Repositorio con `readModel: true` solo admite `findById`, `findBy{unique}`, `upsert`.
**Nunca `save` ni `delete`**.

#### `autoDerive: false`

Opt-out de la generación automática de `findBy*` desde `domainRules` de tipo
`uniqueness`. Útil si el repositorio se gestiona manualmente.

---

### Projections

#### Whitelist de claves de propiedad

`name`, `type`, `required`, `description`, `example`, `serializedName`, `derivedFrom`.

#### Sufijos prohibidos

`Dto`, `Response`, `Request`, `Payload` no se permiten en `projections[].name`.

#### Tipos canónicos extendidos

`Date`, `Duration`, `BigInt`, `Json` admitidos además de los habituales.

#### Restricciones

- Aggregates **no** pueden usarse como `type` en projections (usar `Uuid` con composición).
- Projections vacías (`properties: []`) no son válidas.
- Inline `returns:` en un UC sintetiza automáticamente `${UC}Result`.
- `source: aggregate:<Name>` o `source: readModel:<Name>` (opcional) traza la
  procedencia.

#### Persistent projections (Local Read Model)

```yaml
projections:
  - name: ProductSummary
    persistent: true
    source:
      kind: event
      event: ProductActivated
      from: catalog
    keyBy: productId
    upsertStrategy: lastWriteWins         # lastWriteWins | versionGuarded
    properties:
      - { name: productId, type: Uuid }
      - { name: name, type: String }
      - { name: priceAmount, type: Decimal }
```

Genera una proyección persistida (LRM) actualizada por consumo de eventos. Útil para
cachear datos de otros BCs sin acoplamiento síncrono.

---

### Integrations — auth y resilience por integración

> **Regla de diseño:** los campos `auth` y `resilience` en `outbound[]` son de uso
> **exclusivamente manual**. Solo deben declararse en `{bc}.yaml` cuando la integración
> correspondiente en `system.yaml` **no** tiene configuración de `auth`/`resilience`.
> Si `system.yaml integrations[from={este-bc}, to={target}]` ya declara `auth` o
> `resilience`, deja esos campos **ausentes** en `{bc}.yaml` — el generador los toma
> directamente del `system.yaml`. Declarar ambos no produce error, pero introduce
> duplicación innecesaria y hace que el artefacto estratégico deje de ser la fuente
> de verdad.

**¿Cuándo declarar en `{bc}.yaml`?**

| Situación | Acción |
|---|---|
| `system.yaml` ya tiene `resilience`/`auth` para esta integración | Omitir los campos en `{bc}.yaml` |
| `system.yaml` tiene la entrada de integración pero **sin** `resilience`/`auth` | Declarar en `{bc}.yaml` como configuración manual específica del BC |
| La integración existe solo en `{bc}.yaml outbound` y no tiene entrada en `system.yaml` | No permitido — INT-006 falla (la entrada debe existir en `system.yaml`) |

```yaml
integrations:
  outbound:
    # ✅ CORRECTO: system.yaml no declara auth/resilience para esta integración específica
    #    → se declara manualmente en bc.yaml
    - name: payments
      auth:
        type: bearer                      # none | api-key | bearer | oauth2-cc | mTLS | internal-jwt
        valueProperty: integration.payments.token  # clave de la property Spring con el token
        # header: solo para api-key (default X-Api-Key) — no aplica a bearer
      resilience:
        circuitBreaker:                   # presencia del objeto → @CircuitBreaker(name="payments")
          failureRateThreshold: 50        # % de fallos para abrir el circuito (1–100)
          waitDurationInOpenState: 30s    # string con unidad: "30s", "60s"
          slidingWindowSize: 20
          minimumNumberOfCalls: 10
          permittedNumberOfCallsInHalfOpenState: 3
        retries:                          # PLURAL — maxAttempts > 1 → @Retry(name="payments")
          maxAttempts: 3                  # debe ser > 1 para activar @Retry
          waitDuration: 500ms             # string con unidad: "500ms", "1s"
        connectTimeoutMs: 3000            # timeout de conexión TCP en ms (campo plano)
        timeoutMs: 10000                  # timeout de lectura en ms (campo plano)

    # ✅ CORRECTO: system.yaml tampoco declara auth/resilience para payment-gateway
    - name: payment-gateway
      auth:
        type: oauth2-cc
        tokenEndpoint: https://idp.example.com/oauth2/token
        credentialKey: payment-gateway    # identificador de credencial registrada en el runtime destino
      resilience:
        circuitBreaker:
          failureRateThreshold: 30
          waitDurationInOpenState: 60s
        retries:
          maxAttempts: 5
          waitDuration: 1000ms
        connectTimeoutMs: 5000
        timeoutMs: 30000                  # default externo: 30000 ms

    # ❌ INCORRECTO: system.yaml ya tiene resilience para esta integración
    #    → omitir auth y resilience aquí
    # - name: catalog
    #   resilience:    ← NO — ya está en system.yaml
    #     circuitBreaker: ...
```

**Efecto en el generador (Resilience4j):**

| Campo declarado | Artefacto generado |
|---|---|
| `circuitBreaker` (objeto) | `@CircuitBreaker(name="{name}")` en cada método del adaptador + método `{op}Fallback` con `// TODO` |
| `retries.maxAttempts > 1` | `@Retry(name="{name}")` en cada método del adaptador. **La clave es `retries` en plural.** |
| Sub-campos de `circuitBreaker` / `retries` | Bloque `instances.{name}` en `resilience.yaml` (por entorno) con `baseConfig: default` + campos declarados |
| `connectTimeoutMs` | `Request.Options` connect timeout en `{Name}FeignConfig.java` (default: 5000 ms) |
| `timeoutMs` | `Request.Options` read timeout en `{Name}FeignConfig.java` (default: 15000 ms BC→BC, 30000 ms externo) |

> Si se declara `circuitBreaker: {}` (sin sub-campos), la anotación se genera igual pero
> no se crea bloque `instances` en `resilience.yaml` — la instancia hereda `configs.default`.

**INT-015 (validador bloqueante):** `auth.type: oauth2-cc` requiere `tokenEndpoint`
+ `credentialKey`.

**Precedencia del generador:** `bc.yaml outbound[].resilience/auth` sustituye completamente
(no fusiona) el bloque equivalente en `system.yaml`. Por esta razón, si se usa el override
en `bc.yaml`, debe declararse el bloque completo que se desea — los sub-campos ausentes
no heredan del `system.yaml`.

External systems referenciados deben existir en `system.yaml.externalSystems[]` con
`operations[]` declaradas (INT-008 / INT-009).

