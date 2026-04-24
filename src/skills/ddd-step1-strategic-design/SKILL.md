---
name: ddd-step1-strategic-design
description: >
  Ejecuta el Paso 1 del framework de diseño de sistemas con DDD: Diseño Estratégico.
  Analiza el contexto de negocio ingresado, identifica Bounded Contexts, Agregados y
  relaciones, y genera los cuatro artefactos canónicos: system.yaml, system-spec.md y
  system-diagram.mmd en arch/system/, más AGENTS.md en la raíz del proyecto.
  Usar SIEMPRE que el usuario quiera diseñar un nuevo sistema, plataforma, aplicación
  o dominio de negocio desde cero. También aplica cuando el usuario diga frases como
  "quiero diseñar", "necesito modelar un sistema", "vamos a hacer el paso 1", "analiza
  este negocio", "define los bounded contexts", "crea la arquitectura de", o cuando
  proporcione una descripción de un negocio y pida estructurarla arquitectónicamente.
  No esperar que el usuario use terminología DDD — si describe un negocio o sistema,
  este skill debe activarse.
---

# DDD Paso 1 — Diseño Estratégico

Este skill produce el diseño estratégico completo de un sistema basado en Domain-Driven
Design. Al finalizar, existen cuatro artefactos:

- `arch/system/system.yaml` — fuente de verdad estructurada (input para generadores en pasos siguientes)
- `arch/system/system-spec.md` — narrativa detallada por Bounded Context
- `arch/system/system-diagram.mmd` — diagrama C4 Contenedores en Mermaid
- `AGENTS.md` — contexto consolidado del sistema para agentes de IA

---

## Tu Rol Durante Esta Sesión

Asumes **dos voces expertas simultáneas** durante todo el proceso de diseño. Ambas deben
estar presentes al identificar BCs, definir fronteras, clasificar dominios y justificar
decisiones. No son roles alternativos — son una tensión productiva que produce mejores
diseños.

### Voz 1: Experto de Negocio del Dominio

Conoces el negocio desde adentro. Piensas en términos de valor, flujos reales, cómo
operan las personas en el día a día, qué dolores existen, qué datos se manejan.

- Identificas los eventos que el negocio reconocería como significativos ("el pedido fue confirmado", "el stock se agotó")
- Cuestionas si los nombres de BCs y agregados reflejan el lenguaje que usa el negocio, no jerga técnica
- Detectas qué es realmente diferenciador para el negocio vs qué es plomería genérica
- Piensas en el cliente final y en los operadores internos, no solo en el sistema
- Señalas flujos de excepción relevantes: ¿qué pasa cuando falla el pago? ¿cuando el stock se agota en checkout?

### Voz 2: Ingeniero Senior de Diseño de Sistemas DDD

Conoces los principios DDD y sus trade-offs. Sabes cuándo un BC es demasiado grande,
cuándo una integración sincrónica creará acoplamiento problemático, cuándo un agregado
esconde dos agregados distintos.

- Evalúas la dirección de dependencias entre BCs (Core no depende de Supporting)
- Decides si una integración es sincrónica o asíncrona basándote en la necesidad real del flujo
- Dimensionas correctamente los BCs: ni demasiado grandes ni demasiado pequeños
- Aplicas ACL en toda integración con sistemas externos
- Seleccionas los defaults de infraestructura que mejor se alinean con el contexto del negocio

Cuando las dos voces produzcan tensión (ej: el negocio quiere todo junto, la ingeniería
quiere separarlo), **explicitarlo al usuario** como parte del análisis. Esa tensión es
información de diseño, no un problema a ocultar.

---

## Fase 1: Recolección de Contexto

Antes de diseñar, asegúrate de tener suficiente información. El usuario puede entregar
contexto libre o responder preguntas. Evalúa qué tienes y qué falta.

### Información mínima requerida para comenzar

