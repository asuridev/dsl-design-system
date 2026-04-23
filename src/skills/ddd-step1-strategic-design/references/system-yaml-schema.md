# Schema de system.yaml — Referencia Completa

Este documento define el schema canónico del artefacto `system.yaml` para el Paso 1.
Es machine-readable (input para generadores) y human-readable (fuente de verdad del diseño).

---

## Schema Completo Anotado

```yaml
# ─────────────────────────────────────────────────────────────────────────────
# SYSTEM ARCHITECTURE — PASO 1: DISEÑO ESTRATÉGICO
# [Nombre del Sistema]
# Versión: 1.0.0 | Fecha: YYYY-MM-DD
# ─────────────────────────────────────────────────────────────────────────────

# ─── IDENTIDAD DEL SISTEMA ───────────────────────────────────────────────────
system:
  name: ""              # kebab-case, sin espacios
  description: >        # descripción del sistema en prosa, 2-4 líneas
    ...
  domainType: ""        # core | supporting | generic
                        # En general el sistema completo es "core" —
                        # los BCs individuales tienen su propia clasificación

# ─── BOUNDED CONTEXTS ────────────────────────────────────────────────────────
# Cada BC tiene: nombre, tipo, propósito y agregados estratégicos
# NO incluir en Paso 1: value_objects, domain_events internos, invariantes
boundedContexts:

  - name: ""            # kebab-case
    type: ""            # core | supporting | generic
    purpose: >          # una frase: qué hace este BC y por qué existe
      ...
    aggregates:
      - name: ""        # PascalCase — nombre del agregado
        root: ""        # PascalCase — entidad raíz (Aggregate Root)
        entities:       # lista de entidades internas relevantes (máx 4)
          - ""          # PascalCase

# ─── SISTEMAS EXTERNOS ───────────────────────────────────────────────────────
# Solo sistemas que aparecen referenciados en integrations
externalSystems:

  - name: ""            # kebab-case — el mismo nombre usado en integrations
    description: >      # qué hace este sistema externo
      ...
    type: ""            # payment-gateway | notification-provider |
                        # identity-provider | erp | logistics | tax-authority |
                        # crm | analytics | storage | other

# ─── MAPA DE INTEGRACIONES ───────────────────────────────────────────────────
# Sección dedicada — separada de los BCs para evolucionar independientemente
# Una integración = una dirección de comunicación entre dos partes
integrations:

  - from: ""            # nombre del BC o external_system emisor
    to: ""              # nombre del BC o external_system receptor
    pattern: ""         # customer-supplier | event | acl | shared-kernel | open-host
    channel: ""         # http | grpc | message-broker | websocket
    contracts:          # La forma depende del valor de `channel`:
                        #
                        # channel: http | grpc | websocket → string camelCase
                        #   - iniciarCobro
                        #
                        # channel: message-broker → objeto con name y channel
                        #   - name: PedidoConfirmado         ← PascalCase
                        #     channel: orders.order.confirmed ← nombre exacto del canal AsyncAPI
      - ""
    notes: ""           # explicación del por qué de esta integración

# ─── INFRAESTRUCTURA ─────────────────────────────────────────────────────────
# Restricciones tecnológicas del Paso 1.
# Siempre presente. Defaults aplicados si el diseñador no especifica.
infrastructure:

  deployment:
    strategy: ""        # modular-monolith | microservices | serverless
                        # DEFAULT: modular-monolith
    architectureStyle: ""   # hexagonal | layered | clean
                            # DEFAULT: hexagonal
    notes: >            # explicar si es default o decisión explícita
      ...

  messageBroker:        # OMITIR si no hay integraciones con channel: message-broker
    technology: ""      # rabbitmq | kafka | aws-sqs-sns | azure-service-bus | temporal
                        # DEFAULT: rabbitmq
    notes: >
      ...

  database:
    technology: ""      # postgresql | mysql | mongodb | sqlserver
                        # DEFAULT: postgresql
    isolationStrategy: ""   # schema-per-bc | db-per-bc | prefix-per-bc
                            # DEFAULT: schema-per-bc
                            # RECOMENDADO: schema-per-bc para monolito modular
                            # que evoluciona a microservicios
    notes: >
      ...
```

---

## Reglas de Validación

### Nombres
- `system.name` → kebab-case (ej: `canasta-familiar-platform`)
- `boundedContexts[].name` → kebab-case (ej: `pedidos`, `gestion-clientes`)
- `aggregates[].name` y `aggregates[].root` → PascalCase (ej: `Pedido`, `LineaPedido`)
- `aggregates[].entities[]` → PascalCase
- `externalSystems[].name` → kebab-case, debe coincidir exactamente con referencias en `integrations`
- Contratos de operaciones HTTP/grpc/websocket → camelCase string (ej: `validarProductoYPrecio`)
- Contratos de eventos message-broker → objeto con dos campos:
  - `name` → PascalCase (ej: `PedidoConfirmado`)
  - `channel` → kebab-case exacto del canal AsyncAPI (ej: `orders.order.confirmed`)

### Consistencia
- Todo `from` y `to` en `integrations` debe ser un `name` de `boundedContexts` o `externalSystems`
- Si un `channel` es `message-broker`, debe existir `infrastructure.messageBroker`
- Si `deployment.strategy` es `modular-monolith`, `database.isolationStrategy` debe ser `schema-per-bc` (recomendado) o `db-per-bc`
- Si `channel` es `message-broker`, cada elemento de `contracts[]` DEBE ser un objeto con `name` y `channel`. Si `channel` es `http | grpc | websocket`, cada elemento DEBE ser un string camelCase.

### Conteo orientativo de BCs por tipo de sistema
| Tipo de Sistema | BCs Esperados | Señal de alerta |
|-----------------|---------------|-----------------|
| E-commerce simple | 6-9 | > 12 = probable sobre-diseño |
| Marketplace | 8-12 | < 5 = probable sub-diseño |
| SaaS B2B | 5-8 | — |
| Seguros | 7-11 | — |
| Tickets / Eventos | 5-8 | — |

---

## Patrones de Integración — Guía de Selección

```
¿La respuesta inmediata es necesaria para continuar el flujo?
  ├── Sí → channel: http, pattern: customer-supplier
  └── No → channel: message-broker, pattern: event

¿Se integra con un sistema externo?
  └── Siempre → pattern: acl (independiente del channel)

¿Un BC consume el modelo de otro sin poder cambiarlo?
  └── pattern: customer-supplier (el supplier dicta el contrato)

¿El BC expone una API estable que otros consumen libremente?
  └── pattern: open-host
```

---

## Ejemplos por Dominio

### Integración evento (async)
```yaml
- from: pedidos
  to: notificaciones
  pattern: event
  channel: message-broker
  contracts:
    - name: PedidoConfirmado
      channel: pedidos.order.confirmed
    - name: PedidoCancelado
      channel: pedidos.order.cancelled
  notes: El cliente recibe notificación ante cambios relevantes en su pedido.
```

### Integración sincrónica
```yaml
- from: pedidos
  to: catalogo
  pattern: customer-supplier
  channel: http
  contracts:
    - validarProductoYPrecio
  notes: Pedidos consulta disponibilidad y precio al agregar al carrito.
```

### Integración con sistema externo (ACL)
```yaml
- from: pagos
  to: pasarela-pago
  pattern: acl
  channel: http
  contracts:
    - procesarPagoTarjeta
    - consultarEstadoPago
  notes: >
    ACL que abstrae el modelo de la pasarela externa.
    El dominio interno nunca conoce los DTOs del proveedor.
```
