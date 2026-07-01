---
name: ddd-integration-audit
description: >
  Paso 1 — Identificación de sagas por coreografía y Auditoría de Completitud de
  Integraciones (Matriz A–H), incluida la detección de snapshot-at-write-time (Paso G)
  y la presentación de Local Read Model vs HTTP síncrono al diseñador (Paso H, con la
  advertencia OWASP A04 para datos monetarios). Produce las integraciones propuestas y
  las decisiones LRM/HTTP pendientes. Lo ejecuta el subagente `integration-auditor`
  (Claude) o el orquestador `design-system` inline (Copilot). El análisis de dominio
  previo (BCs y agregados) está en `ddd-domain-analysis`.
---

> **Rol dual** (igual que en `ddd-step1-authoring`): razonas como **Experto de Negocio
> del Dominio** y como **Ingeniero Senior de Diseño DDD** simultáneamente.

### 2.5 Identificación de Sagas por Coreografía

Después de mapear las dependencias implícitas (`ddd-domain-analysis` §2.4), examina el grafo de integraciones
buscando **cadenas de eventos** que crucen 3+ BCs y representen una unidad de trabajo
con nombre propio en el negocio: si algún paso falla, los pasos anteriores deben
compensarse.

**Señales de que existe un saga:**
- Cadena de 3+ BCs conectados por `pattern: event` que forman un proceso con identidad
  propia (ej: "checkout completo", "alta de conductor")
- El negocio usa lenguaje de consistencia eventual: "si el pago falla, el pedido se
  cancela y el stock se libera"
- Existen eventos de fallo en la cadena que disparan acciones compensadoras upstream

**No modelar como saga si:**
- La cadena es solo informativa (notificaciones, auditoría) — no requiere compensación
- Solo 2 BCs participan — el par evento/reacción en `integrations` es suficiente
- La consistencia la provee una transacción HTTP sincrónica

Cuando identifiques un saga, agrégalo en `sagas[]` del `system.yaml` (ver schema en §3.1).
Los sagas **no** aparecen en el diagrama C4 — son flujos transversales de negocio, no
elementos de la arquitectura de contenedores.

#### Metodología de diseño de una saga en 5 pasos

Aplicar en orden estricto — no nombrar eventos antes de terminar el paso 2.

**Paso 1 — Definir el proceso en lenguaje de negocio:**
Describir cada paso con: quién lo ejecuta, qué hace, qué resultado espera el negocio si el paso es exitoso.
Ejemplo: *"(1) orders confirma el pedido. (2) payments captura el pago. (3) inventory reserva el stock."*

**Paso 2 — Trazar el grafo de compensación ANTES de nombrar eventos:**
Para cada paso que puede fallar, identificar:
- ¿Qué BC ejecuta la compensación de ese paso?
- ¿Qué evento dispara esa compensación?
- ¿Qué evento confirma que la compensación fue exitosa?

Si un paso no puede fallar o no modifica estado persistente, no necesita compensación.
Registrar en una tabla antes de continuar:

| Paso | Falla posible | BC compensador | Disparador de compensación | Confirmación |
|------|--------------|----------------|---------------------------|--------------|
| payments captura pago | PaymentFailed | payments | OrderCancelled (emitido por orders al cancelar) | PaymentRefunded |
| inventory reserva stock | StockReservationFailed | inventory | PaymentFailed (emitido por payments) | StockReleased |

**Paso 3 — Nombrar todos los eventos en una tabla global:**
Cada evento es globalmente único, PascalCase, en pasado. Construir la tabla:

| Paso | Evento de éxito | Evento de fallo | Evento de compensación |
|------|----------------|----------------|------------------------|
| 1 — orders | OrderPlaced | — | — |
| 2 — payments | PaymentCaptured | PaymentFailed | PaymentRefunded |
| 3 — inventory | StockReserved | StockReservationFailed | StockReleased |

