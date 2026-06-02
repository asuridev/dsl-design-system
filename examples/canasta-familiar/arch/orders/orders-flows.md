# Orders BC — Flujos de Validación (Given / When / Then)

> **Bounded Context:** orders | **Paso 2 — Diseño Táctico** | Fecha: 2026-05-15  
> Prefijo de flujos: `FL-ORD-{NNN}`

---

## Matriz de Cobertura UC → Flujo

| UC | Nombre | Impl | Flujo(s) |
|----|--------|------|----------|
| UC-ORD-001 | CreateCart | full | FL-ORD-001, FL-ORD-002 |
| UC-ORD-002 | AddItemToCart | scaffold | FL-ORD-003, FL-ORD-004, FL-ORD-005 |
| UC-ORD-003 | UpdateCartItem | full | FL-ORD-006, FL-ORD-007 |
| UC-ORD-004 | RemoveCartItem | full | FL-ORD-008 |
| UC-ORD-005 | Checkout | scaffold | FL-ORD-009, FL-ORD-010, FL-ORD-011, FL-ORD-012 |
| UC-ORD-006 | GetCart | full | FL-ORD-013 |
| UC-ORD-010 | GetOrder | full | FL-ORD-014 |
| UC-ORD-011 | ListOrders | scaffold | FL-ORD-015, FL-ORD-016 |
| UC-ORD-012 | CancelOrder | scaffold | FL-ORD-017, FL-ORD-018, FL-ORD-019 |
| UC-ORD-020 | ConfirmOrder | scaffold | FL-ORD-020, FL-ORD-021 |
| UC-ORD-021 | CancelOrderOnStockFailed | scaffold | FL-ORD-022, FL-ORD-023 |
| UC-ORD-022 | CancelOrderOnPaymentFailed | scaffold | FL-ORD-024 |
| UC-ORD-023 | SetOrderInDelivery | scaffold | FL-ORD-025, FL-ORD-026 |
| UC-ORD-024 | CompleteDelivery | scaffold | FL-ORD-027, FL-ORD-028 |
| UC-ORD-025 | AcknowledgeStockReleased | scaffold | FL-ORD-029 |
| UC-ORD-026 | AcknowledgePaymentRefunded | scaffold | FL-ORD-030 |
| UC-ORD-030 | SyncCustomerAddress | full | FL-ORD-031, FL-ORD-032 |

---

## Cart Management

---

### FL-ORD-001: CreateCart — happy path

**Given**:
- El cliente con `customerId = "c1"` no tiene ningún carrito OPEN.

**When**:
- `POST /api/orders/v1/carts` con:
  ```json
  { "paymentMethod": "CARD" }
  ```
  Header `Authorization: Bearer {token con sub=c1}`.

**Then**:
- HTTP `201 Created`
- Header `Location: /api/orders/v1/carts/{newCartId}`
- El carrito existe en BD con `status = OPEN`, `customerId = c1`, `paymentMethod = CARD`.
- El carrito no tiene ítems.
- `GET /carts/{newCartId}` retorna el carrito recién creado.

**Casos borde**:
- `paymentMethod` con valor inválido → `400 Bad Request`.
- Request duplicado con mismo `Idempotency-Key` → `201` con misma `Location` (no se crea duplicado).

---

### FL-ORD-002: CreateCart — cliente ya tiene carrito OPEN

**Given**:
- El cliente ya tiene un carrito `{existingCartId}` con `status = OPEN`.

**When**:
- `POST /api/orders/v1/carts` con `{ "paymentMethod": "CASH_ON_DELIVERY" }`.

**Then**:
- HTTP `409 Conflict`
- Body: `{ "code": "CUSTOMER_ALREADY_HAS_OPEN_CART" }`
- No se crea ningún carrito nuevo.

---

### FL-ORD-003: AddItemToCart — happy path (producto nuevo)

**Given**:
- Existe un carrito `{cartId}` con `status = OPEN` para el cliente autenticado.
- El carrito no tiene ítems con `productId = "prod-123"`.

**When**:
- `POST /api/orders/v1/carts/{cartId}/items` con:
  ```json
  { "productId": "prod-123", "quantity": 2 }
  ```

**Then**:
- HTTP `201 Created`
- Header `Location: /api/orders/v1/carts/{cartId}/items/{newItemId}`
- El carrito tiene un nuevo ítem con `productId = prod-123` y `quantity = 2`.

---

### FL-ORD-004: AddItemToCart — producto ya existe en carrito (incremento de cantidad)

**Given**:
- Existe un carrito OPEN con un ítem `productId = "prod-123"`, `quantity = 2`.

**When**:
- `POST /api/orders/v1/carts/{cartId}/items` con:
  ```json
  { "productId": "prod-123", "quantity": 3 }
  ```

