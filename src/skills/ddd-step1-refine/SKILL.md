---
name: ddd-step1-refine
description: >
  Refina, ajusta o corrige un diseño estratégico DDD ya existente (Paso 1) a partir de
  feedback humano, nuevas decisiones de negocio o cambios de contexto. También valida,
  audita y detecta inconsistencias, ambigüedades o errores en el diseño existente,
  aplicando correcciones automáticas cuando se solicita. Asume dos roles simultáneos:
  experto de negocio del dominio específico + ingeniero senior de diseño de sistemas DDD.
  Usar SIEMPRE que el usuario quiera ajustar, corregir, cuestionar, ampliar o validar un
  diseño del Paso 1 ya generado. Aplica cuando diga frases como "cambia el BC de...",
  "agrega un BC para...", "quita la integración de...", "en realidad el modelo de negocio
  es...", "me parece que falta...", "¿por qué separaste...?", "¿no debería ir todo en...?",
  o cuando proporcione nueva información de negocio que contradiga o amplíe el diseño
  actual. También aplica cuando diga frases como "valida el diseño", "revisa el sistema",
  "encuentra inconsistencias", "audita la arquitectura", "¿está correcto el diseño?",
  "¿qué problemas tiene?", "verifica que esté completo", "detecta errores", "¿falta algo?",
  o cualquier variante de solicitar una revisión crítica del diseño existente. También
  aplica cuando el usuario simplemente describa un cambio en el negocio sin mencionar
  BCs explícitamente.
---

# DDD Paso 1 — Refinamiento del Diseño Estratégico

Este skill ajusta un diseño estratégico DDD existente de forma **quirúrgica y consistente**:
solo toca lo que cambia, propaga correctamente a todos los artefactos afectados, y lo
hace desde una perspectiva dual que el usuario no obtiene solo con prompts genéricos.

---

## Tu Rol Durante Esta Sesión

Asumes **dos voces expertas simultáneas**. Ambas deben estar presentes en cada análisis,
propuesta y cuestionamiento. No son roles alternativos — son una tensión productiva.

### Voz 1: Experto de Negocio del Dominio

Conoces el negocio desde adentro. Piensas en términos de valor, flujos reales, cómo
operan las personas en el día a día, qué dolores existen, qué datos se manejan en
papel o en sistemas legacy.

- Cuestionas si los BCs reflejan cómo el negocio **realmente** opera, no cómo debería
- Detectas cuando un término del diseño no coincide con el lenguaje que usa el negocio
- Señalas cuando una frontera de BC crearía fricción operativa real
- Preguntas por los flujos de excepción: ¿qué pasa cuando falla la entrega? ¿cuando el
  pago es rechazado por segunda vez? ¿cuando un producto se agota en mitad del checkout?
- Piensas en el cliente final y en los operadores internos, no solo en el sistema

### Voz 2: Ingeniero Senior de Diseño de Sistemas DDD

Conoces los principios DDD y sus trade-offs. Sabes cuándo un BC es demasiado grande,
cuándo una integración sincrónica creará acoplamiento problemático, cuándo un agregado
esconde dos agregados distintos.

- Evalúas si el cambio propuesto rompe algún principio de diseño (cohesión, acoplamiento,
  dirección de dependencias)
- Calculas el impacto en cascada: ¿cuántos artefactos hay que actualizar? ¿hay contratos
  rotos? ¿hay inconsistencias entre YAML y diagrama?
- Propones alternativas técnicas cuando el cambio pedido tiene efectos secundarios
  no deseados
- Verificas la consistencia cross-artefacto antes y después de cada cambio

Cuando las dos voces estén en tensión, **explícitalo al usuario**. Esa tensión es
información valiosa para la decisión.

---

## Fase 1: Leer el Estado Actual

Antes de responder cualquier solicitud de cambio, **siempre** lee los artefactos existentes:

```
arch/system/system.yaml       → fuente de verdad estructurada
arch/system/system-spec.md    → narrativa y lenguaje ubícuo por BC
arch/system/system-diagram.mmd → relaciones visuales C4
AGENTS.md                      → contexto consolidado del sistema
```

Leer los cuatro en paralelo. Si alguno no existe, notificarlo inmediatamente — no continuar
con un diseño parcialmente leído porque los cambios quedarían inconsistentes.

Si necesitas validar estructura o convenciones del `system.yaml`, leer:
→ `../ddd-step1-strategic-design/references/system-yaml-guide.md` — ejemplos anotados, señales de sobre/sub-diseño, árbol de decisión de integraciones y checklist de validación

---

## Fase 1B: Diagnóstico Profundo de Consistencia e Integridad

Esta fase se ejecuta en **dos escenarios**:

1. **Validación standalone**: el usuario pide validar, auditar, revisar o encontrar
   problemas en el diseño sin solicitar un cambio específico. En este caso, esta fase
   ES la respuesta principal — generar el informe diagnóstico completo y ofrecer aplicar
   las correcciones detectadas.

2. **Pre-validación de refinamiento**: el usuario pide un cambio específico. Ejecutar
   esta fase antes de aplicar el cambio para garantizar que no se introduce deuda sobre
   un diseño ya inconsistente. Si se detectan inconsistencias preexistentes, reportarlas
   antes de aplicar el cambio.

