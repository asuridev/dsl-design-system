# AGENTS.md — DSL Design System

Este repositorio implementa **exclusivamente la Fase 1: Diseño** del framework de tres fases
descrito en [VISION.md](VISION.md). Su única responsabilidad es producir artefactos YAML
agnósticos que un generador externo consumirá en la Fase 2.

**La generación de código es responsabilidad de un proyecto separado. Este repositorio no genera código.**

---

## Qué hace este proyecto

Provee dos cosas:

1. **Un CLI (`dsl`)** — herramienta de scaffolding para inicializar la estructura de diseño
   en cualquier proyecto. El comando `dsl init` copia los agentes y skills al workspace del usuario.

2. **Agentes y skills de diseño** — definiciones que guían a la IA a través del proceso DDD
   en dos pasos: diseño estratégico (Paso 1) y diseño táctico (Paso 2).

---

## Agentes disponibles

### `design-system`
**Cuándo usarlo:** El usuario quiere diseñar un sistema desde cero o describe un negocio que necesita ser modelado.

Ejecuta el proceso completo del Paso 1 + autovalidación:
1. Analiza el contexto del negocio
2. Identifica Bounded Contexts, Agregados e integraciones
3. Genera los cuatro artefactos canónicos en `arch/system/`
4. Ejecuta automáticamente `ddd-step1-refine` sobre el diseño producido

Artefactos producidos:
```
arch/system/
├── system.yaml          ← fuente de verdad del sistema
├── system-spec.md       ← narrativa detallada por BC
└── system-diagram.mmd   ← diagrama C4 Contenedores (Mermaid)
```

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

---

## Estructura del repositorio

```
dsl-design-system/
├── bin/
│   └── dsl.js                    ← entry point del CLI
├── src/
│   ├── agents/                   ← definiciones de agentes (se copian a .github/agents/)
│   │   ├── design-system.agent.md
│   │   └── design-bounded-context.agent.md
│   ├── commands/                 ← implementaciones de comandos CLI
│   │   └── init.js
│   └── skills/                   ← skills de diseño DDD (se copian a .agents/skills/)
│       ├── ddd-step1-strategic-design/
│       ├── ddd-step1-refine/
│       ├── ddd-step2-tactical-design/
│       └── ddd-step2-refine/
├── AGENTS.md                     ← este archivo
├── VISION.md                     ← filosofía y principios del sistema completo
└── package.json
```

---

## Límites de responsabilidad

**Este proyecto SÍ hace:**
- Guiar el proceso de diseño estratégico (Paso 1) y táctico (Paso 2)
- Producir artefactos YAML agnósticos a la tecnología
- Validar coherencia interna de los diseños producidos
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