**Paso 4 — Escribir `system.yaml#/sagas` desde la tabla:**
- `trigger.event` = evento del primer paso (generalmente emitido por el BC iniciador)
- `steps[].triggeredBy` = evento de éxito del paso anterior (o el trigger para el paso 1)
- `steps[].onSuccess` = evento de éxito de este paso
- `steps[].onFailure` = evento de fallo de este paso (si puede fallar)
- `steps[].compensation` = evento de compensación de este paso (si existe)

**Paso 5 — Construir la matriz published/consumed por BC y verificar completitud:**

Para cada BC participante, derivar qué publica y qué consume:

| BC | Consume (triggeredBy / compensation-trigger) | Publica (onSuccess / onFailure / compensation) |
|----|---------------------------------------------|-----------------------------------------------|
| orders | — | OrderPlaced |
| payments | OrderPlaced | PaymentCaptured, PaymentFailed, PaymentRefunded |
| inventory | PaymentCaptured, PaymentFailed | StockReserved, StockReservationFailed, StockReleased |

> **Regla crítica — los listeners de compensación no se generan automáticamente:**
> Si el paso 2 de inventory tiene `compensation: StockReleased`, el evento que *dispara* esa
> compensación es el `onFailure` del paso siguiente (ej: `PaymentFailed`). El BC `inventory`
> **debe declarar explícitamente `PaymentFailed` en su `consumed[]` con un UC** (`ReleaseStock`).
> El generador de código NO crea ese listener a partir del campo `compensation` de `system.yaml` —
> solo lo usará para anotar el UC con `@SagaStep` si el UC ya existe y está declarado.
> Sin esa declaración explícita, no hay listener y la compensación nunca se ejecuta.

Checklist de completitud antes de avanzar al Paso 2 táctico:
- [ ] Cada `triggeredBy` de cada paso → está en `consumed[]` del BC receptor con un UC con `sagaStep`
- [ ] Cada `compensation` → el evento que lo *activa* está en `consumed[]` del BC compensador con un UC
- [ ] El `correlationId` (ej: `orderId`) viaja en el payload de **todos** los eventos de la saga
- [ ] El payload de cada evento de compensación incluye el ID del recurso a revertir (ej: `reservationId`)
- [ ] `infrastructure.reliability.outbox: true` y `consumerIdempotency: true` activados en `system.yaml`
- [ ] Considerar `outboxRetentionDays` ≥ 1 (sin él, `outbox_event` crece indefinidamente en producción)
- [ ] Considerar `processedEventRetentionDays` ≥ 1 — valor > max-redelivery-timeout del broker (sin él, `processed_event` crece indefinidamente en producción)

#### Lo que el generador produce para las sagas declaradas

**Solo coreografía es soportada.** El generador produce únicamente sagas `style: choreography`.
Las sagas orquestadas (con coordinador central y estado de saga persistido) no son soportadas.

Cuando `system.yaml` contiene `sagas[]` no vacío, el generador produce estos artefactos compartidos:

| Artefacto | Ruta | Descripción |
|---|---|---|
| `SagaStep.java` | `shared/domain/annotations/` | Anotación custom con enum `Role` (TRIGGER / SUCCESS / FAILURE / COMPENSATION) |
| `CorrelationContext.java` | `shared/infrastructure/correlation/` | ThreadLocal + MDC para propagar `correlationId` entre hops async |
| `CorrelationFilter.java` | `shared/infrastructure/web/` | Filtro HTTP que extrae / genera `X-Correlation-Id` en cada request |
| `{SagaName}Steps.java` | `shared/application/sagas/` | Una por saga — constantes del nombre de saga y de los eventos por paso |

El generador también inyecta `@SagaStep` en los listeners y handlers de cada BC participante,
basándose en un **índice de eventos** construido automáticamente desde `system.yaml#/sagas`.
La condición para que la anotación aparezca en un BC es **dual**:
1. El evento debe estar en `system.yaml#/sagas` (en `trigger.event`, `onSuccess`, `onFailure` o `compensation`).
2. El evento debe estar declarado en `domainEvents.published[]` o `domainEvents.consumed[]`
   del `{bc}.yaml` de ese BC (responsabilidad del Paso 2 — Diseño Táctico).

