# Convenciones AsyncAPI 2.6.0 — Paso 2

Estándar: **AsyncAPI Specification 2.6.0**
Referencia oficial: https://www.asyncapi.com/docs/reference/specification/v2.6.0

Broker: **agnóstico** — tecnología definida en Fase 2 (generador de código)
Patrón de mensajería: Publish/Subscribe

---

## Cabecera Obligatoria

```yaml
asyncapi: "2.6.0"
info:
  title: {BC Name} BC — Async API
  description: >
    {Descripción de los eventos que este BC publica y consume.}
  version: "1.0.0"

defaultContentType: application/json

servers:
  message-broker:
    url: "/"
    description: Message broker — technology defined in Fase 2
```

---

## Convención de Canales

El canal se deriva **directamente del nombre del evento** (PascalCase):

1. Tomar el nombre del evento: `ProductPriceUpdated`
2. Convertir a kebab-case: `product-price-updated`
3. Reemplazar **todos** los guiones por puntos: `product.price.updated`
4. Anteponer el BC fuente: `catalog.product.price.updated`

Fórmula: `{source-bc}.{event-name-en-dot-notation}`

| Tipo | Canal | Sección YAML |
|------|-------|-------------|
| Evento **publicado** por este BC | `{este-bc}.{event-dots}` | `publish` |
| Evento **consumido** de otro BC | `{otro-bc}.{event-dots}` | `subscribe` |

### Ejemplos reales del sistema

| Evento | Canal | Publicado por |
|--------|-------|---------------|
| `ProductActivated` | `catalog.product.activated` | catalog |
| `ProductPriceUpdated` | `catalog.product.price.updated` | catalog |
| `StockUpdated` | `inventory.stock.updated` | inventory |
| `OrderConfirmed` | `orders.order.confirmed` | orders |
| `PaymentCaptured` | `payments.payment.captured` | payments |
| `StockItemReserved` | `inventory.stock.item.reserved` | inventory |

### Reglas del nombre de canal

- **Sin guiones en ningún segmento** — el único separador válido es el punto (`.`)
- Siempre en minúsculas; todo PascalCase se descompone en segmentos separados por puntos
- La entidad es singular: `product`, `order`, `stock.item` (no `products`, no `stock-item`)
- El evento expresa la acción en pasado; las palabras compuestas usan puntos: `price.updated`, `stock.updated`
- Nunca incluir el nombre del BC dentro del nombre del evento (ya va como prefijo del canal)

---

## Resolución del nombre de canal según origen del evento

Los canales no siempre se derivan por convención. La fuente de verdad es `system.yaml`.

### Canales PUBLICADOS por este BC

Derivar por convención a partir del **nombre del evento de dominio**:

1. Tomar nombre PascalCase del evento
2. Convertir a kebab-case
3. Reemplazar todos los `-` por `.`
4. Anteponer el nombre del BC

No existe referencia directa en `system.yaml` hacia los consumidores del evento.

```yaml
# Evento: ProductActivated → product-activated → product.activated
catalog.product.activated

# Evento: ProductPriceUpdated → product-price-updated → product.price.updated
catalog.product.price.updated

# Evento: StockItemReserved → stock-item-reserved → stock.item.reserved
inventory.stock.item.reserved
```

### Canales CONSUMIDOS por este BC

**No derivar por convención. Leer el campo `contracts[].channel` del `system.yaml`.**

En `system.yaml`, la integración con `channel: message-broker` de la que este BC
es destino (`to: {este-bc}`) tiene sus contratos como objetos:

```yaml
# En system.yaml:
- from: inventory
  to: catalog
  channel: message-broker
  contracts:
    - name: StockActualizado
      channel: inventory.stock.updated   ← usar este valor exacto
```

El nombre del canal AsyncAPI para el evento consumido es el valor de `contracts[].channel`,
**no** una derivación del nombre del evento. Esto garantiza trazabilidad directa entre
el diseño estratégico y el contrato de mensajería.

```yaml
# En {bc}-async-api.yaml — usar el valor de contracts[].channel:
channels:
  inventory.stock.updated:       ← copiado directamente de system.yaml
    subscribe:
      ...
```

---

## Estructura de un Canal — Evento Publicado

```yaml
channels:
  catalog.product.activated:
    description: >
      Emitted when a product transitions to ACTIVE status and becomes
      available for purchase.
    publish:
      operationId: onProductActivated
      summary: Product became active
      message:
        $ref: '#/components/messages/ProductActivatedMessage'
```

## Estructura de un Canal — Evento Consumido

```yaml
  inventory.stock.updated:
    description: >
      Consumed to update the isAvailable flag on the affected product.
    subscribe:
      operationId: handleStockUpdated
      summary: Handle stock update from Inventory BC
      message:
        $ref: '#/components/messages/StockUpdatedMessage'
```

---

## Estructura de un Mensaje