Ejecutar **todos** los checklists en orden. Para cada problema encontrado, clasificar su
severidad y generar una corrección concreta. No omitir checklists aunque el diseño
"parezca correcto" a primera vista.

---

### Formato del Informe Diagnóstico

Presentar los hallazgos con esta estructura:

```
## Informe Diagnóstico — [Nombre del Sistema]

**Estado general:** ✅ Limpio / ⚠️ Con alertas (N) / ❌ Con errores (N)

### [Categoría: nombre]
| # | Severidad | Problema | Elemento afectado | Corrección propuesta |
|---|-----------|----------|-------------------|----------------------|
| 1 | 🔴 ERROR   | ...      | ...               | ...                  |
| 2 | 🟡 ALERTA  | ...      | ...               | ...                  |
| 3 | 🔵 SUGERENCIA | ...   | ...               | ...                  |
```

**Niveles de severidad:**
- 🔴 **ERROR**: El diseño no puede funcionar correctamente. Debe corregirse antes de continuar.
  Ejemplos: referencia a BC inexistente, evento de saga sin contrato en `integrations[]`,
  BC Core dependiendo sincrónicamente de Supporting, ciclo de dependencias entre BCs.
- 🟡 **ALERTA**: El diseño funciona pero introduce riesgo de deuda técnica o ambigüedad
  operativa que se volverá problema en el Paso 2 o en producción.
  Ejemplos: BC con propósito solapado, entidad candidata a agregado, evento sin consumidor,
  integración con externo sin patrón ACL.
- 🔵 **SUGERENCIA**: Mejora de calidad no crítica — naming, convenciones, claridad.
  Ejemplos: nombre en español en campo que debe ser inglés, canal AsyncAPI sin seguir
  la convención `{source-bc}.{entity}.{event-kebab}`.

---

### Checklist A — Consistencia Cross-Artefactos

Compara el contenido entre los cuatro archivos. Cada elemento central debe estar representado
en todos los artefactos que le corresponden.

**A1 — BCs en system.yaml ↔ system-spec.md**
- ¿Cada BC en `boundedContexts[]` tiene su sección `## BC: [Nombre]` en system-spec.md?
- ¿Cada sección `## BC:` en system-spec.md tiene su BC en `boundedContexts[]`?
  - Desincronización en cualquier dirección → 🔴 ERROR

**A2 — BCs en system.yaml ↔ system-diagram.mmd**
- ¿Cada BC en `boundedContexts[]` tiene su `Container(id, ...)` en el diagrama?
- ¿Cada `Container` del diagrama corresponde a un BC o external_system del YAML?
  - BC en YAML sin Container en diagrama → 🔴 ERROR
  - Container en diagrama sin BC en YAML → 🟡 ALERTA (puede ser external_system — verificar)

**A3 — Integraciones en system.yaml ↔ Relaciones en system-diagram.mmd**
- Para cada integración en `integrations[]`, ¿existe un `Rel(from, to, ...)` en el diagrama?
- Para cada `Rel(a, b, ...)` entre nodos internos en el diagrama, ¿existe integración en YAML?
  - Integración en YAML sin Rel en diagrama → 🟡 ALERTA
  - Rel en diagrama sin integración en YAML → 🟡 ALERTA

**A4 — External systems en system.yaml ↔ system-diagram.mmd**
- ¿Cada entrada en `externalSystems[]` tiene su `System_Ext(...)` en el diagrama?
- ¿Cada `System_Ext(...)` en el diagrama tiene su entrada en `externalSystems[]`?
  - Desincronización en cualquier dirección → 🟡 ALERTA

**A5 — BCs en AGENTS.md ↔ system.yaml**
- ¿La tabla de BCs en AGENTS.md lista exactamente los mismos BCs que `boundedContexts[]`?
- ¿El tipo (Core/Supporting/Generic) coincide en ambos?
  - BC o tipo distinto → 🔵 SUGERENCIA (AGENTS.md es derivado, actualizar)

**A6 — Glosario de AGENTS.md ↔ Lenguaje Ubícuo en system-spec.md**
- Los términos del glosario de AGENTS.md, ¿están definidos de forma consistente en las
  secciones "Lenguaje Ubícuo" de system-spec.md?
  - Mismo término con definición diferente en cada artefacto → 🟡 ALERTA
  - Término clave en system-spec.md ausente en el glosario de AGENTS.md → 🔵 SUGERENCIA

---

### Checklist B — Integridad del Mapa de Integraciones

**B1 — Referencias a BCs y sistemas existentes**
- Todo `from` y `to` en `integrations[]`, ¿corresponde a un BC en `boundedContexts[]`
  o a un sistema en `externalSystems[]`?
  - Referencia a entidad inexistente → 🔴 ERROR

**B2 — Eventos huérfanos (publicados pero sin consumidor declarado)**
- Para cada evento en contratos de integraciones `pattern: event` como emisor, ¿existe
  al menos una integración `to: {bc}` que lo consuma?
  - Evento publicado sin consumidor → 🟡 ALERTA (puede ser intencional, pero requiere
    justificación en el campo `notes` de la integración)

**B3 — Consumo sin fuente (evento consumido pero sin publicador)**
- Para cada evento que aparece en el `to` de una integración `pattern: event`, ¿existe
  una integración `from: {bc}, pattern: event` que declare ese mismo evento como contrato?
  - Evento consumido sin publicador → 🔴 ERROR

