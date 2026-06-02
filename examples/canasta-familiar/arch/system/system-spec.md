# Canasta Familiar — Especificación del Sistema

> **Paso 1 — Diseño Estratégico DDD**
> Generado: 2026-05-15
> Fuente de verdad estructurada: `arch/system/system.yaml`

---

## Visión General del Sistema

**Canasta Familiar** es una plataforma digital B2C para la venta de productos de la canasta familiar (abarrotes, alimentos y productos del hogar). Los clientes navegan un catálogo, agregan productos al carrito, realizan el checkout con tarjeta de crédito/débito o seleccionan pago en efectivo contra entrega, y reciben los productos a domicilio mediante la flota propia de repartidores de la empresa.

**Modelo de negocio:** Tienda propia — la empresa controla el catálogo, el inventario y la logística de entrega.

**Flujo principal de valor:**
> Cliente navega catálogo → agrega al carrito → hace checkout → stock reservado → pago procesado → pedido confirmado → repartidor asignado → entrega completada

---

## BC: catalog

### Propósito
Gestionar el catálogo de productos de la plataforma: categorías, información de producto, imágenes y precios. Es la fuente autoritativa de toda la información y precios de productos.

### Responsabilidades
- Crear, actualizar y discontinuar productos con sus datos completos (nombre, descripción, imágenes, precio)
- Gestionar la jerarquía de categorías del catálogo
- Publicar eventos de ciclo de vida del producto (`ProductActivated`, `ProductDiscontinued`) para que el inventario reaccione
- Exponer el precio autoritativo de cada producto para el snapshot monetario del checkout (llamada HTTP desde `orders`)

### No Responsabilidades
- No controla cuántas unidades hay disponibles de cada producto — eso es `inventory`
- No gestiona pedidos ni el carrito de compras — eso es `orders`
- No procesa pagos — eso es `payments`
- No determina si un producto puede enviarse a una zona geográfica — eso es `delivery`

### Lenguaje Ubícuo

| Término | Definición en este BC |
|---------|----------------------|
| Product | Artículo de la canasta familiar con nombre, descripción, precio y categoría. Tiene ciclo de vida: DRAFT → ACTIVE → DISCONTINUED |
| Category | Agrupación jerárquica de productos (ej: Lácteos, Frutas y Verduras, Limpieza). Existe independientemente de los productos |
| ProductImage | Imagen asociada a un producto. Entidad interna, no tiene vida fuera del Product |
| ProductActivated | Evento emitido cuando un producto pasa al estado ACTIVE y ya puede ser comprado |
| ProductDiscontinued | Evento emitido cuando un producto deja de venderse definitivamente |

### Agregados Principales

| Agregado | Root | Entidades internas |
|----------|------|--------------------|
| Product | Product | ProductImage |
| Category | Category | — |

> **Nota de diseño:** `Category` es un agregado propio (no entidad interna de Product) porque: (1) puede existir antes de que se creen productos, (2) es referenciada por múltiples productos, y (3) tiene CRUD independiente desde el back-office.

### Dependencias Externas
Ninguna — es un BC Core emisor, sin dependencias de otros BCs o sistemas externos.

---

## BC: orders

### Propósito
Gestionar el ciclo de vida completo del pedido: desde la creación del carrito y el checkout hasta la confirmación, el seguimiento de entrega y la finalización. Es el coordinador central del CheckoutSaga.

### Responsabilidades
- Gestionar el carrito de compras (agregar, quitar, modificar ítems)
- Ejecutar el checkout: validar precios con `catalog` vía HTTP (snapshot monetario) y emitir `OrderPlaced`
- Confirmar el pedido al recibir `PaymentApproved` y emitir `OrderConfirmed`
- Cancelar el pedido al recibir `StockReservationFailed` o `PaymentFailed` y emitir `OrderCancelled`
- Actualizar el estado del pedido a DELIVERED al recibir `DeliveryCompleted`
- Mantener un local read model de direcciones de entrega del cliente alimentado por `CustomerAddressUpdated`

### No Responsabilidades
- No procesa pagos ni interactúa con la pasarela — eso es `payments`
- No reserva ni libera stock — eso es `inventory`
- No asigna repartidores ni traza rutas — eso es `delivery`
- No gestiona la cuenta del cliente ni sus datos personales — eso es `customers`
- No define el precio de los productos — eso es `catalog`

### Lenguaje Ubícuo

