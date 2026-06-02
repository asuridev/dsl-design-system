# Orders BC — Specification

> **Bounded Context:** orders | **Paso 2 — Diseño Táctico** | Fecha: 2026-05-15

---

## 1. Propósito y Responsabilidades

El BC `orders` gestiona el ciclo de vida completo de los pedidos en Canasta Familiar:
desde la creación del carrito de compras hasta la entrega a domicilio.

### Responsabilidades Propias
- Crear y gestionar carritos de compras (agregar, actualizar y eliminar ítems).
- Ejecutar el checkout: validar precios contra `catalog` (HTTP síncrono para snapshot monetario — OWASP A04), crear la `Order` con precios congelados y emitir `OrderPlaced` para disparar el `CheckoutSaga`.
- Confirmar, cancelar o actualizar el estado de pedidos en respuesta a eventos de la saga (`PaymentApproved`, `StockReservationFailed`, `PaymentFailed`, `DeliveryOrderCreated`, `DeliveryCompleted`).
- Mantener un **Local Read Model** de direcciones de entrega (`CustomerAddress`) sincronizado por eventos `CustomerAddressUpdated` del BC `customers`.

### No-Responsabilidades (explícitas)
- No gestiona stock ni disponibilidad de productos — responsabilidad de `inventory`.
- No procesa pagos ni refunds — responsabilidad de `payments`.
- No asigna repartidores ni gestiona rutas de entrega — responsabilidad de `delivery`.
- No envía notificaciones al cliente — responsabilidad de `notifications`.
- No mantiene el catálogo de precios — responsabilidad de `catalog`.
- No gestiona cuentas de clientes ni el catálogo de direcciones como fuente de verdad — responsabilidad de `customers`.

---

## 2. Actores y Niveles de Acceso

| Actor | Acceso |
|-------|--------|
| `customer` | Gestiona su propio carrito; consulta y cancela sus propios pedidos. |
| `admin` | Consulta cualquier pedido; puede cancelar cualquier pedido (bypass de ownership). |
| `system` | Procesa eventos de saga (PaymentApproved, StockReservationFailed, etc.) y sincroniza el LRM de direcciones. |

---

## 3. Modelo de Dominio

### Agregado `Cart`
Representa el carrito activo de un cliente. Un cliente solo puede tener **un carrito OPEN** a la vez. Una vez hecho checkout, el carrito transiciona a `CHECKED_OUT` (estado terminal). El pago se selecciona al crear el carrito.

**Entidad `CartItem`:** Línea de producto en el carrito con productId y quantity. Existe solo dentro del agregado Cart.

**Invariante central:** Un cliente no puede iniciar un nuevo checkout hasta que el anterior carrito esté en estado CHECKED_OUT.

### Agregado `Order`
Pedido confirmado con precios congelados (snapshot). Creado a partir de un Cart al hacer checkout. Contiene las `OrderLine` como entidades inmutables (precio congelado del catálogo al momento de compra). El `customerId` se inyecta desde el JWT — el cliente nunca lo envía.

**Entidad `OrderLine`:** Línea de pedido inmutable con snapshot de producto: `productName`, `unitPrice`, `quantity`, `subtotal`. No se puede modificar después de la creación del pedido.

**Invariante central:** Los precios en OrderLine son inmutables y provienen exclusivamente de la respuesta del catálogo en el momento del checkout.

### Agregado `CustomerAddress` (readModel)
Local Read Model de las direcciones de entrega del cliente, sincronizado desde eventos `CustomerAddressUpdated` del BC `customers`. No tiene lógica de dominio propia — es una proyección upserted por eventos. Se usa en el checkout para resolver y congelar la dirección de entrega.

---

## 4. Casos de Uso por Actor

### Customer