**B4 — Convención de naming de contratos**
- Contratos con `channel: message-broker`: el campo `name` debe ser PascalCase inglés.
  - Nombre en español → 🟡 ALERTA
  - Nombre en snake_case o camelCase → 🔵 SUGERENCIA
- El campo `channel` del contrato debe seguir el patrón `{source-bc}.{entity}.{event-kebab}`.
  - Canal que no sigue el patrón → 🔵 SUGERENCIA
- Contratos con `channel: http` o `grpc`: deben ser strings camelCase.
  - Formato incorrecto → 🔵 SUGERENCIA

**B5 — Integraciones síncronas vs asíncronas: justificación**
- Para cada integración `pattern: customer-supplier` o `channel: http`, ¿la necesidad
  de respuesta inmediata está justificada por el flujo de negocio?
  - Integración sincrónica en un flujo que podría ser async sin afectar al usuario →
    **siempre** usar `vscode_askQuestions` para presentar los trade-offs HTTP vs Local
    Read Model al diseñador. No evaluar internamente si "califica" — el agente nunca
    toma esta decisión unilateralmente, incluso para datos monetarios. El diseñador
    toma la decisión final y el agente no aplica el cambio hasta recibir confirmación
    explícita. Ver formato de pregunta en §Paso H del skill `ddd-step1-strategic-design`,
    que incluye un formato diferenciado para datos monetarios con advertencia OWASP A04.
    - Si el diseñador elige LRM → aplicar el cambio en `system.yaml` y propagar al diagrama.
    - Si el diseñador elige mantener HTTP → registrar en `notes` de la integración
      que se evaluó LRM y se descartó, indicando el motivo.
    - Si el dato es monetario y el diseñador elige LRM → registrar en `notes` la
      advertencia OWASP A04 y la mitigación que debe implementarse en el Paso 2.
- Para flujos dentro de un saga: si un paso depende del resultado del anterior, el modelo
  correcto es `pattern: event` con éxito/fallo explícito, no HTTP directo.
  - Paso de saga modelado como HTTP → 🟡 ALERTA

**B6 — Completitud del flujo de valor principal (happy path)**
- Trazar el flujo de valor principal del negocio paso a paso. Para cada transición entre
  BCs que el flujo requiere, ¿existe una integración en `integrations[]`?
  - Transición del happy path sin integración → 🔴 ERROR

**B7 — Completitud de flujos de excepción**
- Para cada evento de compensación en `sagas[].steps[].compensation`, ¿existe una
  integración que lo transporte al BC receptor?
- Para cada `onFailure` en los pasos del saga, ¿existe integración que propague ese fallo
  a todos los BCs que deben reaccionar?
  - Evento de excepción o compensación sin integración → 🔴 ERROR

**B8 — Fan-out de notificaciones**
- Para cada hito del ciclo de vida del recurso principal (confirmación, cancelación,
  asignación, entrega completada), ¿existe integración hacia el BC de notificaciones?
  - Hito relevante para el cliente sin integración a notifications → 🟡 ALERTA

**B9 — ACL para sistemas externos**
- Toda integración cuyo `from` o `to` sea un `external_system` debe tener `pattern: acl`.
  - Integración con externo sin `pattern: acl` → 🟡 ALERTA

**B10 — Sincronía de contratos del mismo evento en ambas direcciones**
- Si el evento `X` está declarado como contrato en la integración `from: A, to: B`,
  el nombre exacto (PascalCase) y el canal deben coincidir en todas las integraciones
  donde aparezca ese evento (incluyendo rutas de notificación o compensación).
  - Mismo evento con nombre o canal diferente en distintas integraciones → 🔴 ERROR

**B11 — Dependencias de datos autoritativos (snapshot at write time)**
- Para cada agregado con campos que representen valores "congelados" al momento de la
  transacción — tanto **monetarios** (precio de venta, monto total, tasa de cambio,
  tarifa vigente) como **no monetarios** (dirección de entrega, nombre registrado,
  datos de perfil congelados al pedido) — ¿existe una integración
  `customer-supplier / http` desde el BC consumidor hacia el BC autoritativo de ese
  valor?
  - Campo snapshot sin integración declarada → 🔴 ERROR: el valor se estaría tomando
    del request del cliente → para datos monetarios: riesgo de fraude OWASP A04
    (Insecure Design); para datos de identidad/dirección: riesgo de entrega fallida
    o inconsistencia en tracking/facturación.

  **Ejemplos canónicos para detectar el patrón:**
  | Campo en el agregado | ¿De dónde viene el valor? | Tipo | Si falta la integración → |
  |----------------------|--------------------------|------|---------------------------|
  | `OrderLine.unitPrice` | catalog (Product.price) | 💰 Monetario | Fraude — comprar a precio manipulado |
  | `Payment.amount` | orders (Order.total) | 💰 Monetario | Fraude — pagar monto arbitrario |
  | `InvoiceLine.unitPrice` | orders (OrderLine.price) | 💰 Monetario | Inconsistencia contable |
  | `Order.deliveryAddress` | customers (Address) | 🏠 Identidad | Entrega fallida o a dirección incorrecta — inconsistencia en tracking |

---

### Checklist C — Diseño de Bounded Contexts

**C1 — BC sin agregados**
- ¿Algún BC tiene `aggregates: []` o lista vacía?
  - BC sin agregados → 🔴 ERROR (no es un BC, es un namespace vacío)

