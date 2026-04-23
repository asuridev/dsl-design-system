# Convenciones OpenAPI 3.1.0 — Paso 2

Estándar: **OpenAPI Specification 3.1.0**
Referencia oficial: https://spec.openapis.org/oas/v3.1.0

---

## Cabecera Obligatoria

```yaml
openapi: "3.1.0"
info:
  title: {BC Name} BC — REST API
  description: >
    {descripción del propósito de la API en 1-2 oraciones}
  version: "1.0.0"
  contact:
    name: {BC} Team

servers:
  - url: /api/{bc-name}/v1
    description: Default server

tags:
  - name: {entidad-1}
    description: Operations related to {entidad-1}
  - name: {entidad-2}
    description: Operations related to {entidad-2}
```

---

## Convenciones de Rutas

### Recursos en plural, kebab-case

```
/categories              → colección de Category
/product-images          → colección de ProductImage
/order-lines             → colección de OrderLine
```

### Acciones de cambio de estado — sub-recursos con PATCH

```
PATCH /products/{id}/activate     → TransitionProductToActive
PATCH /products/{id}/deactivate   → TransitionProductToInactive
PATCH /orders/{id}/confirm        → ConfirmOrder
```
No usar PUT para transiciones de estado. El body puede estar vacío o contener
solo los datos adicionales necesarios para la transición.

### Consultas de integración — sub-recursos con GET

```
GET /products/{id}/validate       → ValidateForCart (consultado por Orders BC)
GET /products/{id}/availability   → CheckAvailability
```

### Patrón CQRS: Comandos sin body — Queries con body

Este sistema sigue el principio de **Command-Query Separation (CQS/CQRS)**:
- **Queries** (GET): retornan datos — response body siempre presente
- **Commands** (POST, PUT, PATCH, DELETE): producen efecto secundario — **response body vacío**

El cliente que necesite el estado actualizado debe hacer un GET posterior.

```
# QUERIES — retornan body
GET    /{recursos}                  → Listar con paginación          → 200 + body
GET    /{recursos}/{id}             → Obtener por ID                 → 200 + body
GET    /{recursos}/{id}/{consulta}  → Consulta de integración        → 200 + body

# COMMANDS — sin body de respuesta
POST   /{recursos}                  → Crear recurso                  → 201 + Location header (sin body)
PATCH  /{recursos}/{id}             → Actualizar campos              → 204 (sin body)
PATCH  /{recursos}/{id}/{accion}    → Transición de estado           → 204 (sin body)
POST   /{recursos}/{id}/{coleccion} → Agregar sub-recurso            → 201 + Location header (sin body)
DELETE /{recursos}/{id}             → Eliminar                       → 204 (sin body)
```

> El header `Location` en las respuestas 201 es la única información de retorno
> de un comando de creación — apunta a la URL del recurso creado para que el
> cliente pueda consultarlo con GET si necesita el estado completo.

---

## Schemas Obligatorios en Todos los BC

### ErrorResponse

```yaml
ErrorResponse:
  type: object
  required: [code, message]
  properties:
    code:
      type: string
      description: Machine-readable error code in SCREAMING_SNAKE_CASE.
      example: PRODUCT_NOT_FOUND
    message:
      type: string
      description: Human-readable description of the error.
      example: Product with ID abc-123 was not found.
    details:
      type: array
      description: Optional list of field-level validation errors.
      items:
        type: object
        required: [field, issue]
        properties:
          field:
            type: string
            example: name
          issue:
            type: string
            example: must not be blank
```

### Money

```yaml
Money:
  type: object
  required: [amount, currency]
  properties:
    amount:
      type: string
      description: >
        Exact monetary amount as a decimal string.
        Use string to avoid floating-point precision loss.
      pattern: '^\d+\.\d{1,4}$'
      example: "3500.0000"
    currency:
      type: string
      minLength: 3
      maxLength: 3
      description: ISO 4217 currency code.
      example: COP
```

### Página (para listados paginados)

