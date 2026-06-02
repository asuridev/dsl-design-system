# Examples

Estos ejemplos son artefactos de Fase 1: diseño DDD en `arch/`. No contienen codigo generado, configuracion de runtime ni decisiones de implementacion. Sirven para aprender como se ven los YAML canonicos y para probar `dsl validate` / `dsl preview` sobre un caso realista.

## canasta-familiar

`examples/canasta-familiar/` modela una plataforma B2C de venta de productos de canasta familiar. El ejemplo esta curado desde un caso mas amplio y contiene:

- `arch/system/`: diseno estrategico del sistema, mapa de BCs, integraciones y `CheckoutSaga`.
- `arch/catalog/`: BC tactico para catalogo, productos, categorias, OpenAPI, AsyncAPI y diagramas.
- `arch/orders/`: BC tactico para carrito, checkout, pedido, Local Read Model de direcciones y participacion en saga.

El `system.yaml` conserva referencias a BCs que aun no tienen carpeta tactica completa en este ejemplo (`payments`, `inventory`, `delivery`, `customers`, `notifications`). Por eso `dsl validate` puede mostrar advertencias `INT-007`, `INT-012` o `INT-014`; son esperadas en una muestra incremental mientras no existan esos `{bc}.yaml`.

## Comandos utiles

Ejecutar desde la raiz del ejemplo:

```bash
node ../../bin/dsl.js validate
node ../../bin/dsl.js preview --no-open --format all --locale es
```

Para revisar una sola superficie tactica despues de cargar el proyecto completo:

```bash
node ../../bin/dsl.js preview --bc catalog --no-open --format all --locale es
node ../../bin/dsl.js preview --bc orders --no-open --format all --locale es
```

Evita usar `validate --bc catalog` en este ejemplo parcial: el filtro por BC no carga el contexto tactico de `orders`, y la saga puede reportar errores que no aparecen al validar el proyecto completo.
