# Agent Decision Guide

Esta guia define que agente usar en cada momento del proceso de diseno. El objetivo es mantener la Fase 1 enfocada en intencion de negocio, fronteras de dominio y artefactos YAML agnosticos.

## Arbol de decision

```text
Inicio
|
|-- No existe arch/system/system.yaml?
|   `-- Usa design-system
|
|-- Existe system.yaml pero necesitas cambiar BCs, sagas o integraciones globales?
|   `-- Usa design-system en modo refinamiento estrategico
|
|-- Quieres disenar o refinar un unico BC declarado en system.yaml?
|   `-- Usa design-bounded-context
|
|-- Solo quieres revisar decisiones, diagnosticos o gaps visuales?
|   `-- Ejecuta dsl preview y vuelve al agente con los prompts generados
```

## Usa `design-system` cuando

- El proyecto parte de una descripcion de negocio y aun no existe `arch/system/system.yaml`.
- Hay que identificar o redibujar Bounded Contexts.
- Un cambio agrega, elimina, fusiona o divide BCs.
- Una decision modifica integraciones entre BCs, sistemas externos o sagas.
- El usuario necesita generar o regenerar los artefactos estrategicos de `arch/system/`.

Salidas esperadas:

- `arch/system/system.yaml`
- `arch/system/system-spec.md`
- `arch/system/system-diagram.mmd`
- `AGENTS.md` del proyecto usuario, salvo que sea el `AGENTS.md` documental de este repositorio.

### Como se ejecuta `design-system` (modelo multi-agente, Paso 1)

`design-system` es el **orquestador** y corre en el **hilo principal**: es el unico que pregunta al
disenador (`AskUserQuestion`), decide y escribe artefactos. Para el analisis pesado y de solo
lectura se apoya en **workers** que devuelven hallazgos pero **nunca deciden ni escriben**:

- `domain-analyst` — event storming, clasificacion de BCs y agregados.
- `integration-auditor` — Auditoria de Integraciones A-H; devuelve las decisiones LRM vs HTTP
  sin tomarlas.
- `validator` — refinamiento (`ddd-design-validation`), `dsl validate` y VISION gate.

Invocacion e instalacion (las materializa `dsl init`):

- **Claude Code:** el orquestador es la **skill** `design-system` (`.claude/skills/design-system/`,
  hilo principal, `AskUserQuestion` disponible); se invoca como `/design-system <descripcion>`. Los
  workers son **subagentes** read-only en `.claude/agents/` y pueden correr en paralelo.
- **Copilot:** el orquestador es el `@design-system` de `.github/agents/`; no hay spawn de
  subagentes, asi que ejecuta las mismas secciones de los skills **inline**.

Regla invariante: si un worker devuelve una decision pendiente (LRM vs HTTP, promover un agregado,
mover fronteras de BC), la resuelve el orquestador con el disenador antes de actuar — nunca el worker.

## Usa `design-bounded-context` cuando

- Ya existe `arch/system/system.yaml` y el BC objetivo esta declarado alli.
- El trabajo se limita a agregados, entidades, value objects, enums, reglas, use cases o eventos de un solo BC.
- Hay que producir o refinar contratos `OpenAPI` / `AsyncAPI` de ese BC.
- Un cambio estrategico ya fue aprobado y ahora debe reflejarse tacticamente en un BC.
- El usuario quiere revisar la participacion de un BC en una saga, sin redibujar la saga completa.

Salidas esperadas:

- `arch/{bc}/{bc}.yaml`
- `arch/{bc}/{bc}-spec.md`
- `arch/{bc}/{bc}-flows.md`
- `arch/{bc}/{bc}-open-api.yaml`
- `arch/{bc}/{bc}-async-api.yaml`
- `arch/{bc}/diagrams/`

### Como se ejecuta `design-bounded-context` (modelo multi-agente, Paso 2)

Igual que `design-system`, `design-bounded-context` es el **orquestador** del hilo principal: es el
unico que pregunta al disenador, decide y **escribe los seis artefactos del BC**. Para el analisis
de solo lectura se apoya en dos workers que devuelven hallazgos pero **nunca deciden ni escriben**:

- `tactical-analyst` — analisis tactico de dominio (agregado vs entidad vs VO, enums, reglas) y surfacing
  de la decision LRM vs HTTP por integracion; lee `ddd-tactical-design` §1.3-1.4 en modo
  read-only. No escribe el `bc.yaml`.
- `tactical-validator` — refinamiento (`ddd-tactical-validation`, checklists A-E), `dsl validate --bc` (mas el
  barrido completo) y VISION gate; devuelve hallazgos y correcciones propuestas.

A diferencia del Paso 1, el flujo es **estrictamente secuencial** (`tactical-analyst` -> el orquestador
escribe -> `tactical-validator`), porque el validador necesita los artefactos ya escritos. El beneficio es
aislamiento de contexto y foco, no paralelismo. En **Copilot** no hay spawn: el `@design-bounded-context`
ejecuta el analisis y la validacion **inline**. Invariante: cualquier `decision-pendiente` que devuelva
un worker (LRM vs HTTP, promover un agregado, discrepancia con `system.yaml`) la resuelve el orquestador
con el disenador antes de actuar.

## Cuando ejecutar `dsl validate`

Ejecuta `dsl validate` despues de cambios manuales o generados en YAML canonico, contratos o integraciones. Es obligatorio antes de entregar artefactos a la Fase 2.

Usa validacion completa cuando el cambio toca sagas, eventos entre BCs, integraciones o varios BCs:

```bash
dsl validate
```

Usa validacion por BC solo cuando el cambio es local y no necesita contexto tactico de otros BCs:

```bash
dsl validate --bc catalog
```

Si `--bc` produce errores relacionados con sagas o eventos de otros BCs que si estan disenados, repite la validacion completa antes de tratarlo como bloqueo.

## Cuando ejecutar `dsl preview`

Ejecuta `dsl preview` cuando el diseno necesita revision humana, preparacion para stakeholders o prompts concretos para iterar con agentes.

```bash
dsl preview --no-open --format all --locale es
```

Usa `--bc <name>` cuando solo quieras revisar una superficie tactica:

```bash
dsl preview --bc orders --no-open --format all --locale es
```

`dsl preview` no modifica los YAML canonicos; genera una mesa estatica de revision en `arch/review/`.

## Regla de escalamiento

Si una decision tactica obliga a cambiar fronteras de BC, canal HTTP vs evento, ownership de datos, sagas o sistemas externos, detente y vuelve a `design-system`. El agente tactico puede detectar la tension, pero la decision debe quedar registrada primero en `system.yaml`.