**Then**:
- HTTP `201 Created`
- El ítem existente tiene ahora `quantity = 5` (2 + 3).
- No se crea un ítem duplicado para el mismo productId.

**DECISIÓN-001 (scaffold):** El handler debe verificar si ya existe un CartItem con el mismo
`productId` en el carrito antes de llamar a `addItem()`. Si existe, incrementar la cantidad.

---

### FL-ORD-005: AddItemToCart — carrito no OPEN (CHECKED_OUT)

**Given**:
- Existe un carrito con `status = CHECKED_OUT`.

**When**:
- `POST /api/orders/v1/carts/{cartId}/items` con `{ "productId": "prod-456", "quantity": 1 }`.

**Then**:
- HTTP `422 Unprocessable Entity`
- Body: `{ "code": "CART_NOT_OPEN" }`

---

### FL-ORD-006: UpdateCartItem — happy path

**Given**:
- Existe un carrito OPEN con ítem `{itemId}` con `quantity = 2`.

**When**:
- `PATCH /api/orders/v1/carts/{cartId}/items/{itemId}` con:
  ```json
  { "quantity": 5 }
  ```

**Then**:
- HTTP `204 No Content`
- El ítem tiene ahora `quantity = 5`.

---

### FL-ORD-007: UpdateCartItem — ítem no existe en el carrito

**Given**:
- Existe un carrito OPEN, pero `{unknownItemId}` no pertenece a este carrito.

**When**:
- `PATCH /api/orders/v1/carts/{cartId}/items/{unknownItemId}` con `{ "quantity": 3 }`.

**Then**:
- HTTP `404 Not Found`
- Body: `{ "code": "CART_ITEM_NOT_FOUND" }`

---

### FL-ORD-008: RemoveCartItem — happy path

**Given**:
- Existe un carrito OPEN con ítem `{itemId}`.

**When**:
- `DELETE /api/orders/v1/carts/{cartId}/items/{itemId}`

**Then**:
- HTTP `204 No Content`
- El ítem ya no existe en el carrito.

---

## Checkout

---

### FL-ORD-009: Checkout — happy path (pago con tarjeta)

**Given**:
- Carrito OPEN con 2 ítems: `{ productId: "p1", quantity: 2 }`, `{ productId: "p2", quantity: 1 }`.
- CustomerAddress con `addressId = "addr-1"`, `deleted = false`, del cliente autenticado.
- Catalog devuelve: `p1 = ACTIVE, price = 15000 COP`; `p2 = ACTIVE, price = 8500 COP`.

**When**:
- `POST /api/orders/v1/carts/{cartId}/checkout` con:
  ```json
  { "deliveryAddressId": "addr-1" }
  ```

**Then**:
- HTTP `201 Created`
- Header `Location: /api/orders/v1/orders/{newOrderId}`
- El carrito transiciona a `CHECKED_OUT`.
- Se crea una `Order` con `status = PENDING_PAYMENT`:
  - `paymentMethod = CARD`
  - `total = { amount: 38500, currency: COP }` (2×15000 + 1×8500)
  - `deliveryAddress` = snapshot de la dirección addr-1
  - 2 `OrderLine`: precios congelados del catálogo.
- Se emite `OrderPlaced` al outbox con las líneas y el total.

---

### FL-ORD-010: Checkout — carrito vacío

**Given**:
- Carrito OPEN sin ítems.

**When**:
- `POST /api/orders/v1/carts/{cartId}/checkout` con `{ "deliveryAddressId": "addr-1" }`.

**Then**:
- HTTP `422 Unprocessable Entity`
- Body: `{ "code": "CART_IS_EMPTY" }`

---

### FL-ORD-011: Checkout — dirección de entrega no encontrada

**Given**:
- Carrito OPEN con ítems.
- `deliveryAddressId = "addr-deleted"` existe en CustomerAddress pero `deleted = true`.

**When**:
- `POST /api/orders/v1/carts/{cartId}/checkout` con `{ "deliveryAddressId": "addr-deleted" }`.

**Then**:
- HTTP `404 Not Found`
- Body: `{ "code": "DELIVERY_ADDRESS_NOT_FOUND" }`
- No se crea ningún pedido. Carrito permanece OPEN.

---

### FL-ORD-012: Checkout — producto no disponible en catálogo

**Given**:
- Carrito OPEN con ítems: `{ productId: "p1", quantity: 1 }`.
- Catalog devuelve: `p1 = DISCONTINUED` (no ACTIVE).

**When**:
- `POST /api/orders/v1/carts/{cartId}/checkout` con dirección válida.

**Then**:
- HTTP `422 Unprocessable Entity`
- Body: `{ "code": "PRODUCT_PRICE_UNAVAILABLE" }`
- No se crea ningún pedido. Carrito permanece OPEN.

---

