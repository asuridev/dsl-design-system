# Tipos de Relaciones — Convenciones del Paso 2

Define cómo se declaran relaciones entre objetos del dominio en `{bc-name}.yaml`.

---

## Tabla de Tipos de Relación

| Tipo | Cuándo usarlo | YAML example |
|------|--------------|-------------|
| `composition` | Entidad que solo existe dentro del agregado root — su ciclo de vida es propiedad del root | Ver §1 |
| `association` | Referencia a otro agregado del mismo BC por su ID — el referenciado tiene vida propia | Ver §2 |
| `association` (cross-BC) | Referencia a un agregado de otro BC por su ID — nunca objeto embebido | Ver §3 |

---

## §1 Composition — Entidad dentro del Agregado

Usar cuando la entidad **no tiene identidad fuera** del aggregado root. Siempre se
accede a través del root. Si el root se elimina, la entidad también se elimina.

```yaml
aggregates:
  - name: Order
    root: Order
    entities:
      - name: OrderLine            # solo existe dentro de Order
        relationship: composition
        cardinality: oneToMany   # Order "1" → "0..*" OrderLine
        description: Line items of the order.
        properties:
          - name: id
            type: Uuid
            required: true
          - name: productId        # referencia a Product (otro aggregate)
            type: Uuid
            required: true
            references: Product
            relationship: association
            bc: catalog            # cross-BC porque Product es de catalog BC
          - name: quantity
            type: Integer
            required: true
```

**Cardinalidades válidas para composition:**
- `oneToOne` — el root tiene exactamente una entidad (ej: Order → ShippingAddress)
- `oneToMany` — el root tiene cero o más entidades (ej: Order → OrderLine[])

---

## §2 Association — Mismo BC

Usar cuando se referencia a otro agregado del **mismo BC** por su identificador.
Nunca se embebe el objeto completo.

```yaml
- name: categoryId
  type: Uuid
  required: true
  references: Category       # nombre del agregado referenciado
  relationship: association
  cardinality: manyToOne   # muchos Products pertenecen a una Category
  description: Reference to the Category this product belongs to.
```

**Cardinalidades válidas para association:**
- `manyToOne` — la propiedad es una FK (el más común)
- `oneToOne` — el agregado tiene una sola instancia relacionada
- `manyToMany` — modelar como Junction Entity con composition (ver §4)

---

## §3 Association — Cross-BC (otro Bounded Context)

Cuando la referencia cruza la frontera del BC, agregar el campo `bc` con el nombre
del bounded context propietario del agregado referenciado.

```yaml
- name: customerId
  type: Uuid
  required: true
  references: Customer       # nombre del agregado en el BC externo
  relationship: association
  cardinality: manyToOne
  bc: customers              # BC propietario del agregado Customer
  description: Customer who placed this order.
```

**Reglas críticas de cross-BC:**
- Nunca embeber propiedades del agregado externo en el agregado propio
- Si se necesitan datos del referenciado para el renderizado → leerlos del BC propietario
  vía integración sincrónica (inbound del otro BC) o snapshot al momento del evento
- El BC que referencia **no importa el modelo** del BC referenciado — solo el ID

---

## §4 Many-to-Many — Junction Entity

Cuando existe una relación muchos-a-muchos, modelarla como una **entidad de unión**
con `relationship: composition` dentro del agregado más relevante del negocio.

```yaml
# Ejemplo: un Driver puede tener muchas Zones, una Zone tiene muchos Drivers
aggregates:
  - name: Driver
    root: Driver
    entities:
      - name: DriverZone         # junction entity
        relationship: composition
        cardinality: oneToMany
        description: Coverage zones assigned to this driver.
        properties:
          - name: id
            type: Uuid
            required: true
          - name: zoneId
            type: Uuid
            required: true
            references: Zone
            relationship: association
            cardinality: manyToOne
          - name: assignedAt
            type: DateTime
            required: true
```

---

## §5 Snapshot — Datos Desnormalizados al Momento del Evento

Cuando el negocio requiere preservar el estado de un referenciado **en el momento
en que ocurrió algo** (ej: precio del producto al momento del checkout, nombre
del cliente cuando se creó el pedido), modelarlo como Value Object con los campos
relevantes copiados — no como association.

```yaml
entities:
  - name: OrderLine
    relationship: composition
    cardinality: oneToMany
    properties:
      - name: productId
        type: Uuid
        required: true
        references: Product
        relationship: association
        bc: catalog
      - name: productName          # snapshot — no leer de catalog en el futuro
        type: String(200)
        required: true
        description: Product name at the time of checkout.
      - name: unitPrice            # snapshot del precio al momento del checkout
        type: Money
        required: true
        description: Unit price at the time of checkout.
```

**Cuándo usar snapshot en lugar de association:**
- El valor puede cambiar en el futuro pero el registro histórico debe ser inmutable
- El referenciado pertenece a otro BC y la latencia de consulta es inaceptable
- El evento de dominio incluye los datos para evitar lookups futuros

---

## Resumen Visual

```
Dentro del mismo agregado:
  Root ──composition──► Entity (oneToMany o oneToOne)
  Entity ──association──► OtroAgregado [mismo BC]

Entre agregados del mismo BC:
  Aggregate ──association──► OtroAgregado [mismo BC]
  (solo por ID, campo: references: NombreAgregado)

Entre BCs:
  Aggregate ──association──► AgregadoExterno [bc: otro-bc]
  (solo por ID, campos: references: Nombre, bc: otro-bc)

Snapshot (datos históricos):
  Entity contiene campos copiados del referenciado, más la FK por ID
```

---

## §6 Composition — Entidad anidada dentro de otra Entidad

**Cuándo usar:** una entidad tiene sub-elementos con ciclo de vida dependiente y sin significado fuera de su entidad padre.

**Regla clave:** la raíz del agregado sigue siendo el dueño de la transacción; la FK en la tabla de la entidad anidada apunta a la entidad padre (no a la raíz).

**Restricción:** máximo un nivel de anidación. Si se necesita un tercer nivel, es señal de que el agregado debe rediseñarse.

```yaml
aggregates:
  - name: Product
    root: Product
    entities:
      - name: Variant
        relationship: composition
        cardinality: oneToMany
        description: Size/color variant of a product.
        properties:
          - name: id
            type: Uuid
            required: true
          - name: sku
            type: String(100)
            required: true
        entities:                        # ← entidades anidadas dentro de Variant
          - name: VariantImage
            relationship: composition
            cardinality: oneToMany
            description: Images specific to this variant.
            properties:
              - name: id
                type: Uuid
                required: true
              - name: url
                type: Url
                required: true
```

**Tabla DB generada:** `variant_image` con columnas `id`, `url` y FK `variant_id → variant.id` (NO `product_id`).