| Categoría | Por qué importa |
|-----------|----------------|
| Modelo de negocio | Define si hay marketplace, tienda propia, B2B, B2C — cambia los BCs radicalmente |
| Actores principales | Quién usa el sistema determina los flujos centrales |
| Flujo principal de valor | La secuencia de eventos que genera el valor del negocio |
| Medios de pago | Determina si Pagos es simple o complejo |
| Entrega/Fulfillment | ¿Físico, digital, servicio? Define si existe un BC de Despacho/Logística |
| Funcionalidades esenciales | Diferencia el core del supporting |
| Sistemas externos ya existentes | Define qué se integra vs qué se construye |

### Cuándo hacer preguntas vs cuándo inferir

**REGLA OBLIGATORIA:** Antes de generar cualquier artefacto, usa `vscode_askQuestions` para
cubrir **todas las dimensiones críticas que el usuario NO haya respondido explícitamente**
en su prompt. No inferir dimensiones que cambiarían la estructura de BCs si el usuario
las respondiera de forma distinta.

Dimensiones que SIEMPRE requieren respuesta explícita del usuario (no inferir):
- **Modelo de negocio**: tienda propia vs marketplace — cambia radicalmente los BCs Core
- **Segmento**: B2C vs B2B vs ambos
- **Fulfillment**: entrega física propia, tercerizada, digital, o presencial
- **Funcionalidades core del lanzamiento**: evita modelar BCs para features que no van en V1

Dimensiones que SÍ puedes inferir y documentar como supuesto en `notes`:
- Tipo de infraestructura (tipo de broker y tipo de BD) — aplicar defaults (`messageBroker: true` si hay async, `database.type: relational`)
- Sistemas externos genéricos (ej: pasarela de pago) cuando el dominio los implica claramente
- Actores secundarios obvios del dominio (ej: administrador interno)

Cuando infiras, registra el supuesto en el campo `notes` del artefacto correspondiente.
Agrupa todas las preguntas en una **sola llamada** `vscode_askQuestions` — nunca en múltiples rondas.

### Preguntas clave a hacer (adapta según lo que ya sabes)

Para sistemas de venta/ecommerce/tickets/seguros/etc., las dimensiones críticas son:

1. **Modelo de negocio**: ¿Tienda propia, marketplace, híbrido?
2. **Segmento de clientes**: ¿B2C, B2B, ambos?
3. **Fulfillment**: ¿Entrega física propia, tercerizada, digital, presencial?
4. **Medios de pago**: ¿Cuáles? (define la complejidad del BC Pagos)
5. **Inventario**: ¿Propio centralizado, distribuido, sin inventario?
6. **Funcionalidades core del lanzamiento**: (multiselect — evita sobre-ingeniería)
7. **Sistemas externos ya definidos**: ¿ERP, pasarela de pago, operador logístico?
8. **Tipo de base de datos**: ¿relacional, documental, clave-valor, grafos? (o asumir `relational` por default)
   — La tecnología concreta (PostgreSQL, MySQL, etc.) se decide en el generador de código, no aquí.

Usa opciones cerradas con `allowFreeformInput: true` para agilizar. Agrupa en una sola
llamada `vscode_askQuestions` con todas las preguntas pendientes.

---

## Fase 2: Análisis y Clasificación del Dominio

Con el contexto completo, realiza este análisis antes de nombrar BCs:

### 2.1 Event Storming Mental

Identifica en el contexto los eventos de negocio naturales (hechos pasados significativos).
Son verbos en pasado que el negocio reconocería:

- ¿Qué hechos importantes ocurren en el flujo de valor?
- ¿Dónde cambia el "dueño" de una entidad? (ej: el pedido pasa de cliente a logística)
- ¿Dónde el lenguaje cambia? (ej: "producto" en catálogo ≠ "ítem" en pedido)

Los cambios de lenguaje y de responsabilidad revelan las fronteras naturales de los BCs.

### 2.2 Clasificación DDD

Clasifica cada BC candidato:

| Tipo | Criterio | Inversión de diseño |
|------|----------|---------------------|
| **Core Domain** | Ventaja competitiva, diferenciador del negocio | Alta — máximo rigor |
| **Supporting Domain** | Necesario para el core, operación propia | Media |
| **Generic Domain** | Resuelto con 3rd party o librería | Baja — delegar |

### 2.3 Reglas para Agregados en Paso 1

En este paso, los agregados son de nivel estratégico:
- Nombra el agregado y su Root — no más
- Lista las entidades internas relevantes (2-4 como máximo)
- NO incluyas Value Objects (son diseño táctico del Paso 2)
- NO incluyas Domain Events internos (van en Paso 2)
- Los contratos de integración entre BCs sí se capturan en `integrations`

### 2.3.1 Checklist Obligatorio — Entidades Candidatas a Agregado

Después de listar las entidades de cada agregado, ejecutar este checklist sobre
**cada entidad** antes de continuar. Es un paso no omitible.

Para cada entidad listada, responder las tres preguntas:

| Pregunta | Si la respuesta es SÍ → |
|----------|------------------------|
| ¿Puede existir sin el Aggregate Root actual? (ej: ¿Category existe antes de que exista ningún Product?) | Candidata a agregado propio |
| ¿Es referenciada por múltiples instancias del Root? (ej: varios Products comparten la misma Category) | Candidata a agregado propio |
| ¿Tiene operaciones CRUD independientes desde la API o UI? (ej: el admin gestiona Categories por separado) | Candidata a agregado propio |

**Regla de decisión:** Si al menos DOS de las tres preguntas son SÍ → promover a agregado
separado dentro del mismo BC. La cadena causal obligatoria es:
> ciclo de vida independiente → agregado propio → repositorio propio
>
> Nunca al revés: no mantener algo como entidad interna solo porque "parece pequeño".

**Ejemplos canónicos de entidades que siempre deben ser agregados:**
| Entidad mal clasificada | BC | Motivo |
|-------------------------|----|--------|
| Category dentro de Product | catalog | Existe antes que Product, es compartida por muchos Products, tiene CRUD propio |
| NotificationTemplate dentro de Notification | notifications | Existe y se edita independientemente de cualquier Notification enviada |
| Address dentro de Customer | customers | Puede tener CRUD propio ("mis direcciones") — evaluar en el contexto del negocio específico |

### 2.4 Revisión de Dependencias Implícitas por Ciclo de Vida

Ejecutar **después** de clasificar los BCs y **antes** de generar artefactos.
El flujo de valor del cliente no siempre revela integraciones entre BCs — este
checklist fuerza a la superficie las dependencias estructurales implícitas.

**Para cada BC Core que tenga agregados con ciclo de vida**, preguntar por cada BC Supporting:

- ¿Este BC Supporting administra entidades cuya **existencia** depende de que el
  agregado Core sea creado o activado?
  → Si sí: agregar integración `from: {core-bc}, to: {supporting-bc}, pattern: event` con el evento de activación.

- ¿Este BC Supporting administra entidades que deben **cerrarse o desactivarse**
  cuando el agregado Core se descontinúa o elimina?
  → Si sí: agregar integración `from: {core-bc}, to: {supporting-bc}, pattern: event` con el evento de cierre.

- ¿Este BC Supporting necesita **reaccionar** a transiciones de estado del Core
  para cumplir su propio propósito?
  → Si sí: integración `event` correspondiente a esa transición.

**Tabla de ejemplos canónicos de este patrón:**

| BC Core | Evento de ciclo de vida | BC Supporting afectado | Acción en Supporting |
|---------|------------------------|------------------------|----------------------|
| catalog (Product → ACTIVE) | ProductActivated | inventory | Crear StockItem |
| catalog (Product → DISCONTINUED) | ProductDiscontinued | inventory | Cerrar StockItem permanentemente |
| orders (Order → CONFIRMED) | OrderConfirmed | delivery | Crear DeliveryOrder |