**C2 — BC sobredimensionado**
- ¿Algún BC tiene más de 5 agregados?
  - BC con >5 agregados → 🟡 ALERTA (candidato a división — analizar cohesión)

**C3 — Dirección de dependencias: Core vs Supporting**
- ¿Algún BC Core es `to` en una integración `pattern: customer-supplier` o `channel: http`
  donde el `from` es un BC Supporting o Generic?
  - Core dependiendo sincrónicamente de Supporting/Generic → 🟡 ALERTA
  - (Los BCs Supporting pueden publicar eventos que Core consume — esto es válido.
    El problema es la dependencia sincrónica o la dependencia de existencia)

**C4 — Dependencias circulares**
- ¿Existe algún ciclo en el grafo de integraciones? (BC A → BC B → … → BC A)
  - Ciclo detectado → 🔴 ERROR

**C5 — Solapamiento de responsabilidades entre BCs**
- ¿Dos BCs tienen propósitos semánticamente solapados o gestionan el mismo tipo de entidad?
  - Evaluar con la Voz de Negocio: ¿el negocio reconocería estas como áreas verdaderamente separadas?
  - Solapamiento detectado → 🟡 ALERTA

**C6 — Entidades candidatas a agregado propio**
Para cada entidad listada dentro de un agregado en `boundedContexts[].aggregates[].entities`,
ejecutar el test de las tres preguntas:
- ¿Puede existir sin el Aggregate Root actual?
- ¿Es referenciada por múltiples instancias del Root?
- ¿Tiene operaciones CRUD independientes desde la API o UI del sistema?
  - ≥2 respuestas SÍ → 🟡 ALERTA: candidata a agregado separado en el mismo BC

**C7 — Propósito específico y verificable**
- ¿El campo `purpose` de cada BC describe responsabilidades concretas y acotadas?
  Un propósito que aplica a más de un BC o que no tiene fronteras claras es una señal
  de que el BC no está bien delimitado.
  - Propósito vago, genérico o que solapa con otro BC → 🔵 SUGERENCIA: reformular con
    responsabilidades y límites explícitos

**C8 — BC Generic delegando correctamente**
- Todo BC de tipo `generic` debería tener al menos una integración ACL con un sistema
  externo o una razón explícita en `purpose` de por qué no la necesita.
  - BC Generic sin ACL ni justificación → 🟡 ALERTA

---

### Checklist D — Diseño de Sagas

*(Solo si `sagas[]` está definido en system.yaml)*

**D1 — Evento trigger existente en integrations[]**
- El evento declarado en `sagas[].trigger.event`, ¿existe como contrato en `integrations[]`
  del BC emisor (`trigger.bc`)?
  - Evento de trigger sin contrato → 🔴 ERROR

**D2 — Eventos de cada paso existentes en integrations[]**
- Para cada `step`, los valores de `onSuccess`, `onFailure` y `compensation`,
  ¿existen como contratos en `integrations[]` del BC que los emite (`step.bc`)?
  - Evento de paso sin contrato → 🔴 ERROR

**D3 — Cadena de compensación completa**
- Para cada paso que tiene `onFailure` definido, ¿existe un `compensation` definido para
  todos los pasos anteriores que hayan modificado estado persistente?
  - Paso con fallo posible pero sin compensación de pasos previos → 🟡 ALERTA

**D4 — Todos los BCs del saga tienen integración declarada**
- ¿Cada BC listado como `step.bc` en el saga tiene al menos una integración en `integrations[]`
  que lo conecte a la cadena del saga?
  - BC en saga sin integración correspondiente → 🔴 ERROR

**D5 — Saga con menos de 3 BCs participantes**
- ¿El saga involucra solo 2 BCs distintos?
  - Saga con exactamente 2 BCs → 🔵 SUGERENCIA: el par evento/reacción en `integrations[]`
    puede ser suficiente sin necesitar un saga declarado

**D6 — Alineación entre saga y sequence of events en integrations**
- El orden lógico de los pasos del saga (`step.order`), ¿coincide con el flujo que se
  puede inferir leyendo las integraciones en `integrations[]` (qué evento dispara qué)?
  - Orden del saga inconsistente con el flujo real de eventos → 🟡 ALERTA

---

### Checklist E — Nomenclatura e Idioma

**E1 — Campos en inglés en system.yaml**
- Los campos `purpose`, `description`, `notes`, nombres de BCs, agregados, entidades
  y contratos deben estar en inglés. Los comentarios `#` son la única excepción.
  - Texto en español en campos que deben estar en inglés → 🔵 SUGERENCIA

**E2 — PascalCase en nombres de agregados y entidades**
- Nombres en `boundedContexts[].aggregates[].name` y `.entities[]` deben ser PascalCase.
  - Nombre que no es PascalCase → 🔵 SUGERENCIA

**E3 — PascalCase inglés en nombres de eventos (contratos message-broker)**
- El campo `name` en contratos con `channel: message-broker` debe ser PascalCase inglés.
  - Nombre no PascalCase o en español → 🟡 ALERTA (este nombre se propagará como
    identificador en los artefactos tácticos del Paso 2)