| Término | Definición en este BC |
|---------|----------------------|
| Cart | Carrito de compras activo de un cliente. Entidad temporal previa al pedido. Estado: OPEN → CHECKED_OUT |
| CartItem | Línea del carrito: referencia a un producto + cantidad deseada |
| Order | Pedido confirmado con ítems, precios congelados y dirección de entrega. Estados: PENDING_PAYMENT → CONFIRMED → IN_DELIVERY → DELIVERED / CANCELLED |
| OrderLine | Línea del pedido: productId, nombre, unitPrice (snapshot del precio en catálogo), quantity, subtotal |
| OrderPlaced | Evento emitido al hacer checkout. Dispara el CheckoutSaga |
| OrderConfirmed | Evento emitido cuando el pago es aprobado. Dispara la creación de la entrega |
| OrderCancelled | Evento emitido cuando el stock falla o el pago falla |

### Agregados Principales

| Agregado | Root | Entidades internas |
|----------|------|--------------------|
| Order | Order | OrderLine |
| Cart | Cart | CartItem |

### Dependencias Externas
- **catalog** (HTTP síncrono): lee precios autoritativos al momento del checkout para `OrderLine.unitPrice`
- **customers** (LRM — eventos): consume `CustomerAddressUpdated` para mantener copia local de la dirección de entrega

---

## BC: payments

### Propósito
Procesar y registrar los pagos asociados a los pedidos. Soporta dos modalidades: tarjeta de crédito/débito mediante pasarela externa, y pago en efectivo contra entrega. Gestiona reembolsos para pedidos cancelados que fueron cobrados por tarjeta.

### Responsabilidades
- Iniciar el cobro al recibir `StockReserved` (para pagos con tarjeta)
- Aprobar inmediatamente el pago al recibir `StockReserved` en pedidos cash-on-delivery
- Emitir `PaymentApproved` o `PaymentFailed` según el resultado
- Registrar el pago en efectivo al recibir `CashCollected` desde `delivery`
- Ejecutar reembolsos en la pasarela al cancelar pedidos con pago por tarjeta ya capturado
- Integrar con la pasarela de pago externa mediante ACL

### No Responsabilidades
- No decide si el stock está disponible — eso es `inventory`
- No gestiona la dirección de entrega ni asigna repartidores — eso es `delivery`
- No modifica el estado del pedido — eso es `orders`
- No almacena datos de tarjeta del cliente (los maneja la pasarela externa)

### Lenguaje Ubícuo

| Término | Definición en este BC |
|---------|----------------------|
| Payment | Registro del cobro asociado a un pedido. Estados: PENDING → APPROVED / FAILED / REFUNDED |
| PaymentApproved | Evento emitido tras cobro exitoso en pasarela (tarjeta) o aprobación inmediata (efectivo). Dispara confirmación del pedido |
| PaymentFailed | Evento emitido si la pasarela rechaza el cobro. Dispara compensación (stock liberado + pedido cancelado) |
| PaymentRefunded | Evento emitido tras reembolso exitoso en la pasarela |
| CashCollected | Evento recibido desde delivery indicando que el repartidor cobró el efectivo |

### Agregados Principales

| Agregado | Root | Entidades internas |
|----------|------|--------------------|
| Payment | Payment | — |

### Dependencias Externas
- **payment-gateway** (ACL / HTTP): pasarela externa para cobros y reembolsos con tarjeta. Protegida por ACL adapter con autenticación API Key y circuit breaker.

---

## BC: inventory

### Propósito
Controlar el stock en tiempo real de cada producto activo. Reacciona al ciclo de vida del catálogo para crear y cerrar ítems de stock. Reserva y libera stock como parte del CheckoutSaga.

### Responsabilidades
- Crear un `StockItem` cuando `catalog` emite `ProductActivated`
- Cerrar permanentemente el `StockItem` cuando `catalog` emite `ProductDiscontinued`
- Reservar stock al recibir `OrderPlaced` (paso 1 del CheckoutSaga)
- Emitir `StockReserved` si hay suficiente stock, o `StockReservationFailed` si no
- Liberar stock reservado (compensación) al recibir `PaymentFailed` y emitir `StockReleased`
- Permitir al administrador ajustar el stock manualmente (correcciones, ingresos de mercancía)

### No Responsabilidades
- No define ni modifica los datos del producto (precio, nombre, imágenes) — eso es `catalog`
- No procesa pagos — eso es `payments`
- No gestiona la logística de entrega — eso es `delivery`