> La fila `orders → delivery` suele ser visible en el flujo de valor principal.
> Las filas `catalog → inventory` representan el tipo de dependencia implícita que
> este checklist está diseñado específicamente para capturar.

**Señal de alerta:** Si un BC Supporting administra entidades que "representan" o
"trackean" algo definido en un BC Core, casi siempre existe una integración implícita
de ciclo de vida que debe declararse en `integrations`.

---

### 2.5 Identificación de Sagas por Coreografía

Después de mapear las dependencias implícitas (§2.4), examina el grafo de integraciones
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
donde el BC consumidor **solo lee** datos (no los modifica), usar `vscode_askQuestions`
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

Agrupa todas las preguntas LRM de la misma sesión en **una sola llamada** `vscode_askQuestions`.

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
      channel: catalog.product.price-changed
  notes: >
    orders maintains a local read model (CatalogProductSnapshot) fed by catalog events.
    Designer chose LRM after explicit OWASP A04 trade-off evaluation. Eventual
    consistency accepted. Step 2 MUST implement cross-validation at checkout to
    mitigate the fraud window risk.
```

> **Referencia táctica:** En el Paso 2 (Diseño Táctico), el skill `ddd-step2-tactical-design`
> guiará la implementación completa del patrón mediante `references/local-read-model.md`,
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
5. Todas las dependencias de ciclo de vida (§2.4)
6. Sin integraciones huérfanas (todo evento publicado tiene al menos un consumidor declarado)
7. Todas las integraciones sincrónicas de datos autoritativos (snapshot at write time, §Paso G)

**Si alguna de estas categorías está incompleta → NO generar artefactos hasta completarla.**

---

## Fase 3: Generación de Artefactos

Genera los tres artefactos en orden. Lee la referencia del schema antes de escribir:
→ Lee `references/system-yaml-schema.md` para el schema completo de system.yaml

### 3.1 system.yaml

> **PRE-REQUISITO OBLIGATORIO:** La Auditoría de Completitud de Integraciones (§2.6,
> Pasos A–F) debe estar completada antes de escribir este archivo. Si se detectaron
> integraciones faltantes durante la auditoría, deben estar incorporadas al diseño.
> No escribir `system.yaml` con `integrations[]` incompleto.

> **Idioma: INGLÉS obligatorio.** Todo el contenido del archivo — nombres de BCs,
> agregados, entidades, contratos, descripciones (`purpose`, `description`, `notes`) —
> debe escribirse en inglés. Este archivo es el input estructurado para los pasos
> siguientes de diseño táctico y generación de código; el inglés es la lengua franca
> del código y garantiza consistencia con los identificadores que se generarán.
>
> Los únicos valores en español permitidos son los comentarios de cabecera del archivo
> (líneas con `#`) si el equipo lo prefiere, pero **ningún campo YAML**.

Estructura obligatoria con estas secciones en orden:

```
system:           → system identity
boundedContexts:  → BCs with aggregates (strategic level)
externalSystems:  → external systems referenced in integrations
integrations:     → communication map between BCs and externals
sagas:            → (opcional) sagas por coreografía que cruzan 3+ BCs
infrastructure:   → technology decisions from Step 1
```

**Defaults de infraestructura** (aplicar si el usuario no especifica):

| Campo | Default | Opciones válidas |
|-------|---------|-----------------|
| `deployment.strategy` | `modular-monolith` | modular-monolith \| microservices \| serverless |
| `deployment.architectureStyle` | `hexagonal` | hexagonal \| layered \| clean |
| `database.type` | `relational` | relational \| document \| key-value \| graph |
| `database.isolationStrategy` | `schema-per-bc` | schema-per-bc \| db-per-bc \| prefix-per-bc |
| `messageBroker` | `true` (si hay canales async) | true \| omitir si no hay message-broker |

Cuando apliques un default, docuéntalo en el campo `notes` de esa sección.
Si el diseño no tiene integraciones por eventos, omite `messageBroker`.
La tecnología concreta del broker y la base de datos (RabbitMQ, Kafka, PostgreSQL…) es decisión del generador de código (Fase 2) — no se declara en el Paso 1.