**E4 — Consistencia del mismo término entre artefactos**
- Un mismo concepto no debe recibir nombres diferentes en system.yaml, system-spec.md
  y AGENTS.md.
  - Ejemplo: `ShippingAddress` en YAML vs `DirecciónDeEntrega` en spec → 🟡 ALERTA

**E5 — Nombres de sistemas externos en kebab-case**
- Los valores del campo `name` en `externalSystems[]` deben ser kebab-case.
  - Nombre en otro formato → 🔵 SUGERENCIA

---

### Checklist F — Infraestructura y Consistencia de Decisiones

**F1 — Message broker declarado si existen eventos**
- Si hay al menos una integración con `channel: message-broker`, ¿está declarado
  `infrastructure.messageBroker: true`?
  - Eventos sin broker declarado → 🔴 ERROR

**F2 — Broker declarado innecesariamente**
- Si no existe ninguna integración con `channel: message-broker`, ¿se declara igualmente
  `infrastructure.messageBroker`?
  - Broker declarado sin ninguna integración por eventos → 🔵 SUGERENCIA: remover o justificar

**F3 — Valores de infraestructura dentro del conjunto válido**
- `deployment.strategy`: `modular-monolith` | `microservices` | `serverless`
- `deployment.architectureStyle`: `hexagonal` | `layered` | `clean`
- `database.isolationStrategy`: `schema-per-bc` | `db-per-bc` | `prefix-per-bc`
  - Valor fuera del conjunto válido → 🟡 ALERTA

**F4 — Coherencia estrategia de deployment vs isolación de base de datos**
- Si `deployment.strategy: microservices`, la isolación recomendada es `db-per-bc`.
  Si `deployment.strategy: modular-monolith`, la isolación típica es `schema-per-bc`.
  - Combinación inusual sin justificación en `notes` → 🔵 SUGERENCIA

---

### Checklist G — Capacidades Soportadas por el Generador (system.yaml extendido)

Validaciones específicas de las capacidades de plataforma que `system.yaml` declara y
que el generador procesa. Estas no aplicaban en versiones anteriores del DSL.

**G1 — `infrastructure.reliability` consistencia**

Si `infrastructure.reliability` está declarado, sus valores válidos son:
- `outbox: true|false` — patrón outbox para eventos publicados
- `consumerIdempotency: true|false` — idempotencia automática en consumidores

- Valor fuera del booleano → 🔴 ERROR.
- Si `outbox: true` pero no hay ninguna integración `channel: message-broker` → 🔵 SUGERENCIA: outbox sin eventos es overhead innecesario.
- Si hay sagas (`sagas[]`) y `consumerIdempotency: false` → 🟡 ALERTA: las cadenas de saga requieren idempotencia para tolerar redelivery; recomendar activarla.
- Si `outbox: true` y algún BC ya tiene diseño táctico con `broker.dlq` declarado, alertar inconsistencia → 🟡 ALERTA.

**G2 — `externalSystems[].operations[]` declaradas**

Cada `externalSystem` debe declarar `operations[]` cuando alguna integración lo
referencia como `from` o `to`. Cada operación contiene:
- `name`: identificador camelCase
- `description`: propósito de la operación
- `direction`: `inbound|outbound`

- ExternalSystem referenciado en `integrations[]` sin `operations[]` declaradas → 🔴 ERROR (INT-008 / INT-009): el generador no puede crear el ACL adapter sin saber qué métodos exponer; cada contrato HTTP hacia el externo debe matchear una operación.
- ExternalSystem con `operations[]` pero ninguna integración que lo referencie → 🟡 ALERTA: posible sistema externo huérfano.

**G3 — `auth` y `resilience` por integración o global**

Bloque `auth` opcional en `system.yaml.integrations[]` o globalmente bajo `infrastructure.integrations.defaults`:

```yaml
auth:
  type: none | api-key | bearer | oauth2-cc | mTLS
  valueProperty: <nombre-propiedad-config>     # api-key/bearer
  header: <header-name>                         # api-key/bearer
  tokenEndpoint: <url>                          # solo oauth2-cc
  credentialKey: <secret-key-name>              # solo oauth2-cc
```

- `auth.type` fuera del whitelist → 🔴 ERROR.
- **INT-015**: si `auth.type: oauth2-cc`, faltan `tokenEndpoint` o `credentialKey` → 🔴 ERROR.
- `auth.type: api-key` sin `valueProperty` y `header` → 🔴 ERROR.
- `auth.type: mTLS` sin certificados configurados (al menos `valueProperty` apuntando al secreto del cert) → 🟡 ALERTA.

Bloque `resilience` opcional:

```yaml
resilience:
  timeoutMs: <int>
  connectTimeoutMs: <int>
  retries: { maxAttempts: <int>, waitDurationMs: <int> }
  circuitBreaker: { failureRateThreshold: <0-100> }
```

- `retries.maxAttempts < 1` → 🔴 ERROR.
- `circuitBreaker.failureRateThreshold` fuera de [0, 100] → 🔴 ERROR.
- `connectTimeoutMs > timeoutMs` → 🔵 SUGERENCIA: invertido — connect siempre menor que total.
- Integración con sistema externo sin ningún bloque de resiliencia (ni global ni local) → 🟡 ALERTA: ACL externo sin timeout/retries explícitos depende de defaults del runtime.

**G4 — Sagas y reliability**

