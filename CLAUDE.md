# CLAUDE.md — DSL Design System

> Documentación **del framework** (no de un sistema de usuario). Da contexto a Claude Code
> y a cualquier agente de IA que trabaje **dentro de este repositorio**.

## Qué es este proyecto

`dsl-design-system` implementa la **Fase 1: Diseño** de una metodología de tres fases.
Produce **artefactos YAML agnósticos de tecnología** (en `arch/`) que condensan todas las
decisiones de dominio y arquitectura. Un generador externo los consume en la **Fase 2**
(p. ej. `dsl-springboot`) para producir scaffolding determinístico, y un agente de IA
completa la lógica de negocio en la **Fase 3**.

**Este repositorio NO genera código.** Solo diseña, valida y revisa artefactos. Los
artefactos declaran **qué** y **para qué**, nunca **cómo**.

## Contexto completo

@AGENTS.md
@VISION.md

`AGENTS.md` detalla los agentes (`design-system`, `design-bounded-context`), las skills, la
gobernanza operacional y los límites de responsabilidad. `VISION.md` explica los principios
(determinismo, agnosticismo, trazabilidad, separación intención/implementación).

## Comandos clave

```bash
dsl init                                          # instala arch/, agentes y skills en el workspace usuario
dsl validate                                      # valida coherencia de los artefactos (reglas INT-001..021)
dsl validate --bc <nombre>                        # validación local de un solo BC
dsl preview --no-open --format all --locale es    # mesa de revisión visual en arch/review/ (no toca los YAML)
npm test                                          # suite de tests (test/runner.js)
```

## Contrato compartido con Fase 2 (`@dsl/contract`)

Los validadores de contrato cruzado (`integration-validator`, `openapi-usecase-validator`,
`openapi-contract`) **no se duplican**: viven en el paquete **`@dsl/contract`**, fuente única de verdad
compartida con `dsl-springboot-generator` (Fase 2). Se consume como **dependencia git URL** pineada a tag
(`"@dsl/contract": "git+https://github.com/asuridev/dsl-contract.git#v0.1.0"`), así un `git clone` + `npm
install` fresco lo resuelve desde GitHub (repo público). Importar desde `@dsl/contract` (ver
`src/commands/{validate,preview}.js`). El comando `dsl init` ensambla el tool `tools/dsl-validate/`
autocontenido **copiando** estos validadores desde el paquete (vía `require.resolve`), no por dependencia.

- Dev local del paquete: `npm link`. Release: bump versión + tag `vX.Y.Z` en `dsl-contract`, luego actualizar
  el `#vX.Y.Z` aquí y `npm install`.
- Las reglas de anatomía por BC siguen en `src/utils/bc-yaml-validator.js` (BC-001..170). Su paridad con el
  reader de Fase 2 se rastrea en `../dsl-contract/docs/contract-rule-parity.md`.

## Salvaguarda

Este `CLAUDE.md` documenta el framework; **no debe sobrescribirse** sin confirmación
explícita. La misma regla aplica a `AGENTS.md`.
