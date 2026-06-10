# AGENTS.md — DSL Design System

> **TL;DR para agentes:** este repo es la **Fase 1 (Diseño)** de un flujo de tres fases.
> Produce artefactos YAML **agnósticos de tecnología** en `arch/` que condensan las
> decisiones de dominio y arquitectura. Un generador externo (Fase 2, p. ej. `dsl-springboot`)
> los consume. **Aquí NO se genera código.** Los artefactos declaran **qué** y **para qué**,
> nunca **cómo**. Para Claude Code, el contexto de entrada es [CLAUDE.md](CLAUDE.md).

Este repositorio implementa **exclusivamente la Fase 1: Diseño** del framework de tres fases
descrito en [VISION.md](VISION.md). Su única responsabilidad es producir artefactos YAML
agnósticos que un generador externo consumirá en la Fase 2.

**La generación de código es responsabilidad de un proyecto separado. Este repositorio no genera código.**

---

## Qué hace este proyecto

Provee dos cosas:

1. **Un CLI (`dsl`)** — herramienta de scaffolding y revisión para inicializar la estructura
   de diseño y facilitar su inspección. El comando `dsl init` copia los agentes y skills al
   workspace del usuario; `dsl validate` revisa coherencia de artefactos; `dsl preview`
   genera una revisión visual bilingüe de decisiones y diagramas para iterar con el agente.

2. **Agentes y skills de diseño** — definiciones que guían a la IA a través del proceso DDD
   en dos pasos: diseño estratégico (Paso 1) y diseño táctico (Paso 2).

---

## Agentes disponibles

Para elegir agente y secuencia operativa, ver tambien:
- [docs/agent-decision-guide.md](docs/agent-decision-guide.md) — arbol de decision para
   `design-system`, `design-bounded-context`, `dsl validate` y `dsl preview`.
- [docs/workflow-reference.md](docs/workflow-reference.md) — flujos recomendados para
   proyecto nuevo, primer BC, iteraciones tacticas y handoff a Fase 2.

### `design-system`
**Cuándo usarlo:** El usuario quiere diseñar un sistema desde cero o describe un negocio que necesita ser modelado.

Ejecuta el proceso completo del Paso 1 + autovalidación:
1. Analiza el contexto del negocio
2. Identifica Bounded Contexts, Agregados e integraciones
3. Genera los tres artefactos de diseño en `arch/system/` más el contexto raíz (`AGENTS.md`, `CLAUDE.md`)
4. Ejecuta automáticamente `ddd-step1-refine` sobre el diseño producido

Artefactos producidos:
```
arch/system/
├── system.yaml          ← fuente de verdad del sistema
├── system-spec.md       ← narrativa detallada por BC
└── system-diagram.mmd   ← diagrama C4 Contenedores (Mermaid)
AGENTS.md                ← contexto consolidado del sistema (raíz del proyecto usuario)
CLAUDE.md                ← contexto e instrucciones para Claude Code (raíz del proyecto usuario)
```

Además produce `AGENTS.md` y `CLAUDE.md` en la raíz del proyecto usuario como contexto
consolidado del sistema diseñado. Dentro de este repositorio, `AGENTS.md` y `CLAUDE.md`
raíz son documentación del framework y **no deben sobrescribirse** durante pruebas del
agente sin confirmación explícita.

### `design-bounded-context`
**Cuándo usarlo:** El usuario quiere diseñar o refinar el dominio táctico de un BC ya existente en `arch/system/system.yaml`.

Ejecuta el proceso completo del Paso 2 + autovalidación:
1. Valida que el BC exista en `system.yaml` antes de comenzar
2. Resuelve decisiones de integración (Local Read Model vs HTTP síncrono)
3. Genera los seis artefactos canónicos en `arch/{bc-name}/`
4. Ejecuta automáticamente `ddd-step2-refine` sobre el diseño producido

Artefactos producidos:
```
arch/{bc-name}/
├── {bc-name}.yaml              ← anatomía del dominio (input del generador)
├── {bc-name}-spec.md           ← casos de uso detallados
├── {bc-name}-flows.md          ← flujos Given/When/Then
├── {bc-name}-open-api.yaml     ← contrato REST público
├── {bc-name}-async-api.yaml    ← contrato de eventos (AsyncAPI)
└── diagrams/                   ← diagramas de estados, dominio, secuencias
```

---

## Skills disponibles