**Patrones de integración válidos:**

| Patrón | Cuándo usarlo |
|--------|--------------|
| `customer-supplier` | Un BC depende del modelo de otro, sincrónico |
| `event` | Comunicación asíncrona vía eventos de dominio |
| `acl` | Integración con sistema externo — siempre usar ACL |
| `shared-kernel` | Dos BCs comparten código (usar con precaución) |
| `open-host` | BC publica API estable para consumo externo |

**Canales válidos:** `http` \| `grpc` \| `message-broker` \| `websocket`

> **Formato de `contracts[]` según canal:**
> - `channel: http | grpc | websocket` → string camelCase: `iniciarCobro`
> - `channel: message-broker` → objeto con `name` (**inglés PascalCase obligatorio**) y `channel` (nombre exacto del canal AsyncAPI en kebab-case):
>   ```yaml
>   contracts:
>     - name: OrderConfirmed        # ← SIEMPRE inglés PascalCase — nunca español
>       channel: orders.order.confirmed
>   ```
>   **Regla de naming para `name`:** usar inglés PascalCase sin excepción, incluso si el
>   lenguaje ubícuo del equipo es español. Este nombre será idéntico al que aparecerá en
>   `domain_events` del `{bc-name}.yaml` en el Paso 2 y en el mensaje del AsyncAPI.
>   Una discrepancia de nombre entre `system.yaml` y los artefactos tácticos es un gap
>   estratégico que requiere `ddd-step1-refine`.
>   El campo `channel` del contrato debe coincidir exactamente con el canal definido
>   en el `{bc-name}-async-api.yaml` del BC emisor.
**Schema de `sagas[]` (solo si §2.5 identificó al menos un saga):**

```yaml
sagas:
  - name: CheckoutSaga                  # PascalCase, inglés
    description: >                      # proceso de negocio que coordina
    trigger:
      event: OrderConfirmed             # evento que inicia el saga
      bc: orders                        # BC que lo publica
    steps:
      - order: 1                        # posición en la cadena
        bc: payments                    # BC que ejecuta este paso
        triggeredBy: OrderConfirmed     # evento que activa el paso
        onSuccess: PaymentApproved      # evento emitido si el paso tiene éxito
        onFailure: PaymentFailed        # (opcional) evento emitido si el paso falla
        compensation: PaymentCancelled  # (opcional) evento que compensa este paso
      - order: 2
        bc: inventory
        triggeredBy: PaymentApproved
        onSuccess: StockReserved
        onFailure: StockReservationFailed
        compensation: StockReleased
```

Reglas del schema:
- Todos los nombres de eventos siguen la misma regla **PascalCase inglés** que los contratos de integración.
- Cada evento en `onSuccess`, `onFailure` y `compensation` debe existir como contrato en la integración `from: {bc}, to: ..., pattern: event` del BC emisor (agregar si falta).
- `onFailure` y `compensation` son opcionales por paso: omitir si el paso no puede fallar o si no tiene compensación.
### 3.2 system-spec.md

Para cada BC, escribe una sección con esta estructura exacta:

```markdown
## BC: [Nombre]

### Propósito
[Una frase clara]

### Responsabilidades
[Lista de lo que hace]

### No Responsabilidades
[Lista de lo que NO hace — límites explícitos]

### Lenguaje Ubícuo
| Término | Definición en este BC |

### Agregados Principales
| Agregado | Root | Entidades internas |

### Dependencias Externas
[Sistemas externos con los que se integra, o "Ninguna"]
```

La sección **"No Responsabilidades"** es tan importante como las responsabilidades.
Previene que el BC absorba lógica ajena durante el desarrollo.

Incluye al final un **Mapa de Integraciones — Resumen** en formato de texto con flechas
que muestre el flujo completo de un vistazo.

### 3.3 system-diagram.mmd

Usa siempre C4 Contenedores (L2). Estructura obligatoria:

```
C4Container
    title [Nombre del Sistema] — C4 Contenedores (L2)

    Person(...)          → actores humanos
    System_Ext(...)      → sistemas externos
    Boundary(b0, "...") { → límite del sistema
        Container(...)   → un Container por BC, con tipo y propósito
    }

    Rel(actor, bc, "acción")
    Rel(bc1, bc2, "contrato", "Sync / HTTP")
    Rel(bc3, bc4, "evento", "Event / Message Broker")
    Rel(bc, ext, "contrato", "ACL / HTTPS")

    %% ── Conexiones HTTP → azul ──────────────────────────────────
    UpdateRelStyle(bc1, bc2, $lineColor="royalblue", $textColor="royalblue")

    %% ── Conexiones por evento → naranja ─────────────────────────
    UpdateRelStyle(bc3, bc4, $lineColor="orange", $textColor="darkorange")
```

Convenciones de color obligatorias — aplícalas sin excepción:
- El label de cada `Container` incluye el tipo: Core, Supporting, Generic
- Las relaciones HTTP (`"Sync / HTTP"`) → **azul**: `UpdateRelStyle(from, to, $lineColor="royalblue", $textColor="royalblue")`
- Las relaciones por evento (`"Event / Message Broker"`) → **naranja**: `UpdateRelStyle(from, to, $lineColor="orange", $textColor="darkorange")`
- Las relaciones con externos (`"ACL / HTTPS"`) → sin `UpdateRelStyle` (color por defecto)
- Las relaciones de actores hacia BCs → sin `UpdateRelStyle` (color por defecto)
- Agrupa las relaciones de actores primero, luego las de BCs entre sí (HTTP, luego eventos), luego las externas
- Añade todos los `UpdateRelStyle` al final del archivo, agrupados por tipo con comentario `%% ──`:

```
    %% ── Conexiones HTTP → azul ──────────────────────────────────
    UpdateRelStyle(a, b, $lineColor="royalblue", $textColor="royalblue")
    UpdateRelStyle(c, d, $lineColor="royalblue", $textColor="royalblue")

    %% ── Conexiones por evento → naranja ─────────────────────────
    UpdateRelStyle(e, f, $lineColor="orange", $textColor="darkorange")
    UpdateRelStyle(g, h, $lineColor="orange", $textColor="darkorange")
```

### 3.4 AGENTS.md

Genera `AGENTS.md` en la **raíz del proyecto**. Es el punto de entrada de contexto
para cualquier agente de IA que trabaje en el repositorio en pasos futuros.

Estructura obligatoria:

```markdown
# AGENTS.md — Contexto del Sistema para Agentes de IA

> Este archivo es generado automáticamente en el Paso 1 — Diseño Estratégico.
> Proporciona el contexto necesario para que los agentes de IA entiendan el sistema
> antes de ejecutar cualquier tarea de diseño, generación de código o revisión.

## ¿Qué se está construyendo?
[Nombre del sistema] — [descripción del propósito de negocio en 2-3 oraciones]

## Modelo de Negocio
- **Tipo**: [marketplace / tienda propia / B2B / B2C / etc.]
- **Segmento**: [B2C / B2B / ambos]
- **Flujo principal de valor**: [descripción del flujo de una oración]

## Actores Principales
| Actor | Rol en el sistema |
|-------|------------------|

## Bounded Contexts
| BC | Tipo | Propósito |
|----|------|-----------|

## Glosario de Términos Clave
| Término | Definición |
|---------|------------|
[Incluye los términos más importantes del lenguaje ubícuo, priorizando los que
aparecen en múltiples BCs o que podrían ser ambiguos fuera de contexto]

## Integraciones con Sistemas Externos
| Sistema | Tipo de integración | BC responsable |
|---------|--------------------|----------------|

## Decisiones de Infraestructura (Paso 1)
- **Estrategia de deployment**: [valor]
- **Estilo arquitectónico**: [valor]
- **Base de datos**: [tipo: relational | document | key-value | graph] — [estrategia de aislamiento]
- **Message broker**: [requerido (true) / No aplica]

## Estado del Diseño
- **Paso completado**: Paso 1 — Diseño Estratégico
- **Fecha**: [fecha de generación]
- **Próximo paso**: Paso 2 — Diseño Táctico (seleccionar un BC para comenzar)

## Artefactos de Arquitectura
- `arch/system/system.yaml` — fuente de verdad estructurada
- `arch/system/system-spec.md` — especificación narrativa por BC
- `arch/system/system-diagram.mmd` — diagrama C4 Contenedores
```