Si un evento aparece en `system.yaml` pero **NO** en el `{bc}.yaml` correspondiente → el generador
no produce listener ni handler para ese evento y la anotación `@SagaStep` no se emite.
**No hay error de build** — el índice simplemente no encuentra match y la anotación se omite silenciosamente.

**Efecto colateral importante:** cuando `sagas[]` es no vacío (aunque sea un solo paso),
`sagasEnabled=true` en **todos** los BCs del proyecto. Esto significa que `CorrelationContext.set()`
y `CorrelationContext.clear()` se inyectan en **todos** los listeners del proyecto — no solo en los
de los BCs participantes. Es el mecanismo que garantiza correlación end-to-end sin configuración
extra por BC.

---

### 2.6 Auditoría de Completitud de Integraciones — OBLIGATORIA ANTES DE GENERAR ARTEFACTOS

Este paso es **no omitible**. Antes de escribir cualquier artefacto, construye internamente
la **Matriz de Integraciones** y ejecúta los cinco checklists que siguen. El objetivo es
garantizar que `integrations[]` en `system.yaml` cubra el 100% de las comunicaciones
necesarias para que el sistema cumpla con los requerimientos del negocio.

Si al ejecutar cualquier checklist descubres una integración faltante, agrégala al diseño
**antes** de generar los artefactos. Nunca dejes una integración faltante para después.

---

#### Paso A — Construir la Matriz de Publicación/Consumo

Para cada BC del diseño, lista mentalmente (o en un borrador interno):

| BC | Eventos que publica | BCs / actores que los necesitan |
|----|--------------------|---------------------------------|
| orders | OrderPlaced, OrderConfirmed, OrderCancelled | inventory, delivery, invoicing, notifications |
| inventory | StockReserved, StockReservationFailed, StockReleased | orders, payments |
| … | … | … |

**Regla:** Cada fila de esta matriz debe tener al menos una entrada en `integrations[]`.
Si un BC publica un evento y ningún BC lo consume → o el evento sobra o falta un
consumidor. Si un BC necesita datos de otro y no hay integración → falta una integración
sincrónica o un evento de propagación.

---

#### Paso B — Checklist del Flujo de Valor Principal (Happy Path)

Traza el flujo de valor principal paso a paso (el que define la propuesta de valor del
negocio). Para **cada transición entre pasos**, verifica que exista una integración en
`integrations[]`.

Ejemplo de traza para una plataforma de ecommerce:
```
Cliente hace checkout →
  orders emite OrderPlaced →
    ¿inventory lo consume? ✓/✗  →  si ✗ → agregar integración
  inventory emite StockReserved →
    ¿payments lo consume? ✓/✗   →  si ✗ → agregar integración
  payments emite PaymentApproved →
    ¿orders lo consume? ✓/✗     →  si ✗ → agregar integración
  orders emite OrderConfirmed →
    ¿delivery lo consume? ✓/✗   →  si ✗ → agregar integración
```

**Señal de fallo:** Si una transición del flujo de valor no tiene integración
correspondiente, el sistema no puede cumplir el flujo principal del negocio. Crítico.

---

#### Paso C — Checklist de Flujos de Excepción y Compensación

Para cada fallo identificado en el saga (§2.5) y para cada flujo de excepción del
negocio, verifica que exista la integración de compensación correspondiente:

| Evento de fallo | BC emisor | BC consumidor | ¿Integración existe? |
|----------------|-----------|---------------|---------------------|
| StockReservationFailed | inventory | orders | ✓/✗ |
| PaymentFailed | payments | orders | ✓/✗ |
| OrderCancelled | orders | inventory (liberar stock) | ✓/✗ |
| OrderCancelled | orders | delivery (cancelar entrega post-confirmación) | ✓/✗ |

**Regla:** Cada evento de compensación en `sagas[].steps[].compensation` y cada
`onFailure` **debe** tener una entrada en `integrations[]` desde el BC que lo emite
hacia todos los BCs que reaccionan a él.

---

#### Paso D — Checklist de Fan-out de Notificaciones

Si el sistema tiene un BC de notificaciones (o mecanismo equivalente), verifica que
**todos los eventos relevantes para el cliente o el operador** tengan su integración
hacia `notifications`.