| Skill | Propósito |
|---|---|
| `ddd-step1-strategic-design` | Proceso completo del Paso 1: análisis de negocio → BCs → artefactos |
| `ddd-step1-refine` | Refinamiento y validación del diseño estratégico existente |
| `ddd-step2-tactical-design` | Proceso completo del Paso 2: anatomía del dominio → artefactos BC |
| `ddd-step2-refine` | Refinamiento y validación del diseño táctico de un BC |

Los skills residen en `src/skills/` y se copian a `.agents/skills/` al ejecutar `dsl init`
en el proyecto del usuario.

Los agentes residen en `src/agents/` y se copian a `.github/agents/` al ejecutar `dsl init`.
Sus instrucciones referencian las skills en `.agents/skills/`, que es la ruta instalada en
el workspace usuario.

---

## Gobernanza operacional

Usa `design-system` cuando la decision cambie el mapa estrategico: BCs, responsabilidades,
ownership de datos, integraciones globales, sistemas externos o sagas. Tambien es el agente
correcto cuando todavia no existe `arch/system/system.yaml`.

Usa `design-bounded-context` cuando el BC ya existe en `system.yaml` y el trabajo sea tactico:
agregados, value objects, enums, reglas, use cases, eventos, contratos o diagramas de un solo BC.
Si durante ese trabajo aparece una decision que modifica fronteras, HTTP vs eventos/LRM o sagas,
primero debe volver al nivel estrategico y quedar reflejada en `system.yaml`.

Ejecuta `dsl validate` despues de cambios en YAML canonico, contratos o integraciones. Prefiere
validacion completa cuando participen sagas o multiples BCs; usa `dsl validate --bc <name>` solo
para cambios locales que no dependan del contexto tactico de otros BCs.

Ejecuta `dsl preview --no-open --format all --locale es` para revision humana, comparacion de
decisiones y generacion de prompts de iteracion. `dsl preview` no modifica artefactos canonicos;
solo escribe la mesa de revision en `arch/review/`.

---

## Estructura del repositorio

```
dsl-design-system/
├── bin/
│   └── dsl.js                    ← entry point del CLI
├── docs/                         ← guías de artefactos, agentes y workflows
├── examples/
│   └── canasta-familiar/          ← ejemplo curado de sistema + BCs tácticos
├── src/
│   ├── agents/                   ← orquestadores: copia literal a .github/agents/ (Copilot, @-invoke)
│   │   ├── design-system.agent.md  y transformados a .claude/commands/ (Claude Code, /-invoke)
│   │   └── design-bounded-context.agent.md
│   ├── commands/                 ← implementaciones de comandos CLI
│   │   ├── init.js
│   │   ├── preview.js
│   │   └── validate.js
│   └── skills/                   ← skills de diseño DDD (se copian a .agents/skills/)
│       ├── ddd-step1-strategic-design/
│       ├── ddd-step1-refine/
│       ├── ddd-step2-tactical-design/
│       └── ddd-step2-refine/
├── AGENTS.md                     ← este archivo (contexto del framework para agentes)
├── CLAUDE.md                     ← contexto breve para Claude Code (importa AGENTS.md y VISION.md)
├── VISION.md                     ← filosofía y principios del sistema completo
└── package.json
```

---

## Límites de responsabilidad

**Este proyecto SÍ hace:**
- Guiar el proceso de diseño estratégico (Paso 1) y táctico (Paso 2)
- Producir artefactos YAML agnósticos a la tecnología
- Validar coherencia interna de los diseños producidos
- Generar vistas de revisión para decisiones de diseño y propuestas de iteración
- Proveer el CLI `dsl` para inicializar la estructura de diseño

**Este proyecto NO hace:**
- Generar código fuente en ningún lenguaje o framework
- Tomar decisiones de implementación (tecnología, librerías, patrones de código)
- Consumir los artefactos YAML producidos — eso es responsabilidad del generador (Fase 2)
- Ejecutar pruebas, builds ni deploys

---

## Principio fundamental

Los artefactos declaran **qué** y **para qué**. Nunca **cómo**.
El `{bc-name}.yaml` debe poder alimentar un generador para Spring Boot, Django o NestJS
sin cambiar una sola línea del diseño. Si una decisión de diseño hace referencia a un
framework o patrón de implementación específico, pertenece al generador, no aquí.

Ver [VISION.md](VISION.md) para el razonamiento completo.