### FL-ORD-013: GetCart — happy path

**Given**:
- Existe un carrito OPEN con 3 ítems.

**When**:
- `GET /api/orders/v1/carts/{cartId}`

**Then**:
- HTTP `200 OK`
- Body contiene el carrito con todos los ítems (id, productId, quantity).

---

## Orders

---

### FL-ORD-014: GetOrder — happy path

**Given**:
- Existe un `Order` con `status = CONFIRMED` y 2 OrderLines.

**When**:
- `GET /api/orders/v1/orders/{orderId}` (cliente propietario o admin).

**Then**:
- HTTP `200 OK`
- Body contiene `OrderDetail`: id, customerId, status, paymentMethod, total, deliveryAddress, lines, createdAt, updatedAt.

---

### FL-ORD-015: ListOrders — customer filtra sus pedidos

**Given**:
- El cliente tiene 3 pedidos: 2 CONFIRMED, 1 CANCELLED.

**When**:
- `GET /api/orders/v1/orders?status=CONFIRMED`
  Header `Authorization: Bearer {token del cliente}`.

**Then**:
- HTTP `200 OK`
- Body: página con 2 `OrderSummary` en estado CONFIRMED (solo los del cliente autenticado).

**DECISIÓN-002 (scaffold):** El handler debe ignorar el query param `customerId` si el actor
es ROLE_CUSTOMER e inyectar siempre `customerId = JWT.sub`.

---

### FL-ORD-016: ListOrders — admin lista todos los pedidos de un cliente

**Given**:
- El cliente `c2` tiene 5 pedidos.

**When**:
- `GET /api/orders/v1/orders?customerId=c2` con token de ROLE_ADMIN.

**Then**:
- HTTP `200 OK`
- Body: página con los 5 pedidos del cliente c2.

---

### FL-ORD-017: CancelOrder — happy path (customer cancela pedido PENDING_PAYMENT)

**Given**:
- Existe `Order` `{orderId}` con `status = PENDING_PAYMENT` del cliente autenticado.

**When**:
- `PATCH /api/orders/v1/orders/{orderId}/cancel`

**Then**:
- HTTP `204 No Content`
- El pedido transiciona a `status = CANCELLED`.
- Se emite `OrderCancelled` al outbox.

---

### FL-ORD-018: CancelOrder — pedido ya DELIVERED (terminal state)

**Given**:
- Existe `Order` `{orderId}` con `status = DELIVERED`.

**When**:
- `PATCH /api/orders/v1/orders/{orderId}/cancel`

**Then**:
- HTTP `409 Conflict`
- Body: `{ "code": "ORDER_ALREADY_DELIVERED" }`

---

### FL-ORD-019: CancelOrder — pedido IN_DELIVERY (no cancelable)

**Given**:
- Existe `Order` `{orderId}` con `status = IN_DELIVERY`.

**When**:
- `PATCH /api/orders/v1/orders/{orderId}/cancel`

**Then**:
- HTTP `422 Unprocessable Entity`
- Body: `{ "code": "ORDER_CANNOT_BE_CANCELLED" }`

---

## Saga Event Handlers

---

### FL-ORD-020: ConfirmOrder — happy path (PaymentApproved)

**Given**:
- Existe `Order` `{orderId}` con `status = PENDING_PAYMENT`.

**When**:
- Llega evento `PaymentApproved` con `orderId`.

**Then**:
- El handler procesa el evento idempotentemente.
- El pedido transiciona a `status = CONFIRMED`.
- Se emite `OrderConfirmed` al outbox.

**DECISIÓN-003 (scaffold):** Verificar ORD-RULE-008 antes de llamar `order.confirm()`.
Si el pedido no está en PENDING_PAYMENT (ya fue confirmado — redelivery idempotente),
loggear warn y marcar el evento como procesado sin lanzar excepción.

---

### FL-ORD-021: ConfirmOrder — evento duplicado (idempotencia)

**Given**:
- `Order` `{orderId}` ya está en `status = CONFIRMED` (evento fue procesado antes).

**When**:
- Llega nuevamente `PaymentApproved` con mismo `orderId` (redelivery del broker).

**Then**:
- El `consumerIdempotency` detecta el evento como ya procesado.
- No se emite `OrderConfirmed` duplicado.
- HTTP 200 si el broker recibe ACK correcto.

---

### FL-ORD-022: CancelOrderOnStockFailed — happy path

**Given**:
- Existe `Order` `{orderId}` con `status = PENDING_PAYMENT`.

**When**:
- Llega evento `StockReservationFailed` con `orderId`.

**Then**:
- El pedido transiciona a `status = CANCELLED`.
- Se emite `OrderCancelled` al outbox.

---

### FL-ORD-023: CancelOrderOnStockFailed — pedido ya CANCELLED (idempotencia)