Para cada hito del ciclo de vida del pedido/servicio/recurso principal, pregunta:
- ¿El cliente necesita saber que esto ocurrió? → ¿Hay integración `from: {bc}, to: notifications`?
- ¿El operador / administrador necesita saber? → ¿Hay integración hacia backoffice/notifications?

**Eventos de negocio que típicamente disparan notificaciones al cliente:**
- Confirmación de pedido / pago exitoso
- Cancelación de pedido / fallo de pago
- Asignación de conductor / inicio de entrega
- Entrega completada / lista para retiro

Si alguno de estos hitos ocurre en el sistema pero no hay integración hacia notifications,
agrégala. Los eventos informativos no requieren compensación — pero sí requieren integración.

---

#### Paso E — Checklist de Integraciones con Sistemas Externos

Para cada `external_system` declarado en el diseño, verifica que exista **exactamente
una integración ACL** que lo conecte con el BC interno responsable:

| Sistema Externo | BC responsable | ¿Integración ACL existe? | Canal |
|----------------|----------------|--------------------------|-------|
| payment-gateway | payments | ✓/✗ | http |
| invoicing-system | invoicing | ✓/✗ | http |
| sms-provider | notifications | ✓/✗ | http |
| … | … | … | … |

**Regla:** Si un `external_system` no tiene integración ACL → falta la integración.
Si hay una integración con un externo pero no aparece en `external_systems[]` → agregar
el sistema externo. Ambas secciones deben estar en sincronía.

---

#### Paso F — Verificación de Cobertura Cruzada por BC

Para cada BC del sistema, responde estas cuatro preguntas. Si alguna respuesta es NO,
agrega la integración faltante antes de continuar:

| Pregunta | Por qué importa |
|----------|----------------|
| ¿Cada evento que produce este BC tiene al menos un consumidor declarado en `integrations[]`? | Sin consumidor, el evento es letra muerta |
| ¿Cada evento que consume este BC tiene una entrada `from: {productor}` en `integrations[]`? | Sin entrada, la dependencia es implícita y no trazable |
| ¿Si este BC necesita datos en tiempo real de otro BC, existe una integración sincrónica (HTTP/gRPC)? | Las integraciones síncronas son tan importantes como las asíncronas |
| ¿Si este BC es del tipo Generic o Supporting que delega a un externo, tiene su ACL declarada? | Sin ACL, el dominio interno está acoplado al modelo del externo |

---

#### Paso G — Dependencias de Datos Autoritativos (Snapshot at Write Time)

Este paso detecta una categoría de integración sincrónica que el Paso F raramente captura
porque su formulación es genérica: cuando un agregado **congela un valor** proveniente
del modelo autoritativo de otro BC en el momento de su creación (snapshot inmutable).

**El patrón de riesgo:** El patrón tiene dos variantes:
- **Datos monetarios / precio** (precio, monto, tasa): si el backend acepta el valor
  desde el request del cliente sin verificarlo, cualquier usuario técnico puede manipular
  el payload y comprar a $0 o transferir montos arbitrarios. Es el patrón OWASP A04
  (Insecure Design) más frecuente en plataformas de comercio.
- **Datos de identidad / dirección** (dirección de entrega, nombre, datos de perfil):
  si el agregado no lee el valor del BC autoritativo en el momento de la escritura, la
  dirección almacenada puede divergir de la real del cliente, causando entregas fallidas,
  inconsistencias en tracking o discrepancias en facturación.

Ambas variantes deben detectarse en el Paso 1, no en código.

**Señal de detección:** Busca en los agregados campos que representen valores "congelados"
al momento de la transacción — tanto monetarios (precio, monto) como no monetarios
(dirección de entrega, datos de perfil, nombre registrado). Para cada uno, aplica este test:

| Pregunta | Si NO → |
|----------|---------|
| ¿El backend obtiene este valor del BC autoritativo, no del request del cliente? | Riesgo de fraude — el cliente nunca es fuente de precios ni montos |
| ¿Existe una integración `customer-supplier / http` del BC consumidor al autoritativo? | Agregar la integración antes de continuar |

