# Workflow Reference

Esta referencia resume secuencias operativas para usar el DSL Design System en Fase 1. Los comandos asumen que `dsl` esta disponible en el proyecto usuario o que se invoca el CLI local del repositorio.

## Proyecto nuevo

1. Ejecuta `dsl init` en el workspace usuario para instalar `arch/`, agentes, skills, workers y `tools/dsl-validate/`.
2. Invoca `design-system` con el contexto de negocio. En Claude Code es la skill `/design-system`
   (corre en el hilo principal); en Copilot es `@design-system`. El orquestador delega el analisis
   de solo lectura a workers (`domain-analyst`, `integration-auditor`, `validator`)
   pero retiene toda interaccion con el disenador y todas las escrituras — ver
   [agent-decision-guide.md](agent-decision-guide.md#como-se-ejecuta-design-system-modelo-multi-agente-paso-1).
3. Revisa los artefactos en `arch/system/` y el `AGENTS.md` generado del proyecto usuario.
4. Ejecuta:

```bash
dsl validate
```

5. Genera una revision visual:

```bash
dsl preview --no-open --format all --locale es
```

6. Usa los prompts de `arch/review/patch-proposals.yaml` para iterar si hay decisiones abiertas.

## Disenar el primer BC tactico

1. Confirma que el BC existe en `arch/system/system.yaml`.
2. Invoca `design-bounded-context` indicando el nombre exacto del BC. En Claude Code el orquestador
   delega el analisis tactico de solo lectura a workers (`tactical-analyst`, `tactical-validator`) pero retiene
   toda interaccion con el disenador y todas las escrituras — ver
   [agent-decision-guide.md](agent-decision-guide.md#como-se-ejecuta-design-bounded-context-modelo-multi-agente-paso-2).
3. Revisa `{bc}.yaml`, contratos y diagramas.
4. Ejecuta validacion completa si el BC participa en integraciones o sagas:

```bash
dsl validate
```

5. Ejecuta revision focalizada:

```bash
dsl preview --bc catalog --no-open --format all --locale es
```

## Iterar un BC existente

1. Cambia o pide al agente cambiar un unico BC.
2. Ejecuta:

```bash
dsl validate --bc <bc-name>
```

3. Si aparecen diagnosticos relacionados con otros BCs, ejecuta tambien:

```bash
dsl validate
```

4. Regenera preview para revisar contratos, eventos, use cases y decisiones:

```bash
dsl preview --bc <bc-name> --no-open --format all --locale es
```

## Cambio estrategico que impacta BCs

Usa este flujo cuando aparece una nueva integracion, se divide un BC, cambia el ownership de datos o se reabre HTTP vs Local Read Model.

1. Vuelve a `design-system` para actualizar `system.yaml`, `system-spec.md` y `system-diagram.mmd`.
2. Ejecuta `dsl validate`.
3. Para cada BC afectado, invoca `design-bounded-context` y actualiza sus artefactos tacticos.
4. Ejecuta `dsl preview --no-open --format all --locale es`.

## Handoff a Fase 2

Antes de entregar a un generador externo:

1. `dsl validate` debe terminar sin errores.
2. `dsl preview --no-open --format all --locale es` debe mostrar solo advertencias aceptadas o decisiones ya documentadas.
3. Los artefactos deben declarar que y para que, no clases, anotaciones, SQL fisico ni decisiones de framework.
4. No agregues codigo fuente generado a este repositorio; la generacion pertenece a la Fase 2.

Cuando una caracteristica nueva amplie el schema, deja al generador una serie de tareas de handoff:
- Object storage (buckets): [docs/proposals/object-storage-phase2-tasks.md](proposals/object-storage-phase2-tasks.md).

## Ejemplo de referencia

El ejemplo `examples/canasta-familiar/` muestra un sistema ecommerce parcial con `catalog` y `orders`. Desde esa carpeta puedes ejecutar:

```bash
node ../../bin/dsl.js validate
node ../../bin/dsl.js preview --no-open --format all --locale es
```

Las advertencias sobre BCs no disenados son esperadas en esa muestra incremental.