Reglas para este artefacto:
- El glosario debe ser **auto-suficiente**: un agente sin contexto previo debe entender
  los términos sin leer otros archivos
- Prioriza claridad sobre exhaustividad — 8-12 términos clave, no el ubícuo completo
- La sección "¿Qué se está construyendo?" debe responder en lenguaje de negocio, no técnico
- Si se sobreescribe en un paso posterior, conservar el historial en "Estado del Diseño"

---

## Fase 4: Creación de Archivos

Crea el directorio `arch/system/` si no existe y genera los cuatro archivos:

```
[raíz del proyecto]/
├── AGENTS.md
└── arch/
    └── system/
        ├── system.yaml
        ├── system-spec.md
        └── system-diagram.mmd
```

Usa `create_file` para archivos nuevos. Si ya existen, confirma con el usuario antes
de sobreescribir — puede ser un diseño en progreso.

Or den de creación recomendado: `system.yaml` → `system-spec.md` → `system-diagram.mmd` → `AGENTS.md`
(AGENTS.md al final porque consolida información de los tres anteriores).

---

## Fase 5: Resumen Post-Generación

Al finalizar, presenta al usuario:

1. **Lista de BCs identificados** con su clasificación (Core/Supporting/Generic)
2. **Decisiones de diseño destacables** — explica 2-3 decisiones no triviales
   (ej: por qué Inventario publica hacia Catálogo y no al revés)
3. **Supuestos aplicados** — si inferiste algo, menciónalo explícitamente
4. **Defaults de infraestructura aplicados** — qué se asumió y por qué
5. **Artefactos generados** — lista los 4 archivos creados con sus rutas
6. **Siguiente paso** — ofrecer avanzar al Paso 2 con algún BC específico

Sé conciso. El resumen no es documentación — es orientación para la siguiente decisión.

---

## Principios de Calidad del Diseño

Estos principios guían las decisiones cuando el contexto es ambiguo:

**Tamaño de BCs:** Si un BC candidato tiene más de 4-5 agregados, probablemente
esconde dos BCs. Si tiene menos de 1 agregado, probablemente es una entidad dentro
de otro BC.

**Dirección de dependencias:** El Core Domain no debe depender de BCs Supporting.
Los Supporting dependen del Core, no entre sí (si pueden evitarlo).

**ACL en integraciones externas:** Toda integración con un sistema externo debe
tener una ACL. Nunca el dominio interno debe conocer el modelo del sistema externo.

**Eventos vs sincrónico:** Si la respuesta inmediata es necesaria para continuar el
flujo → sincrónico (HTTP). Si el receptor puede procesar cuando pueda → evento.

**Autoridad de datos en transacciones:** Un BC que crea registros con valores monetarios
o cantidades críticas (precio de venta, monto a cobrar) debe leerlos del BC autoritativo
via integración sincrónica — nunca aceptarlos del request del cliente. El cliente envía
solo identificadores (IDs). Este principio previene fraude por manipulación de payload
(OWASP A04) y debe reflejarse como una integración `customer-supplier / http` declarada
en `integrations[]` (ver §2.6 Paso G).

**Monolito modular + hexagonal:** El diseño es agnóstico a tecnología. Los puertos
(interfaces) son el dominio. Los adaptadores son infraestructura. Esta separación
permite extraer BCs como microservicios sin tocar el dominio.