**Ejemplos canónicos de campos snapshot — siempre requieren integración hacia el BC autoritativo:**

| Campo snapshot en el agregado | BC consumidor | BC autoritativo | Tipo | Integración requerida |
|-------------------------------|---------------|-----------------|------|-----------------------|
| `OrderLine.unitPrice` | orders | catalog (Product.price) | 💰 Monetario | `orders → catalog, customer-supplier, http` |
| `Payment.amount` | payments | orders (Order.total) | 💰 Monetario | `payments → orders, customer-supplier, http` |
| `InvoiceLine.unitPrice` | invoicing | orders (OrderLine.price) | 💰 Monetario | `invoicing → orders, customer-supplier, http` |
| `Order.deliveryAddress` | orders | customers (Address) | 🏠 Identidad | `orders → customers, customer-supplier, http` |

**Regla:** El cliente envía solo identificadores (IDs y cantidades), nunca valores
monetarios ni datos que el sistema puede obtener de forma independiente. El BC que
crea el snapshot es el único responsable de leer el valor autoritativo.

> Los valores de la columna "Integración requerida" son el punto de partida. El canal
> y patrón definitivos los decide el diseñador en el **Paso H** — incluyendo para datos
> monetarios, donde el agente presenta el riesgo de fraude explícitamente pero no toma
> la decisión unilateralmente.

---

#### Paso H — Presentación de Local Read Model al Diseñador (Obligatorio)

Para **toda** integración `customer-supplier / http` detectada en los pasos anteriores
donde el BC consumidor **solo lee** datos (no los modifica), usar `vscode_askQuestions` (o en texto directo)
para presentar los trade-offs al diseñador. **El agente nunca toma esta decisión
unilateralmente** — es siempre el diseñador quien elige, incluso para datos monetarios.

Los trade-offs a presentar en cada pregunta son:

| | HTTP Síncrono | Local Read Model |
|---|---|---|
| **Dato** | Siempre fresco (tiempo real) | Copia local con lag < 1–2 s |
| **Disponibilidad** | Si el BC fuente cae, el flujo falla | Resiliente ante caída del fuente |
| **Complejidad** | Simple — una llamada HTTP | Requiere que el BC fuente publique eventos de cambio |
| **Consistencia** | Estricta | Eventual (lag típico < 1–2 s) |
| **Riesgo (solo datos monetarios)** | Ninguno — precio leído en tiempo real antes del cobro | **OWASP A04**: ventana de inconsistencia podría usarse para comprar a precio desactualizado |

Agrupa todas las preguntas LRM de la misma sesión en **una sola llamada** `vscode_askQuestions` (o en texto directo).

**Formato para integraciones de datos NO monetarios** (dirección, perfil, nombre, referencia):

```
header: lrm_{from}_{to}    # ej: lrm_orders_customers
question: >
  La integración {from} → {to} (HTTP) puede reemplazarse por un Local Read Model.
  ¿Qué patrón prefieres para esta integración?
options:
  - label: "Mantener HTTP síncrono"
    description: >
      {from} llama a {to} en tiempo real en cada operación.
      Ventaja: dato siempre fresco. Riesgo: si {to} cae, {from} falla también.
  - label: "Implementar Local Read Model (evento)"
    description: >
      {to} publica eventos de cambio; {from} mantiene una copia local.
      Ventaja: {from} es resiliente ante caída de {to}. Riesgo: consistencia
      eventual — lag típico < 1–2s.
allowFreeformInput: false
```

**Formato para integraciones de datos MONETARIOS o PRECIO** (unitPrice, amount, tasa, tarifa):
Presentar los mismos trade-offs más la advertencia de riesgo OWASP A04 de forma explícita.
El diseñador toma la decisión final con pleno conocimiento del riesgo.

