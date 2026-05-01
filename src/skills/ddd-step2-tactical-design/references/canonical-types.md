# Tipos Canónicos — Sistema de Tipos del Paso 2

Este es el vocabulario de tipos permitidos en `{bc-name}.yaml`. Siempre usar PascalCase.
Nunca usar tipos de lenguajes de programación (`String`, `int`, `number` de TS, etc.).

---

## Tabla Completa de Tipos

| Tipo canónico | Descripción | Validación implícita |
|---------------|-------------|--------------------|
| `Uuid` | Identificador único universal | formato UUID |
| `String` | Texto sin límite de longitud conocido | — |
| `String(n)` | Texto con longitud máxima n caracteres | longitud máxima `n` |
| `Text` | Texto largo, sin restricción de longitud | — |
| `Integer` | Entero con signo, 32 bits | — |
| `Long` | Entero con signo, 64 bits | — |
| `Decimal` | Número decimal de precisión exacta | dígitos según `precision`/`scale` |
| `Boolean` | Verdadero / falso | — |
| `Date` | Fecha sin hora (año-mes-día) | formato ISO 8601 date |
| `DateTime` | Fecha y hora con timezone UTC | formato ISO 8601 datetime |
| `Duration` | Duración de tiempo | formato ISO 8601 duration |
| `Email` | Dirección de correo electrónico válida | formato email + longitud máxima 254 |
| `Url` | URL absoluta válida | formato URL absoluta |
| `Money` | Monto monetario (VO compuesto) | ver sección Money |
| `List[T]` | Lista ordenada de elementos tipo T | — |
| `Page[T]` | Resultado paginado de tipo T (solo en `repositories[].methods[].returns`) | — |
| `Map[K,V]` | Mapa clave-valor con tipos K y V | — |

> El generador de cada plataforma destino traduce estos tipos canónicos al
> sistema de tipos nativo del runtime (lenguaje + ORM/almacenamiento). El DSL
> permanece agnóstico a esa traducción.

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
| `string` | `String` o `String(n)` | minúscula es primitivo de lenguaje, no tipo del DSL |
| `int`, `number`, `float` | `Integer`, `Long`, `Decimal` | primitivos de lenguaje |
| `bool` | `Boolean` | primitivo de lenguaje |
| `date`, `timestamp` | `Date`, `DateTime` | primitivos del almacenamiento o del lenguaje |
| `any`, `object`, `{}` | Definir un VO específico | no tipado |
| `varchar(n)` | `String(n)` | tipo del almacenamiento, no del DSL |
| `bigint` | `Long` | tipo del almacenamiento, no del DSL |
| `Page<X>`, `List<X>`, `Map<K,V>` (con `<>`) | `Page[X]`, `List[X]`, `Map[K,V]` (con `[]`) | sintaxis con `<>` ajena al DSL — el generador comprueba `startsWith('Page[')` |
| `Enum<X>` | el nombre del enum directamente (ej: `CustomerStatus`) | wrapper de lenguaje — en el DSL los enums se referencian por nombre |

> **Regla mnemotécnica:** El DSL usa **corchetes** `[T]` para genéricos, nunca ángulos `<T>`.
> `Enum<X>` no existe en el DSL — se usa el nombre del tipo directamente.