### Lenguaje Ubícuo

| Término | Definición en este BC |
|---------|----------------------|
| StockItem | Unidad de control de stock para un producto activo. Contiene la cantidad disponible y las reservas activas |
| StockMovement | Registro de cada cambio en el stock: entrada, salida, reserva, liberación |
| StockReserved | Evento emitido cuando el stock se reserva exitosamente para un pedido |
| StockReservationFailed | Evento emitido cuando no hay suficiente stock para completar la reserva |
| StockReleased | Evento emitido cuando el stock reservado se libera por cancelación del pedido (compensación) |

### Agregados Principales

| Agregado | Root | Entidades internas |
|----------|------|--------------------|
| StockItem | StockItem | StockMovement |

### Dependencias Externas
Ninguna — integrado solo con BCs internos vía eventos.

---

## BC: delivery

### Propósito
Gestionar las entregas a domicilio usando la flota propia de repartidores. Sigue el ciclo de vida desde la creación de la orden de entrega hasta la confirmación de entrega, registrando el cobro en efectivo cuando aplica.

### Responsabilidades
- Crear una `DeliveryOrder` al recibir `OrderConfirmed` y emitir `DeliveryOrderCreated`
- Asignar un `Courier` disponible a cada entrega
- Registrar la entrega completada y emitir `DeliveryCompleted`
- Emitir `CashCollected` cuando el repartidor cobra en efectivo contra entrega
- Cancelar la entrega al recibir `OrderCancelled` (si la entrega ya fue creada)
- Permitir al administrador registrar, activar y desactivar repartidores

### No Responsabilidades
- No procesa el pago en efectivo contablemente — solo emite el evento; eso lo registra `payments`
- No gestiona el inventario ni los pedidos — esos son `inventory` y `orders`
- No modifica datos del cliente — eso es `customers`

### Lenguaje Ubícuo

| Término | Definición en este BC |
|---------|----------------------|
| DeliveryOrder | Orden de entrega generada a partir de un pedido confirmado. Estados: CREATED → ASSIGNED → IN_TRANSIT → DELIVERED / CANCELLED |
| Courier | Repartidor de la flota propia. Estados: AVAILABLE, BUSY, INACTIVE |
| DeliveryOrderCreated | Evento emitido cuando se crea la orden de entrega para un pedido |
| DeliveryCompleted | Evento emitido cuando el repartidor confirma la entrega al cliente |
| CashCollected | Evento emitido cuando el repartidor cobra el pago en efectivo |

### Agregados Principales

| Agregado | Root | Entidades internas |
|----------|------|--------------------|
| DeliveryOrder | DeliveryOrder | — |
| Courier | Courier | — |

> **Nota de diseño:** `Courier` es un agregado propio porque: (1) existe independientemente de cualquier entrega, (2) el administrador lo gestiona por separado (alta, baja, disponibilidad), y (3) tiene ciclo de vida propio.

### Dependencias Externas
Ninguna — integrado solo con BCs internos vía eventos.

---

## BC: customers

### Propósito
Gestionar las cuentas de los clientes registrados y sus direcciones de entrega. Publica eventos de cambio de dirección consumidos por `orders` para mantener un modelo de lectura local.

### Responsabilidades
- Registrar y gestionar cuentas de clientes (nombre, email, teléfono)
- Gestionar las direcciones de entrega del cliente
- Publicar `CustomerAddressUpdated` cuando el cliente modifica una dirección
- Autenticar a los clientes (con soporte del servidor de autenticación)

### No Responsabilidades
- No gestiona el carrito ni los pedidos del cliente — eso es `orders`
- No controla el historial de pedidos — eso es `orders`
- No define zonas de entrega ni disponibilidad de repartidores — eso es `delivery`

### Lenguaje Ubícuo

| Término | Definición en este BC |
|---------|----------------------|
| Customer | Cliente registrado en la plataforma. Tiene nombre, email, contraseña y lista de direcciones |
| Address | Dirección de entrega del cliente. Entidad interna de Customer con calle, ciudad, referencia |
| CustomerAddressUpdated | Evento emitido cuando el cliente crea, modifica o elimina una dirección. Consumido por orders para LRM |

### Agregados Principales

| Agregado | Root | Entidades internas |
|----------|------|--------------------|
| Customer | Customer | Address |