```
header: lrm_{from}_{to}    # ej: lrm_orders_catalog
question: >
  La integración {from} → {to} lee el campo {campo} (dato monetario/precio).
  Puede mantenerse como HTTP o reemplazarse por un Local Read Model.
  ⚠️ ADVERTENCIA DE SEGURIDAD (OWASP A04): si se usa LRM, existe una ventana de
  consistencia eventual durante la cual el precio en la copia local podría estar
  desactualizado. Un atacante podría colocar un pedido en ese lag para comprar a
  un precio manipulado o desactualizado. Con HTTP el precio se lee en tiempo real
  y no existe esta ventana.
  ¿Qué patrón prefieres conociendo este riesgo?
options:
  - label: "Mantener HTTP síncrono (recomendado para datos monetarios)"
    description: >
      {from} lee {campo} de {to} en tiempo real en cada operación.
      Ventaja: precio siempre autoritativo, sin ventana de ataque.
      Riesgo: si {to} cae, {from} falla también.
    recommended: true
  - label: "Implementar Local Read Model (acepto el riesgo OWASP A04)"
    description: >
      {to} publica eventos de cambio de precio; {from} mantiene una copia local.
      Ventaja: {from} es resiliente ante caída de {to}.
      ⚠️ Riesgo: consistencia eventual introduce ventana de fraude potencial.
      Requiere mitigación adicional en el Paso 2 (ej: validación cruzada al checkout).
allowFreeformInput: false
```

**Según la respuesta del diseñador:**

- **Mantener HTTP**: dejar la integración como está. Registrar en `notes` que se evaluó
  LRM y se descartó, indicando el motivo del diseñador.

- **Implementar LRM**: actualizar `system.yaml`:
  - Eliminar la integración `from: {consumidor}, to: {fuente}, channel: http`
  - Agregar integración `from: {fuente}, to: {consumidor}, pattern: event, channel: message-broker`
    con los contratos de eventos de cambio correspondientes (ej: `ProductPriceChanged`)
  - Si el dato es monetario, agregar en `notes` la advertencia de riesgo OWASP A04 y
    la mitigación que deberá implementarse en el Paso 2

```yaml
# Ejemplo: orders → catalog HTTP mantenido (decisión del diseñador tras evaluar trade-offs)
- from: orders
  to: catalog
  pattern: customer-supplier
  channel: http
  contracts:
    - validateProductsAndPrices
  notes: >
    Mandatory HTTP for monetary snapshot (OrderLine.unitPrice). Designer evaluated
    LRM trade-offs including OWASP A04 fraud risk and chose HTTP. Price is always
    read from catalog in real time at order placement — no inconsistency window.

# Ejemplo: orders → catalog reemplazado por LRM (diseñador aceptó el riesgo OWASP A04)
- from: catalog
  to: orders
  pattern: event
  channel: message-broker
  contracts:
    - name: ProductPriceChanged
      channel: catalog.product.price.changed
  notes: >
    orders maintains a local read model (CatalogProductSnapshot) fed by catalog events.
    Designer chose LRM after explicit OWASP A04 trade-off evaluation. Eventual
    consistency accepted. Step 2 MUST implement cross-validation at checkout to
    mitigate the fraud window risk.
```

> **Referencia táctica:** En el Paso 2 (Diseño Táctico), el skill `ddd-tactical-design`
> guiará la implementación completa del patrón mediante su `references/local-read-model.md`,
> incluyendo el agregado `readModel: true`, los event-triggered UCs y los diagramas de sincronización.
> Si el diseñador eligió LRM para un dato monetario, el Paso 2 deberá incluir explícitamente
> la mitigación de riesgo OWASP A04 (ej: validación cruzada del precio en el use case de checkout).

---

#### Resultado Esperado de la Auditoría

Al terminar los pasos A-G, `integrations[]` debe contener:
1. Todas las integraciones del flujo de valor principal (happy path)
2. Todas las integraciones de compensación y flujos de excepción
3. Todas las integraciones de fan-out hacia notifications
4. Todas las integraciones ACL con sistemas externos
5. Todas las dependencias de ciclo de vida (`ddd-domain-analysis` §2.4)
6. Sin integraciones huérfanas (todo evento publicado tiene al menos un consumidor declarado)
7. Todas las integraciones sincrónicas de datos autoritativos (snapshot at write time, §Paso G)

**Si alguna de estas categorías está incompleta → NO generar artefactos hasta completarla.**
