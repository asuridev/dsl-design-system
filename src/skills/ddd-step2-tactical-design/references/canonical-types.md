# Tipos Canónicos — Sistema de Tipos del Paso 2

Este es el vocabulario de tipos permitidos en `{bc-name}.yaml`. Siempre usar PascalCase.
Nunca usar tipos de lenguajes de programación (`String`, `int`, `number` de TS, etc.).

---

## Tabla Completa de Tipos

| Tipo canónico | Descripción | Java mapping | TypeScript mapping | PostgreSQL mapping | Validación implícita |
|---------------|-------------|-------------|-------------------|-------------------|--------------------|
| `Uuid` | Identificador único universal | `java.util.UUID` | `string` (UUID format) | `uuid` | formato UUID |
| `String` | Texto sin límite de longitud conocido | `String` | `string` | `text` | — |
| `String(n)` | Texto con longitud máxima n caracteres | `String` (+ @Size) | `string` | `varchar(n)` | `maxLength: n` |
| `Text` | Texto largo, sin restricción de longitud | `String` | `string` | `text` | — |
| `Integer` | Entero con signo, 32 bits | `int` / `Integer` | `number` | `integer` | — |
| `Long` | Entero con signo, 64 bits | `long` / `Long` | `number` | `bigint` | — |
| `Decimal` | Número decimal de precisión exacta | `java.math.BigDecimal` | `string` (decimal) | `numeric(p, s)` | dígitos según `precision`/`scale` |
| `Boolean` | Verdadero / falso | `boolean` / `Boolean` | `boolean` | `boolean` | — |
| `Date` | Fecha sin hora (año-mes-día) | `java.time.LocalDate` | `string` (ISO 8601 date) | `date` | formato ISO 8601 date |
| `DateTime` | Fecha y hora con timezone UTC | `java.time.Instant` | `string` (ISO 8601 datetime) | `timestamptz` | formato ISO 8601 datetime |
| `Duration` | Duración de tiempo | `java.time.Duration` | `string` (ISO 8601 duration) | `interval` | formato ISO 8601 duration |
| `Email` | Dirección de correo electrónico válida | `String` (+ @Email) | `string` | `varchar(254)` | formato email + `maxLength: 254` |
| `Url` | URL absoluta válida | `java.net.URI` | `string` | `text` | formato URL absoluta |
| `Money` | Monto monetario (VO compuesto) | VO class | VO interface | `numeric(19,4)` + `varchar(3)` | ver sección Money |
| `List[T]` | Lista ordenada de elementos tipo T | `List<T>` | `T[]` | `json` o tabla relacional | — |
| `Page[T]` | Resultado paginado de tipo T (solo en `repositories[].methods[].returns`) | `Page<T>` | `Page<T>` | N/A | — |
| `Map[K,V]` | Mapa clave-valor con tipos K y V | `Map<K,V>` | `Record<K,V>` | `jsonb` | — |

> **Regla:** nunca declarar en `validations` lo que ya está en la columna "Validación implícita".
> Por ejemplo, no escribir `maxLength: 200` en un campo `String(200)` — ya está implícito.
> Usar `validations` solo para agregar constraints que el tipo por sí solo no puede expresar
> (ej: `minLength`, `pattern`, rangos numéricos, restricciones temporales).
> Ver `references/validation.md` para el vocabulario completo de constraints.

---

## Reglas de Uso

### Decimal
Siempre acompañar con `precision` y `scale`:
```yaml
- name: amount
  type: Decimal
  precision: 19
  scale: 4
```

### String(n)
Definir `n` según la longitud real del dominio. Guías comunes:
- Nombres de personas: `String(200)`
- Emails: usar `Email` (no `String`)
- Códigos internos (SKU, códigos): `String(50)` o `String(100)`
- Slugs, rutas URL: `String(200)`
- Descripciones cortas: `String(500)`
- Descripción larga → usar `Text`

### Money
`Money` es siempre un Value Object con exactamente estas propiedades:
```yaml
value_objects:
  - name: Money
    properties:
      - name: amount
        type: Decimal
        precision: 19
        scale: 4
        required: true
      - name: currency
        type: String(3)
        required: true
        description: ISO 4217 currency code (e.g. COP, USD, EUR).
```
En APIs REST y AsyncAPI, `amount` se serializa como **string decimal** (nunca float)
para evitar pérdida de precisión en sistemas intermedios.

### DateTime vs Date
- Usar `DateTime` para cualquier timestamp de evento o auditoría (`createdAt`, `updatedAt`, `occurredAt`)
- Usar `Date` solo cuando el componente de hora no es relevante (ej: fecha de nacimiento, fecha de vencimiento de una oferta)

### List[T]
Solo usar para propiedades calculadas o derivadas que se modelan como lista en el dominio.
Si es una colección de entidades con identidad propia, modelar como entidad con `relationship: composition`.

---

## Tipos NO Permitidos

Estos tipos están prohibidos — siempre usar el equivalente canónico:

| Prohibido | Usar en su lugar | Por qué |
|-----------|-----------------|--------|
| `string` | `String` o `String(n)` | minúscula es TypeScript/Java primitivo |
| `int`, `number`, `float` | `Integer`, `Long`, `Decimal` | primitivos de lenguaje |
| `bool` | `Boolean` | primitivo de lenguaje |
| `date`, `timestamp` | `Date`, `DateTime` | primitivos SQL/lenguaje |
| `any`, `object`, `{}` | Definir un VO específico | no tipado |
| `varchar(n)` | `String(n)` | SQL puro |
| `bigint` | `Long` | SQL puro |
| `Page<X>`, `List<X>`, `Map<K,V>` (con `<>`) | `Page[X]`, `List[X]`, `Map[K,V]` (con `[]`) | sintaxis Java genérica — el generador comprueba `startsWith('Page[')` |
| `Enum<X>` | el nombre del enum directamente (ej: `CustomerStatus`) | wrapper Java — en el DSL los enums se referencian por nombre |

> **Regla mnemotécnica:** El DSL usa **corchetes** `[T]` para genéricos, nunca ángulos `<T>`.
> `Enum<X>` no existe en el DSL — se usa el nombre del tipo directamente.