**Given**:
- `Order` `{orderId}` ya está en `status = CANCELLED`.

**When**:
- Llega `StockReservationFailed` de nuevo (redelivery).

**Then**:
- `consumerIdempotency` o guard ORD-RULE-007 detectan el estado terminal.
- No se emite `OrderCancelled` duplicado. Evento procesado silenciosamente.

---

### FL-ORD-024: CancelOrderOnPaymentFailed — happy path

**Given**:
- Existe `Order` `{orderId}` con `status = PENDING_PAYMENT`.

**When**:
- Llega evento `PaymentFailed` con `orderId`.

**Then**:
- El pedido transiciona a `status = CANCELLED`.
- Se emite `OrderCancelled` al outbox (triggers refund check in payments if CARD).

---

### FL-ORD-025: SetOrderInDelivery — happy path

**Given**:
- Existe `Order` `{orderId}` con `status = CONFIRMED`.

**When**:
- Llega evento `DeliveryOrderCreated` con `orderId`.

**Then**:
- El pedido transiciona a `status = IN_DELIVERY`.
- No se emite ningún evento adicional desde orders.

---

### FL-ORD-026: SetOrderInDelivery — pedido no CONFIRMED (idempotencia)

**Given**:
- `Order` `{orderId}` ya está en `status = IN_DELIVERY` (evento fue procesado antes).

**When**:
- Llega `DeliveryOrderCreated` de nuevo (redelivery).

**Then**:
- `consumerIdempotency` o guard ORD-RULE-009 detectan el estado incorrecto.
- Evento procesado silenciosamente sin cambio de estado.

---

### FL-ORD-027: CompleteDelivery — happy path

**Given**:
- Existe `Order` `{orderId}` con `status = IN_DELIVERY`.

**When**:
- Llega evento `DeliveryCompleted` con `orderId`.

**Then**:
- El pedido transiciona a `status = DELIVERED`.
- El estado es terminal.

---

### FL-ORD-028: CompleteDelivery — pedido no IN_DELIVERY (idempotencia)

**Given**:
- `Order` `{orderId}` ya está en `status = DELIVERED`.

**When**:
- Llega `DeliveryCompleted` de nuevo (redelivery).

**Then**:
- `consumerIdempotency` o guard ORD-RULE-010 manejan el redelivery.
- No hay cambio de estado. Evento procesado silenciosamente.

---

### FL-ORD-029: AcknowledgeStockReleased — acuse de recibo de compensación

**Given**:
- Existe `Order` `{orderId}` con `status = CANCELLED` (ya cancelado por PaymentFailed).
- El BC `inventory` ha liberado el stock y emite `StockReleased`.

**When**:
- Llega evento `StockReleased` con `orderId` y `reservationId`.

**Then**:
- El handler carga el pedido (para log de auditoría).
- El estado del pedido no cambia (ya es CANCELLED).
- El evento queda marcado como procesado.
- No se emite ningún evento nuevo.

---

### FL-ORD-030: AcknowledgePaymentRefunded — acuse de recibo de reembolso

**Given**:
- Existe `Order` `{orderId}` con `status = CANCELLED` (cancelado después de PaymentApproved — admin cancel o customer cancel de CONFIRMED).
- El BC `payments` ha procesado el reembolso de tarjeta.

**When**:
- Llega evento `PaymentRefunded` con `orderId` y `refundId`.

**Then**:
- El handler carga el pedido (para log de auditoría).
- El estado del pedido no cambia (ya es CANCELLED).
- El evento queda marcado como procesado.

---

## CustomerAddress Sync

---

### FL-ORD-031: SyncCustomerAddress — nueva dirección (INSERT)

**Given**:
- No existe ningún `CustomerAddress` con `addressId = "addr-new"` en el LRM.

**When**:
- Llega evento `CustomerAddressUpdated` con:
  ```json
  {
    "addressId": "addr-new",
    "customerId": "c1",
    "street": "Calle 123 #45-67",
    "city": "Bogotá",
    "postalCode": "110111",
    "reference": "Apto 301",
    "deleted": false
  }
  ```

**Then**:
- Se inserta un nuevo `CustomerAddress` con todos los campos.
- `deleted = false`.
- El evento queda marcado como procesado.

---

### FL-ORD-032: SyncCustomerAddress — dirección eliminada (soft-delete)

**Given**:
- Existe `CustomerAddress` con `addressId = "addr-old"`, `deleted = false`.

**When**:
- Llega evento `CustomerAddressUpdated` con `addressId = "addr-old"`, `deleted = true`.

**Then**:
- El registro `CustomerAddress` se actualiza: `deleted = true`.
- Desde este momento, el checkout rechazará `deliveryAddressId = "addr-old"` con
  `DELIVERY_ADDRESS_NOT_FOUND`.