| ID | Nombre | Descripción | Impl |
|----|--------|-------------|------|
| UC-ORD-001 | CreateCart | Crea un nuevo carrito OPEN con el método de pago seleccionado. Valida que no exista otro carrito OPEN para el cliente. | full |
| UC-ORD-002 | AddItemToCart | Agrega un producto al carrito. Si el producto ya existe, incrementa la cantidad. | scaffold |
| UC-ORD-003 | UpdateCartItem | Actualiza la cantidad de un ítem en el carrito. | full |
| UC-ORD-004 | RemoveCartItem | Elimina un ítem del carrito. | full |
| UC-ORD-005 | Checkout | Ejecuta el checkout: valida precios vía catalog (HTTP), congela el carrito, crea la Order con snapshot de precios. Dispara el CheckoutSaga. | scaffold |
| UC-ORD-006 | GetCart | Obtiene el carrito activo del cliente con todos sus ítems. | full |
| UC-ORD-010 | GetOrder | Obtiene el detalle completo de un pedido propio. | full |
| UC-ORD-011 | ListOrders | Lista los pedidos propios con filtros opcionales de estado. | scaffold |
| UC-ORD-012 | CancelOrder | Cancela un pedido en estado PENDING_PAYMENT o CONFIRMED. | scaffold |

### Admin

| ID | Nombre | Descripción | Impl |
|----|--------|-------------|------|
| UC-ORD-010 | GetOrder | Obtiene el detalle completo de cualquier pedido (sin restricción de ownership). | full |
| UC-ORD-011 | ListOrders | Lista pedidos con filtros opcionales (customerId, estado). | scaffold |
| UC-ORD-012 | CancelOrder | Cancela cualquier pedido en estado PENDING_PAYMENT o CONFIRMED. | scaffold |

### System (event-driven)

| ID | Nombre | Trigger | Descripción | Impl |
|----|--------|---------|-------------|------|
| UC-ORD-020 | ConfirmOrder | PaymentApproved | Confirma el pedido (paso 3 del CheckoutSaga). Emite OrderConfirmed. | scaffold |
| UC-ORD-021 | CancelOrderOnStockFailed | StockReservationFailed | Cancela el pedido cuando falla la reserva de stock (compensación). | scaffold |
| UC-ORD-022 | CancelOrderOnPaymentFailed | PaymentFailed | Cancela el pedido cuando falla el pago (compensación). | scaffold |
| UC-ORD-023 | SetOrderInDelivery | DeliveryOrderCreated | Transiciona el pedido a IN_DELIVERY. | scaffold |
| UC-ORD-024 | CompleteDelivery | DeliveryCompleted | Transiciona el pedido a DELIVERED. | scaffold |
| UC-ORD-025 | AcknowledgeStockReleased | StockReleased | Acuse de recibo de liberación de stock (seguimiento saga). | scaffold |
| UC-ORD-026 | AcknowledgePaymentRefunded | PaymentRefunded | Acuse de recibo de reembolso de pago (seguimiento saga). | scaffold |
| UC-ORD-030 | SyncCustomerAddress | CustomerAddressUpdated | Upsert del LRM de direcciones de entrega del cliente. | full |

---

## 5. Flujo del CheckoutSaga (perspectiva de Orders)

```
Customer          orders BC                catalog BC       inventory BC     payments BC
   │                  │                        │                  │               │
   │ POST /checkout   │                        │                  │               │
   │─────────────────►│                        │                  │               │
   │                  │ validateProductsAndPrices                  │               │
   │                  │───────────────────────►│                  │               │
   │                  │◄───────────────────────│ prices snapshot  │               │
   │                  │                        │                  │               │
   │                  │ Cart.checkout()        │                  │               │
   │                  │ Order.create() → OrderPlaced (outbox)     │               │
   │◄─────────────────│ 201 Location: /orders/{id}                │               │
   │                  │                        │                  │               │
   │                  │                        │ OrderPlaced      │               │
   │                  │                        │─────────────────►│               │
   │                  │                        │                  │ StockReserved │
   │                  │                        │                  │──────────────►│
   │                  │                        │                  │               │ PaymentApproved
   │                  │◄──────────────────────────────────────────────────────────│
   │                  │ ConfirmOrder           │                  │               │
   │                  │ Order.confirm() → OrderConfirmed (outbox) │               │
```

**Compensación (stock falla):**
```
inventory → StockReservationFailed → UC-ORD-021 → Order.cancel() → OrderCancelled
```

**Compensación (pago falla):**
```
payments → PaymentFailed → UC-ORD-022 → Order.cancel() → OrderCancelled
inventory (al recibir PaymentFailed) → StockReleased → UC-ORD-025 → acuse
```

---

## 6. Local Read Model: CustomerAddress

### Mecanismo de sincronización
- **Fuente:** Eventos `CustomerAddressUpdated` del BC `customers`.
- **Estrategia:** Upsert por `addressId` (clave externa del BC customers).
- **Consistencia:** Eventual — lag típico < 1-2 segundos.
- **Soft-delete:** El campo `deleted: Boolean` refleja la eliminación de una dirección.