### Dependencias Externas
Ninguna — es un BC emisor de eventos consumidos por `orders`.

---

## BC: notifications

### Propósito
Entregar notificaciones transaccionales a los clientes (email, SMS, push) para los hitos clave del ciclo de vida del pedido. Dominio genérico — delega completamente el envío a un proveedor externo.

### Responsabilidades
- Recibir `OrderConfirmed` desde `orders` y enviar confirmación de pedido al cliente
- Recibir `OrderCancelled` desde `orders` y enviar aviso de cancelación al cliente
- Recibir `DeliveryCompleted` desde `delivery` y enviar confirmación de entrega al cliente
- Mapear cada evento a la plantilla correspondiente y delegar envío al proveedor externo mediante ACL

### No Responsabilidades
- No gestiona el ciclo de vida del pedido ni del pago — eso es `orders` y `payments`
- No almacena preferencias de notificación del usuario — es responsabilidad de `customers` en una iteración futura
- No decide si el cliente quiere ser notificado — consume eventos de forma incondicional en V1

### Lenguaje Ubícuo

| Término | Definición en este BC |
|---------|----------------------|
| Notification | Registro de un mensaje enviado a un cliente vinculado a un evento de negocio |
| MessageResult | Respuesta del proveedor externo al enviar un mensaje: id del mensaje y estado |

### Agregados Principales

| Agregado | Root | Entidades internas |
|----------|------|--------------------|
| Notification | Notification | — |

### Dependencias Externas
- **notification-provider** (ACL / HTTP): proveedor externo de mensajería (email/SMS/push). Protegido por ACL adapter con API Key.

---

## Mapa de Integraciones — Resumen

```
ACTORES
  customer ──────────────────────────→ catalog (navegar)
  customer ──────────────────────────→ orders (comprar, rastrear)
  customer ──────────────────────────→ customers (cuenta, direcciones)
  admin ──────────────────────────────→ catalog (gestionar productos)
  admin ──────────────────────────────→ inventory (ajustar stock)
  admin ──────────────────────────────→ orders (gestionar pedidos)
  admin ──────────────────────────────→ delivery (gestionar flota)

CHECKOUT SAGA (flujo principal — asíncrono excepto precio)
  orders ──── HTTP ────────────────────→ catalog          [validateProductsAndPrices — snapshot monetario]
  orders ──── OrderPlaced ────────────→ inventory         [reservar stock]
  inventory ── StockReserved ─────────→ payments          [cobrar]
  payments ─── PaymentApproved ───────→ orders            [confirmar pedido]
  orders ──── OrderConfirmed ─────────→ delivery          [crear entrega]
  delivery ─── DeliveryOrderCreated ──→ orders            [actualizar estado]
  delivery ─── DeliveryCompleted ─────→ orders            [DELIVERED]

COMPENSACIONES (flujo de excepción)
  inventory ── StockReservationFailed → orders            [cancelar pedido]
  payments ─── PaymentFailed ─────────→ inventory         [liberar stock → StockReleased]
  payments ─── PaymentFailed ─────────→ orders            [cancelar pedido → OrderCancelled]
  orders ──── OrderCancelled ─────────→ delivery          [cancelar entrega si existe]
  orders ──── OrderCancelled ─────────→ payments          [reembolso tarjeta → PaymentRefunded]

CASH ON DELIVERY
  delivery ─── CashCollected ─────────→ payments          [registrar cobro en efectivo]

NOTIFICACIONES (fan-out)
  orders ──── OrderConfirmed ─────────→ notifications     [confirmación de pedido al cliente]
  orders ──── OrderCancelled ─────────→ notifications     [aviso de cancelación al cliente]
  delivery ─── DeliveryCompleted ─────→ notifications     [confirmación de entrega al cliente]
  notifications ─ ACL/HTTPS ──────────→ notification-provider [sendMessage]

CICLO DE VIDA CATÁLOGO → INVENTARIO (implícito)
  catalog ─── ProductActivated ───────→ inventory         [crear StockItem]
  catalog ─── ProductDiscontinued ────→ inventory         [cerrar StockItem]

LOCAL READ MODEL: DIRECCIONES
  customers ── CustomerAddressUpdated → orders            [LRM dirección de entrega]

EXTERNO
  payments ─── ACL/HTTPS ─────────────→ payment-gateway  [chargePayment, refundPayment]
  notifications ─ ACL/HTTPS ──────────→ notification-provider [sendMessage]
```