```yaml
{Entity}Page:
  type: object
  required: [data, total, page, size, pages]
  properties:
    data:
      type: array
      items:
        $ref: '#/components/schemas/{Entity}Summary'
    total:
      type: integer
      description: Total number of items across all pages.
    page:
      type: integer
      description: Current page number (1-based).
    size:
      type: integer
      description: Number of items per page.
    pages:
      type: integer
      description: Total number of pages.
```

---

## Responses Estándar Reutilizables

```yaml
components:
  responses:
    NotFound:
      description: The requested resource was not found.
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorResponse'
          example:
            code: {ENTITY}_NOT_FOUND
            message: "{Entity} with the given ID was not found."

    Conflict:
      description: The request conflicts with the current state of the resource.
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorResponse'
          example:
            code: {ENTITY}_ALREADY_EXISTS
            message: "A {entity} with this identifier already exists."

    UnprocessableEntity:
      description: The request is well-formed but contains semantic errors.
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorResponse'
          example:
            code: VALIDATION_ERROR
            message: "One or more fields failed validation."
```

---

## Patrón de Endpoint Completo — Ejemplo Comentado

```yaml
paths:
  /products:
    post:
      summary: Create a product
      operationId: createProduct
      tags: [products]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateProductRequest'
      responses:
        "201":
          description: Product created. Use the Location header to retrieve it.
          headers:
            Location:
              description: URL of the created product resource.
              schema:
                type: string
                example: /api/catalog/v1/products/uuid-here
          # No response body — CQRS: commands do not return data
        "409":
          $ref: '#/components/responses/Conflict'
        "422":
          $ref: '#/components/responses/UnprocessableEntity'

    get:
      summary: List products
      operationId: listProducts
      tags: [products]
      parameters:
        - name: page
          in: query
          schema:
            type: integer
            default: 1
        - name: size
          in: query
          schema:
            type: integer
            default: 20
            maximum: 100
        - name: status
          in: query
          schema:
            $ref: '#/components/schemas/ProductStatus'
        - name: categoryId
          in: query
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Paginated list of products.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProductPage'
```

---

## HTTP Status Codes por Situación

| Situación | Code | Body | Cuándo usar |
|-----------|------|------|------------|
| Creación exitosa | 201 | vacío + `Location` header | POST crea un recurso |
| Query exitosa | 200 | body con datos | GET |
| Comando exitoso sin creación | 204 | vacío | PATCH, DELETE |
| Entidad no encontrada | 404 | `ErrorResponse` | ID no existe |
| Conflicto de estado | 409 | `ErrorResponse` | Duplicado, transición inválida |
| Error de validación | 422 | `ErrorResponse` | Campos inválidos, reglas de negocio violadas |
| Error de servidor | 500 | `ErrorResponse` | Error interno inesperado |

---

## Convenciones de Nomenclatura en OpenAPI

| Elemento | Convención | Ejemplo |
|----------|-----------|---------|
| `operationId` | camelCase, verbo + sustantivo | `createProduct`, `listCategories` |
| Schema names | PascalCase | `CreateProductRequest`, `ProductDetail` |
| Path parameters | camelCase | `productId`, `categoryId` |
| Query parameters | camelCase | `page`, `size`, `categoryId` |
| Header names | Kebab-Case | `X-Correlation-ID` |
| Error codes | SCREAMING_SNAKE | `PRODUCT_NOT_FOUND` |

---

## Splits de Schemas: Request vs Response

Siempre separar schemas de entrada y salida cuando difieren:

```yaml
# Request: solo lo que el cliente envía
CreateProductRequest:
  required: [name, sku, categoryId, unitOfMeasure]
  properties:
    name: ...
    sku: ...

# Response detail: lo que se retorna en detalle
ProductDetail:
  required: [id, name, sku, status, ...]
  properties:
    id: ...
    name: ...
    status: ...
    createdAt: ...

# Response summary: lo que se retorna en listados
ProductSummary:
  required: [id, name, status]
  properties:
    id: ...
    name: ...
    status: ...
```

No retornar el objeto completo del dominio en todos los endpoints. El Summary
expone solo lo necesario para listas/búsquedas. El Detail expone todo para el
panel de detalle.