```yaml
components:
  messages:
    ProductActivatedMessage:
      name: ProductActivated
      title: Product Activated
      summary: A product has transitioned to ACTIVE status.
      contentType: application/json
      headers:
        $ref: '#/components/schemas/EventHeaders'
      payload:
        $ref: '#/components/schemas/ProductActivatedPayload'
```

---

## EventHeaders — Schema Reutilizable (SIEMPRE definir)

```yaml
components:
  schemas:
    EventHeaders:
      type: object
      required: [eventId, eventType, occurredAt, sourceBC]
      properties:
        eventId:
          type: string
          format: uuid
          description: Unique identifier of this event instance.
        eventType:
          type: string
          description: Fully-qualified event type name.
          example: catalog.product.activated
        occurredAt:
          type: string
          format: date-time
          description: ISO 8601 timestamp when the event occurred (UTC).
        sourceBC:
          type: string
          description: Name of the bounded context that published the event.
          example: catalog
        correlationId:
          type: string
          format: uuid
          description: Optional correlation ID for distributed tracing.
```

---

## Estructura de un Payload

```yaml
    ProductActivatedPayload:
      type: object
      required: [productId, name, categoryId, price, occurredAt]
      properties:
        productId:
          type: string
          format: uuid
          description: Identifier of the activated product.
        name:
          type: string
          description: Commercial name of the product.
        categoryId:
          type: string
          format: uuid
          description: Category the product belongs to.
        price:
          $ref: '#/components/schemas/Money'
        occurredAt:
          type: string
          format: date-time
          description: Timestamp when the product was activated.
```

---

## Money en AsyncAPI

Igual que en OpenAPI: `amount` siempre como `type: string` decimal.

```yaml
    Money:
      type: object
      required: [amount, currency]
      properties:
        amount:
          type: string
          description: Exact monetary amount as a decimal string.
          example: "3500.0000"
        currency:
          type: string
          minLength: 3
          maxLength: 3
          description: ISO 4217 currency code.
          example: COP
```

---

## Archivo Completo — Estructura Canónica

```yaml
asyncapi: "2.6.0"
info:
  title: ...
  version: "1.0.0"
defaultContentType: application/json

servers:
  message-broker:
    url: "/"
    description: Message broker — technology defined in Fase 2

channels:
  # ── Eventos publicados ─────────────────────────────────────────────────────
  {bc}.{event.dot.notation}:
    description: ...
    publish:
      operationId: on{EventName}
      message:
        $ref: '#/components/messages/{EventName}Message'

  # ── Eventos consumidos ─────────────────────────────────────────────
  {otro-bc}.{event.dot.notation}:
    description: ...
    subscribe:
      operationId: handle{EventName}
      message:
        $ref: '#/components/messages/{EventName}Message'

components:
  messages:
    {EventName}Message:
      name: {EventName}
      title: ...
      contentType: application/json
      headers:
        $ref: '#/components/schemas/EventHeaders'
      payload:
        $ref: '#/components/schemas/{EventName}Payload'

  schemas:
    EventHeaders:
      # ... (ver arriba)

    Money:
      # ... (ver arriba)

    {EventName}Payload:
      type: object
      required: [...]
      properties:
        # snapshot de datos en el momento del evento
```

---

## Principios de Diseño de Eventos

**El payload es el snapshot del dominio; los metadatos del evento van en `EventMetadata`.**
Incluir en `payload[]` todos los datos de negocio que los consumidores necesitan para
procesar el evento **sin hacer lookups posteriores**. Si un consumidor necesitaría
consultar el BC publicador para completar el procesamiento, falta información en el payload.

**NO declarar `eventId`, `eventType`, `eventVersion`, `occurredAt`, `sourceBc`, `correlationId` ni `causationId` en
`payload[]`.** Estos campos forman parte de `EventMetadata` y el generador los auto-inyecta
en todos los mensajes. Declararlos manualmente provoca campos duplicados en el contrato y
el generador emite una advertencia. Los consumidores acceden a ellos vía el objeto
`EventMetadata`, no a través del payload de negocio.

**El `eventId` permite idempotencia.** Los consumidores deben poder recibir el mismo
evento múltiples veces (red retry) sin efectos secundarios. El `eventId` es la clave.

**No incluir datos sensibles en eventos.** Números de tarjeta, contraseñas, PII
no debe circular por el broker. Si es necesario, usar referencia por ID y que el
consumidor lo consulte de forma segura.

---

## Convenciones de Nombres en AsyncAPI

| Elemento | Convención | Ejemplo |
|----------|-----------|---------|
| Canal | `{bc}.{event.dot.notation}` | `catalog.product.price.updated` |
| `operationId` publicado | `on{EventName}` | `onProductActivated` |
| `operationId` consumido | `handle{EventName}` | `handleStockUpdated` |
| Message name | `{EventName}Message` | `ProductActivatedMessage` |
| Payload schema | `{EventName}Payload` | `ProductActivatedPayload` |
| Event name en payload | PascalCase pasado | `ProductActivated`, `StockUpdated` |
