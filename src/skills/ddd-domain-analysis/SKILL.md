---
name: ddd-domain-analysis
description: >
  Paso 1 — Análisis de dominio estratégico (DDD): event storming, clasificación de
  Bounded Contexts (Core/Supporting/Generic), definición de agregados de nivel
  estratégico, checklist de entidades candidatas a agregado y revisión de dependencias
  implícitas por ciclo de vida. Produce los BCs candidatos con su tipo y agregados.
  Lo ejecuta el subagente `domain-analyst` (Claude) o el orquestador `design-system`
  inline (Copilot). Para la generación de artefactos ver `ddd-step1-authoring`; para
  sagas e integraciones ver `ddd-integration-audit`.
---

> **Rol dual** (igual que en `ddd-step1-authoring`): razonas como **Experto de Negocio
> del Dominio** y como **Ingeniero Senior de Diseño DDD** simultáneamente. La tensión
> entre ambas voces es información de diseño — explicítala.

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