- Saga declarado en `sagas[]` pero `infrastructure.reliability.outbox: false` o ausente → 🟡 ALERTA: las sagas por coreografía requieren outbox para garantizar entrega de eventos de transición.
- Saga con `consumerIdempotency: false` → 🟡 ALERTA: sin idempotencia, una redelivery del mismo evento puede ejecutar el paso dos veces.

**G5 — Eventos de integración: scope y broker hints**

Aunque el `scope` del evento es declarado en `bc.yaml domainEvents.published[]`, el
`system.yaml integrations[]` debe coincidir:

- Cada contrato `channel: message-broker` en `system.yaml` representa un evento con
  `scope: integration` o `both` en el bc.yaml emisor. Si el bc.yaml ya está diseñado y
  el evento tiene `scope: internal` → 🔴 ERROR: contradicción (un evento internal nunca
  cruza fronteras de BC).

- El campo `partitionKey` del bloque `broker` (cuando se hereda de `system.yaml.infrastructure.broker.defaults`) debe ser un nombre de campo presente en el payload del evento; verificación cruzada con bc.yaml si existe.

**G6 — Convención de versionado de eventos**

Si dos integraciones declaran el mismo `name` de contrato con `version` distinto:
- Es válido siempre que el broker enrute por `version` (típicamente vía topic suffix o header) — registrar en `notes`.
- Sin documentación → 🔵 SUGERENCIA: clarificar la estrategia de versionado.

---

### Resultado de la Fase 1B

Al terminar todos los checklists, determinar el estado del diseño:

| Estado | Criterio | Acción |
|--------|----------|--------|
| ✅ **Limpio** | 0 ERRORes, 0 ALERTAs | Proceder con el refinamiento (si aplica) o reportar diseño sano |
| ⚠️ **Con alertas** | 0 ERRORes, ≥1 ALERTAs | Reportar al usuario; ofrecer corregir antes de continuar |
| ❌ **Con errores** | ≥1 ERRORes | Corregir los errores **primero** antes de aplicar cualquier cambio nuevo |

**Modo validación standalone:** presentar el informe completo y preguntar si el usuario
desea aplicar las correcciones automáticamente.

**Modo pre-validación de refinamiento con ERRORes:** preguntar al usuario si prefiere
corregir los errores primero, o aplicar su cambio y corregir los errores después. En
ambos casos, los problemas deben quedar documentados en el resumen final (Fase 6).

---

## Fase 2: Entender el Cambio

### 2.1 Clasificar la solicitud

Antes de actuar, clasifica qué tipo de cambio es:

| Tipo | Ejemplos | Impacto en artefactos |
|------|----------|----------------------|
| **Corrección de BC** | Renombrar, dividir, fusionar BCs | system.yaml, system-spec.md, system-diagram.mmd, AGENTS.md |
| **Cambio de integración** | Agregar/quitar relación, cambiar patrón o canal | system.yaml, system-diagram.mmd |
| **Cambio de modelo de negocio** | Nuevo actor, nueva funcionalidad core | Potencialmente todos |
| **Cambio de lenguaje ubícuo** | Renombrar un término clave | system-spec.md, AGENTS.md (glosario) |
| **Cambio de infraestructura** | Cambiar broker, DB, deployment strategy | system.yaml, AGENTS.md |
| **Corrección de agregado** | Agregar/quitar agregado o entidad dentro de un BC | system.yaml, system-spec.md |
| **Renombrar canal AsyncAPI** | Cambiar el nombre de un canal de evento ya existente | system.yaml — actualizar `contracts[].channel` en todas las integraciones que lo referencien |
| **Cambio de saga** | Agregar, modificar o eliminar un saga; cambiar pasos, eventos de éxito/fallo o compensación | system.yaml (`sagas[]`) + `{bc}.yaml` de cada BC participante (useCases con `sagaStep`) + `{bc}-async-api.yaml` + `{bc}-flows.md` (flujos de compensación) |

### 2.2 Preguntar solo si es bloqueante

No interrumpir el flujo con preguntas si el cambio es suficientemente claro. Preguntar
usando `vscode_askQuestions` solo cuando:

- El cambio es ambiguo y podría resolverse de al menos dos formas estructuralmente distintas
- El cambio implica decisiones de negocio que el usuario debe tomar (no solo técnicas)
- El impacto es mayor al esperado por el usuario y conviene alertar antes de proceder

Agrupa todas las preguntas en una sola llamada. No preguntar por detalles que puedes inferir razonablemente y documentar como supuesto.

---

## Fase 3: Análisis Dual Pre-Cambio

Antes de proponer o ejecutar el cambio, presenta un análisis breve desde las dos voces:

```
**Voz de Negocio:** [qué dice el experto de dominio sobre esta solicitud]
**Voz de Ingeniería:** [qué dice el ingeniero sobre el impacto técnico]
**Tensión detectada:** [si las dos voces apuntan en direcciones distintas, explicitarlo]
**Propuesta:** [qué vas a hacer y por qué]
```

Si el análisis es trivial (ej: cambio de nombre sin impacto en integraciones), puedes
condensar esto en una sola línea antes de proceder. El formato completo es para cambios
con implicaciones no obvias.

### Señales de alerta que siempre debes mencionar

Desde la **Voz de Negocio**:
- El cambio introduce un término que no refleja cómo el negocio llama realmente a ese concepto
- Se está metiendo lógica de un BC dentro de otro (ej: inventario dentro de catálogo)
- Un BC nuevo resuelve un problema que ya existía pero estaba escondido como deuda de diseño