### Uso en Checkout (UC-ORD-005)
1. El cliente envía `deliveryAddressId` (= `addressId` de la tabla CustomerAddress).
2. El handler busca `customerAddressRepository.findByAddressId(deliveryAddressId)`.
3. Si no se encuentra o `deleted == true` → `DELIVERY_ADDRESS_NOT_FOUND` (404).
4. Si se encuentra → se crea un `DeliveryAddressSnapshot` con los campos actuales.

### Supuesto de bootstrapping
Para clientes que hacen su primer pedido antes de que el LRM esté sincronizado, se
asume que el cliente habrá creado su dirección en el BC `customers` con suficiente
antelación para que el evento `CustomerAddressUpdated` haya sido procesado (lag < 2s).
Si el LRM está vacío para el cliente, el checkout fallará con `DELIVERY_ADDRESS_NOT_FOUND`.
El BC `customers` debe emitir `CustomerAddressUpdated` en la creación inicial de cada
dirección (no solo en actualizaciones) para asegurar la convergencia del LRM.

---

## 7. Decisiones de Diseño Notables

### HTTP síncrono para precios en checkout (OWASP A04)
Los precios de los productos **siempre** se leen del catálogo en tiempo real al hacer
checkout. No se cachean ni se leen del carrito. Esto previene fraude de precios
(OWASP A04: Insecure Design) y garantiza que el monto cobrado es siempre el precio
autoritativo del catálogo, nunca un valor manipulado por el cliente.

### Local Read Model para direcciones de entrega
Las direcciones de entrega son datos de identidad (no monetarios), por lo que se
acepta consistencia eventual. Esto evita una llamada HTTP síncrona al BC `customers`
en cada checkout y elimina el acoplamiento temporal con ese BC.

### Precios congelados en OrderLine (inmutabilidad)
Las `OrderLine` son inmutables (`immutable: true`) para garantizar que el monto cobrado
al cliente no cambie retroactivamente si el catálogo actualiza los precios del producto
después de la confirmación del pedido.

### Un carrito OPEN por cliente (invariante de negocio)
Cada cliente puede tener exactamente un carrito `OPEN` en cualquier momento. Esta regla
previene pedidos duplicados accidentales. La verificación se hace proactivamente con
`findOpenByCustomerId` antes de crear el carrito.

### Idempotencia de handlers de eventos (consumerIdempotency)
Todos los event-driven command handlers (UC-ORD-020 a UC-ORD-026) son idempotentes
gracias al `consumerIdempotency` configurado en el sistema. Los guards de estado
(ORD-RULE-008, ORD-RULE-009, ORD-RULE-010) proveen idempotencia de dominio adicional.

---

## 8. Contratos de Integración

### Outbound (orders → catalog)
| Operación | Protocolo | Propósito |
|-----------|-----------|-----------|
| `validateProductsAndPrices` | HTTP POST (internal-jwt) | Snapshot de precios al checkout |

### Eventos Publicados
| Evento | Canal | Consumidores |
|--------|-------|-------------|
| `OrderPlaced` | `orders.order.placed` | inventory (paso 1 saga) |
| `OrderConfirmed` | `orders.order.confirmed` | delivery (paso 4 saga), notifications |
| `OrderCancelled` | `orders.order.cancelled` | delivery, payments, notifications |

### Eventos Consumidos
| Evento | Canal | Origen | UC handler |
|--------|-------|--------|-----------|
| `PaymentApproved` | `payments.payment.approved` | payments | UC-ORD-020 |
| `PaymentFailed` | `payments.payment.failed` | payments | UC-ORD-022 |
| `PaymentRefunded` | `payments.payment.refunded` | payments | UC-ORD-026 |
| `StockReservationFailed` | `inventory.stock.reservation.failed` | inventory | UC-ORD-021 |
| `StockReleased` | `inventory.stock.released` | inventory | UC-ORD-025 |
| `DeliveryOrderCreated` | `delivery.delivery.order.created` | delivery | UC-ORD-023 |
| `DeliveryCompleted` | `delivery.delivery.completed` | delivery | UC-ORD-024 |
| `CustomerAddressUpdated` | `customers.customer.address.updated` | customers | UC-ORD-030 |