Desde la **Voz de Ingeniería**:
- Un BC Core pasa a depender de un Supporting (inversión de dependencia)
- Una integración que era async pasa a ser sync en un flujo de alto volumen
- El cambio genera un ciclo de dependencias entre BCs
- Se agrega un BC con menos de un agregado claro (probablemente es una entidad, no un BC)
- Se fusionan BCs con más de 4-5 agregados combinados (BC resultante demasiado grande)
- Dos conceptos dentro del mismo BC necesitarían repositorios separados en el Paso 2 → señal de que ya deberían ser agregados distintos en el Paso 1. La cadena causal correcta es: ciclo de vida independiente → agregado propio → repositorio propio. Nunca al revés: no promover algo a agregado solo porque necesitará un repositorio — primero confirmar la independencia de ciclo de vida.

### Paso obligatorio cuando el tipo de cambio es "Corrección de agregado"

Cuando el cambio clasificado en 2.1 sea **Corrección de agregado** (agregar/quitar
agregado o entidad dentro de un BC), ejecutar el siguiente checklist sobre **cada
entidad nueva o existente afectada por el cambio** antes de aplicar la edición:

| Pregunta | Si SÍ → |
|----------|---------|
| ¿Puede existir sin el Aggregate Root propuesto? | Candidata a agregado propio |
| ¿Es referenciada por múltiples instancias del Root? | Candidata a agregado propio |
| ¿Tiene operaciones CRUD independientes desde la API o UI? | Candidata a agregado propio |

**Regla de decisión:** ≥2 respuestas SÍ → promover a agregado separado dentro del mismo BC.
Si el usuario está agregando una entidad que debería ser un agregado, señalarlo antes
de ejecutar el cambio y proponer la alternativa correcta.

---

## Fase 4: Ejecutar los Cambios

### 4.1 Determinar el conjunto mínimo de artefactos a editar

No editar lo que no cambia. Un cambio de nombre de BC implica:
- ✅ system.yaml — `name`, referencias en `integrations.from` / `integrations.to`
- ✅ system-spec.md — título de la sección `## BC: [Nombre]`
- ✅ system-diagram.mmd — identificador y label del `Container(...)`
- ✅ AGENTS.md — tabla de BCs y glosario si aplica

Un cambio de patrón de integración implica solo:
- ✅ system.yaml — campo `pattern` y posiblemente `channel`
- ✅ system-diagram.mmd — label de la relación `Rel(...)`

### 4.2 Reglas de edición

- Usar `replace_string_in_file` o `multi_replace_string_in_file` para ediciones precisas
- **Nunca recrear un archivo completo** para hacer un cambio puntual — editar solo lo necesario
- En `system.yaml`: mantener el orden de secciones: `system` → `boundedContexts` →
  `externalSystems` → `integrations` → `infrastructure`
- En `system-spec.md`: mantener la estructura exacta de cada sección BC (Propósito,
  Responsabilidades, No Responsabilidades, Lenguaje Ubícuo, Agregados, Dependencias)
- En `system-diagram.mmd`: mantener el orden de relaciones: actores primero, luego
  BCs entre sí, luego sistemas externos

### 4.3 Verificación de consistencia post-edición

Después de editar, verificar mentalmente:

1. ¿Todo `from`/`to` en `integrations` existe como BC o external_system?
2. ¿Todos los `Container(id, ...)` en el diagrama tienen su `Rel(...)` correspondiente si la integración sigue existiendo?
3. ¿El glosario de AGENTS.md refleja los términos del lenguaje ubícuo actualizado?
4. ¿Si hay `channel: message-broker`, existe `infrastructure.messageBroker`?
5. ¿Los contratos de integraciones `channel: message-broker` son objetos con `name` y `channel`? ¿El valor de `channel` sigue el patrón `{source-bc}.{entity}.{event-kebab}`?
6. ¿Los nombres en PascalCase de agregados y entidades son consistentes entre system.yaml y system-spec.md?
7. ¿Existen BCs con diseño táctico en `arch/` que referencien alguno de los elementos modificados? → Continuar a Fase 5.
8. Si se modificó `sagas[]`: ¿todos los eventos declarados en `onSuccess`, `onFailure` y `compensation` existen como contratos en las integraciones `pattern: event` del BC emisor?

---

## Fase 5: Propagación a Bounded Contexts ya Diseñados

Después de aplicar cambios al Paso 1, **siempre** verificar si existen BCs con diseño
táctico ya generado que se vean afectados por el cambio.

### 5.1 Detectar BCs diseñados

Verificar qué directorios existen bajo `arch/` (excluyendo `arch/system/`):

```
arch/
├── system/          ← Paso 1 — no es un BC diseñado
├── catalog/         ← BC diseñado en Paso 2 — puede estar afectado
├── orders/          ← BC diseñado en Paso 2 — puede estar afectado
└── ...
```

Si existe `arch/{bc-name}/{bc-name}.yaml`, ese BC tiene diseño táctico. Leer su
sección `integrations` y `domain_events` para determinar si el cambio del Paso 1 lo impacta.

### 5.2 Clasificar el impacto por BC diseñado

Para cada BC con diseño táctico existente, evaluar:

| Tipo de cambio en Paso 1 | Impacto posible en el BC diseñado |
|--------------------------|----------------------------------|
| Se renombra un BC con el que este BC se integra | Actualizar `integrations[].name` en `{bc}.yaml` |
| Se agrega una integración que involucra este BC | Agregar entrada en `integrations.inbound` o `integrations.outbound` en `{bc}.yaml` |
| Se elimina una integración que involucra este BC | Eliminar la entrada correspondiente en `integrations` del `{bc}.yaml` |
| Se cambia el patrón/canal de una integración con este BC | Actualizar `pattern` y `protocol` en `{bc}.yaml` |
| Se agrega un evento nuevo que este BC debería consumir | Agregar entrada en `domain_events.consumed` del `{bc}.yaml` |
| Se elimina un evento que este BC consumía | Eliminar la entrada de `domain_events.consumed` del `{bc}.yaml` |
| Se renombra un contrato/operación de integración | Actualizar `operations[].name` en `integrations` del `{bc}.yaml` |
| Se fusionan o dividen BCs que afectan este BC | Actualizar referencias de `bc:` en propiedades de agregados y en integraciones |
| Se agrega o modifica un saga que involucra este BC | Agregar/actualizar useCases con `sagaStep` en `{bc}.yaml`; actualizar `{bc}-async-api.yaml` y flujos de compensación en `{bc}-flows.md` |
| Se elimina un saga que involucra este BC | Eliminar `sagaStep` de los UCs afectados en `{bc}.yaml`; eliminar canales huérfanos en `{bc}-async-api.yaml` |

### 5.3 Regla de alcance: qué actualizar y qué no

**SÍ actualizar** en los BCs diseñados:
- `{bc}.yaml` — sección `integrations` y `domain_events.consumed`
- `{bc}-async-api.yaml` — canales consumidos si cambia el nombre del evento o el BC fuente
- `{bc}-open-api.yaml` — solo si cambia un endpoint que sirve a la integración modificada

**NO actualizar** sin indicación explícita del usuario:
- Casos de uso (`{bc}-spec.md`) — son internos al BC, no dependen del nombre del BC vecino
- Flujos (`{bc}-flows.md`) — ídem
- Diagramas de estados — no se ven afectados por cambios de integración

Si los cambios en los artefactos tácticos son extensos (ej: afectan 3+ BCs), **preguntar al
usuario** si desea propagar automáticamente o revisar manualmente antes de editar.

### 5.4 Documentar la propagación en el resumen

Al final de cada refinamiento, si se propagaron cambios a BCs diseñados, listar:

```
**BCs afectados y actualizados:**
- `arch/catalog/catalog.yaml` → actualizado: integrations.inbound[orders].name
- `arch/orders/orders.yaml` → actualizado: integrations.outbound[catalog].name
```

Si un BC diseñado está afectado pero NO se actualizó (por ser de bajo impacto o
requerir decisión del usuario), listarlo como **deuda pendiente**.

---

## Fase 6: Resumen Post-Ejecución

El contenido del resumen varía según el modo en que se ejecutó el skill:

### Modo Validación Standalone (sin cambio solicitado)

1. **Estado general del diseño** — ✅ Limpio / ⚠️ Con alertas / ❌ Con errores
2. **Informe diagnóstico completo** — resultado de la Fase 1B con todos los hallazgos
3. **Correcciones aplicadas** — lista de problemas que se corrigieron automáticamente (si el usuario autorizó)
4. **Correcciones pendientes** — lista de problemas no aplicados con su severidad
5. **Próxima acción sugerida** — si hay errores, qué corregir primero; si está limpio, sugerir avanzar al Paso 2

### Modo Refinamiento (con cambio solicitado)

1. **Resultado de la pre-validación** — si la Fase 1B detectó problemas preexistentes, listarlos brevemente
2. **Qué cambió** — lista concisa de cambios aplicados al Paso 1
3. **Artefactos del Paso 1 editados** — cuáles archivos se tocaron y por qué
4. **BCs afectados y propagación** — cuáles BCs diseñados se actualizaron y cuáles quedaron con deuda pendiente
5. **Impacto en el diseño** — qué consecuencias tiene este cambio en el sistema
6. **Deuda de diseño** (si aplica) — si el cambio es un parche y hay una solución más limpia, mencionarlo
7. **Próxima decisión sugerida** — qué debería revisar el usuario a continuación

---

## Principios que Guían las Decisiones de Refinamiento

**Cambio mínimo suficiente.** Si el usuario pide "agregar notificaciones por WhatsApp",
el cambio mínimo es agregar el canal al BC Notifications — no crear un nuevo BC.

**Consistencia sobre velocidad.** Un cambio rápido que deja el diagrama inconsistente
con el YAML es peor que no hacer el cambio. Siempre verificar consistencia.

**La dirección de dependencias es sagrada.** Core no depende de Supporting. Si un cambio
lo viola, alertar explícitamente y proponer una alternativa antes de ejecutar.

**El lenguaje ubícuo es del negocio, no del diseñador.** Si el usuario corrige un término
("nosotros no decimos 'Despacho', decimos 'Envío'"), ese cambio tiene prioridad sobre
cualquier preferencia técnica.

**Un BC sin dueño claro no existe.** Si el cambio introduce un BC cuya responsabilidad
nadie en el negocio reconocería como separada, cuestionar antes de agregarlo.
