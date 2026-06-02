# Catalog BC — Especificación de Casos de Uso

> **Bounded Context:** catalog | **Tipo:** Core  
> **Paso 2 — Diseño Táctico** | Fecha: 2026-05-15  
> Fuente de verdad táctica: `arch/catalog/catalog.yaml`

---

## Actores

| Actor | Descripción |
|-------|-------------|
| `customer` | Consumidor B2C autenticado o anónimo que navega el catálogo. Acceso de solo lectura (endpoints públicos). |
| `admin` | Operador del back-office que gestiona el catálogo: crea, edita, activa y discontinúa productos y categorías. |
| `system` | El BC `orders` que llama sincrónicamente al endpoint interno de validación de precios en el momento del checkout. |

---

## Prefijo de IDs: `UC-CAT-{NNN}`

---

## Categorías

---

### UC-CAT-001: CreateCategory

**Actor principal**: admin

**Precondiciones**:
- El usuario autenticado tiene el rol `ROLE_ADMIN`.
- El `name` proporcionado no existe en ninguna otra categoría (CAT-RULE-005).
- Si se proporciona `parentCategoryId`, la categoría padre debe existir.

**Flujo principal**:
1. El admin envía `POST /categories` con `name`, `description?` y `parentCategoryId?`.
2. El sistema verifica que no existe otra categoría con el mismo `name`.
3. Si se proporciona `parentCategoryId`, el sistema verifica que la categoría padre existe.
4. El sistema crea la categoría con `status = ACTIVE`.
5. El sistema responde `201 Created` con el header `Location: /api/catalog/v1/categories/{id}`.

**Flujos de excepción**:
- **1a** — Ya existe una categoría con el mismo nombre: `409 Conflict` con code `CATEGORY_NAME_ALREADY_EXISTS`.
- **1b** — El `parentCategoryId` proporcionado no corresponde a ninguna categoría: `404 Not Found` con code `CATEGORY_NOT_FOUND`.

**Postcondiciones**:
- La categoría existe con `status = ACTIVE`.
- La categoría es consultable por `GET /categories/{id}` y aparece en `GET /categories`.

**Reglas de negocio**: `CAT-RULE-005`

**Eventos emitidos**: ninguno

---

### UC-CAT-002: UpdateCategory

**Actor principal**: admin

**Precondiciones**:
- La categoría identificada por `{id}` existe.
- El usuario autenticado tiene el rol `ROLE_ADMIN`.
- Si se proporciona `name`, el nuevo nombre no existe en ninguna otra categoría (CAT-RULE-005).

**Flujo principal**:
1. El admin envía `PATCH /categories/{id}` con uno o más campos opcionales (`name?`, `description?`, `parentCategoryId?`).
2. El sistema carga la categoría por `id`.
3. Si `name` fue proporcionado, el sistema verifica unicidad del nuevo nombre (omitiendo la categoría actual).
4. Si `parentCategoryId` fue proporcionado, el sistema verifica que la categoría padre existe.
5. El sistema aplica los cambios a los campos provistos.
6. El sistema responde `204 No Content`.

**Flujos de excepción**:
- **2a** — La categoría `{id}` no existe: `404 Not Found` con code `CATEGORY_NOT_FOUND`.
- **2b** — El nuevo `name` ya existe en otra categoría: `409 Conflict` con code `CATEGORY_NAME_ALREADY_EXISTS`. _(Solo aplica si `name` fue proporcionado en el request.)_
- **2c** — El `parentCategoryId` proporcionado no existe: `404 Not Found` con code `CATEGORY_NOT_FOUND`. _(Solo aplica si `parentCategoryId` fue proporcionado en el request.)_

**Postcondiciones**:
- Los campos proporcionados de la categoría son actualizados.
- Los campos no proporcionados permanecen sin cambio.

**Reglas de negocio**: `CAT-RULE-005`

**Eventos emitidos**: ninguno

---

### UC-CAT-003: DeactivateCategory

**Actor principal**: admin

**Precondiciones**:
- La categoría identificada por `{id}` existe.
- La categoría está en estado `ACTIVE`.
- No existen productos en estado `ACTIVE` asignados a esta categoría (CAT-RULE-006).
- El usuario autenticado tiene el rol `ROLE_ADMIN`.

**Flujo principal**:
1. El admin envía `PATCH /categories/{id}/deactivate`.
2. El sistema carga la categoría por `id`.
3. El sistema cuenta los productos ACTIVE asignados a la categoría (`countActiveByCategoryId`).
4. Si el conteo es 0, el sistema transiciona el estado a `INACTIVE`.
5. El sistema responde `204 No Content`.

**Flujos de excepción**:
- **2a** — La categoría `{id}` no existe: `404 Not Found` con code `CATEGORY_NOT_FOUND`.
- **3a** — Existen productos ACTIVE asignados a la categoría: `422 Unprocessable Entity` con code `CATEGORY_HAS_ACTIVE_PRODUCTS`.

**Postcondiciones**:
- La categoría tiene `status = INACTIVE`.
- La categoría no aparece en el catálogo de clientes.
- Los productos previamente asignados no son afectados (siguen con su estado actual).

**Reglas de negocio**: `CAT-RULE-006`

**Eventos emitidos**: ninguno

---

### UC-CAT-004: ReactivateCategory

**Actor principal**: admin

**Precondiciones**:
- La categoría identificada por `{id}` existe.
- La categoría está en estado `INACTIVE`.
- El usuario autenticado tiene el rol `ROLE_ADMIN`.

**Flujo principal**:
1. El admin envía `PATCH /categories/{id}/reactivate`.
2. El sistema carga la categoría por `id`.
3. El sistema transiciona el estado a `ACTIVE`.
4. El sistema responde `204 No Content`.

**Flujos de excepción**:
- **2a** — La categoría `{id}` no existe: `404 Not Found` con code `CATEGORY_NOT_FOUND`.

**Postcondiciones**:
- La categoría tiene `status = ACTIVE`.
- Los productos ACTIVE asignados a ella quedan habilitados para el checkout.

**Reglas de negocio**: ninguna adicional

**Eventos emitidos**: ninguno

---

### UC-CAT-005: GetCategory

**Actor principal**: customer (público — sin autenticación requerida)

**Precondiciones**:
- Ninguna — endpoint público.

**Flujo principal**:
1. El cliente (o sistema) solicita `GET /categories/{id}`.
2. El sistema carga la categoría por `id`.
3. El sistema responde `200 OK` con el detalle completo de la categoría.

**Flujos de excepción**:
- **2a** — La categoría `{id}` no existe: `404 Not Found` con code `CATEGORY_NOT_FOUND`.

**Postcondiciones**: ninguna (operación de solo lectura).

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CAT-006: ListCategories

**Actor principal**: customer (público — sin autenticación requerida)

**Precondiciones**:
- Ninguna — endpoint público.

**Flujo principal**:
1. El cliente solicita `GET /categories` con parámetros opcionales `status?`, `parentCategoryId?`, `page?`, `size?`.
2. El sistema aplica los filtros provistos.
3. El sistema responde `200 OK` con una página de `CategorySummary`, ordenados alfabéticamente por `name`.

**Flujos alternativos**:
- **1a** — Sin filtros: se retornan todas las categorías paginadas, ordenadas por nombre.
- **1b** — `parentCategoryId` = null implícito: retorna solo categorías raíz (sin padre).

**Postcondiciones**: ninguna (operación de solo lectura).

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

## Productos

---

### UC-CAT-007: CreateProduct

**Actor principal**: admin

**Precondiciones**:
- El usuario autenticado tiene el rol `ROLE_ADMIN`.
- El `sku` proporcionado no existe en ningún otro producto (CAT-RULE-002).
- La `categoryId` proporcionada corresponde a una categoría existente en estado `ACTIVE` (CAT-RULE-008).

**Flujo principal**:
1. El admin envía `POST /products` con `name`, `sku`, `description?`, `price`, `categoryId`.
2. El sistema verifica que no existe otro producto con el mismo `sku`.
3. El sistema carga la categoría por `categoryId` y verifica que está en estado `ACTIVE`.
4. El sistema crea el producto con `status = DRAFT`.
5. El sistema responde `201 Created` con `Location: /api/catalog/v1/products/{id}`.

**Flujos de excepción**:
- **2a** — Ya existe un producto con el mismo SKU: `409 Conflict` con code `PRODUCT_SKU_ALREADY_EXISTS`.
- **3a** — La `categoryId` no corresponde a ninguna categoría: `404 Not Found` con code `CATEGORY_NOT_FOUND`.
- **3b** — La categoría existe pero está en estado `INACTIVE`: `422 Unprocessable Entity` con code `CATEGORY_NOT_ACTIVE`.

**Postcondiciones**:
- El producto existe con `status = DRAFT`.
- El producto no es visible para los clientes hasta ser activado.

**Reglas de negocio**: `CAT-RULE-002`, `CAT-RULE-008`

**Eventos emitidos**: ninguno

---

### UC-CAT-008: UpdateProduct

**Actor principal**: admin

**Precondiciones**:
- El producto identificado por `{id}` existe.
- El usuario autenticado tiene el rol `ROLE_ADMIN`.
- El producto no está en estado `DISCONTINUED` (CAT-RULE-003).

**Flujo principal**:
1. El admin envía `PATCH /products/{id}` con uno o más campos opcionales.
2. El sistema carga el producto por `id`.
3. El sistema verifica que el producto no está `DISCONTINUED` (CAT-RULE-003 — evaluado primero).
4. Si `categoryId` fue proporcionada, el sistema verifica que la categoría existe y está `ACTIVE`.
5. Si `name` fue proporcionado (implícito — no hay unicidad de name, solo de sku).
6. El sistema aplica los cambios a los campos provistos.
7. El sistema responde `204 No Content`.

**Flujos de excepción**:
- **2a** — El producto `{id}` no existe: `404 Not Found` con code `PRODUCT_NOT_FOUND`.
- **3a** — El producto está `DISCONTINUED`: `409 Conflict` con code `PRODUCT_ALREADY_DISCONTINUED`.
- **4a** — La `categoryId` no corresponde a ninguna categoría: `404 Not Found` con code `CATEGORY_NOT_FOUND`. _(Solo aplica si `categoryId` fue proporcionado.)_
- **4b** — La categoría existe pero está `INACTIVE`: `422 Unprocessable Entity` con code `CATEGORY_NOT_ACTIVE`. _(Solo aplica si `categoryId` fue proporcionado.)_

**Postcondiciones**:
- Los campos proporcionados del producto son actualizados.

**Reglas de negocio**: `CAT-RULE-002`, `CAT-RULE-003`, `CAT-RULE-008`

**Eventos emitidos**: ninguno

---

### UC-CAT-009: ActivateProduct

**Actor principal**: admin

**Precondiciones**:
- El producto identificado por `{id}` existe.
- El producto está en estado `DRAFT` (si está `DISCONTINUED`, la activación también es bloqueada implícitamente por el terminal state).
- El producto tiene un `name` no vacío y un `price` positivo.
- La categoría asignada al producto está en estado `ACTIVE` (CAT-RULE-001).
- El usuario autenticado tiene el rol `ROLE_ADMIN`.

**Flujo principal**:
1. El admin envía `PATCH /products/{id}/activate`.
2. El sistema carga el producto por `id`.
3. El sistema carga la categoría referenciada por `product.categoryId`.
4. El sistema verifica que la categoría está `ACTIVE` (parte de CAT-RULE-001).
5. El sistema verifica que el producto tiene `name` y `price` válidos (CAT-RULE-001).
6. El sistema transiciona `status` a `ACTIVE` y emite `ProductActivated`.
7. El sistema responde `204 No Content`.

**Flujos de excepción**:
- **2a** — El producto `{id}` no existe: `404 Not Found` con code `PRODUCT_NOT_FOUND`.
- **4a** — La categoría del producto está `INACTIVE`: `422 Unprocessable Entity` con code `PRODUCT_NOT_READY_FOR_ACTIVATION`.
- **5a** — El producto no tiene los datos requeridos (price <= 0 o name vacío): `422 Unprocessable Entity` con code `PRODUCT_NOT_READY_FOR_ACTIVATION`.

**Postcondiciones**:
- El producto tiene `status = ACTIVE`.
- El producto es visible en el catálogo para clientes.
- Se ha publicado el evento `ProductActivated` con `productId`, `sku`, `name`, `categoryId`.
- El BC `inventory` recibirá el evento y creará un `StockItem` para este producto.

**Reglas de negocio**: `CAT-RULE-001`, `CAT-RULE-002`

**Eventos emitidos**: `ProductActivated`

---

### UC-CAT-010: DiscontinueProduct

**Actor principal**: admin

**Precondiciones**:
- El producto identificado por `{id}` existe.
- El usuario autenticado tiene el rol `ROLE_ADMIN`.

**Flujo principal**:
1. El admin envía `PATCH /products/{id}/discontinue`.
2. El sistema carga el producto por `id`.
3. El sistema transiciona `status` a `DISCONTINUED` y emite `ProductDiscontinued`.
4. El sistema responde `204 No Content`.

**Flujos alternativos**:
- **3a** — El producto ya estaba en estado `DISCONTINUED`: el sistema aplica la transición de forma idempotente (el estado terminal ya se alcanzó; no se emite un segundo evento).

**Postcondiciones**:
- El producto tiene `status = DISCONTINUED`.
- El producto ya no puede ser modificado (estado terminal).
- Se ha publicado el evento `ProductDiscontinued` con `productId`, `sku`.
- El BC `inventory` recibirá el evento y cerrará permanentemente el `StockItem` asociado.

**Reglas de negocio**: ninguna adicional

**Eventos emitidos**: `ProductDiscontinued`

---

### UC-CAT-011: AddProductImage

**Actor principal**: admin

**Precondiciones**:
- El producto identificado por `{id}` existe.
- El producto no está en estado `DISCONTINUED` (CAT-RULE-003).
- El usuario autenticado tiene el rol `ROLE_ADMIN`.

**Flujo principal**:
1. El admin envía `POST /products/{id}/images` con `url`, `altText?`, `imageType`, `displayOrder`.
2. El sistema carga el producto por `id`.
3. El sistema verifica que el producto no está `DISCONTINUED`.
4. El sistema agrega la imagen al gallery del producto.
5. El sistema responde `201 Created` con `Location: /api/catalog/v1/products/{id}/images/{imageId}`.

**Flujos de excepción**:
- **2a** — El producto `{id}` no existe: `404 Not Found` con code `PRODUCT_NOT_FOUND`.
- **3a** — El producto está `DISCONTINUED`: `409 Conflict` con code `PRODUCT_ALREADY_DISCONTINUED`.

**Postcondiciones**:
- La imagen existe en el gallery del producto.

**Reglas de negocio**: `CAT-RULE-003`

**Eventos emitidos**: ninguno

---

### UC-CAT-012: RemoveProductImage

**Actor principal**: admin

**Precondiciones**:
- El producto identificado por `{id}` existe.
- La imagen identificada por `{imageId}` existe dentro del gallery del producto.
- El producto no está en estado `DISCONTINUED` (CAT-RULE-003).
- El usuario autenticado tiene el rol `ROLE_ADMIN`.

**Flujo principal**:
1. El admin envía `DELETE /products/{id}/images/{imageId}`.
2. El sistema carga el producto por `id`.
3. El sistema verifica que el producto no está `DISCONTINUED`.
4. El sistema localiza la imagen por `imageId` dentro del gallery.
5. El sistema elimina la imagen del gallery.
6. El sistema responde `204 No Content`.

**Flujos de excepción**:
- **2a** — El producto `{id}` no existe: `404 Not Found` con code `PRODUCT_NOT_FOUND`.
- **3a** — El producto está `DISCONTINUED`: `409 Conflict` con code `PRODUCT_ALREADY_DISCONTINUED`.
- **4a** — La imagen `{imageId}` no existe en el gallery del producto: `404 Not Found` con code `IMAGE_NOT_FOUND`.

**Postcondiciones**:
- La imagen ya no existe en el gallery del producto.

**Reglas de negocio**: `CAT-RULE-003`

**Eventos emitidos**: ninguno

---

### UC-CAT-013: GetProduct

**Actor principal**: customer (público — sin autenticación requerida)

**Precondiciones**:
- Ninguna — endpoint público.

**Flujo principal**:
1. El cliente solicita `GET /products/{id}`.
2. El sistema carga el producto por `id` incluyendo sus imágenes.
3. El sistema responde `200 OK` con `ProductDetail` (incluye todas las imágenes ordenadas por `displayOrder`).

**Flujos de excepción**:
- **2a** — El producto `{id}` no existe: `404 Not Found` con code `PRODUCT_NOT_FOUND`.

**Postcondiciones**: ninguna (operación de solo lectura).

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CAT-014: ListProducts

**Actor principal**: customer (público — sin autenticación requerida)

**Precondiciones**:
- Ninguna — endpoint público.

**Flujo principal**:
1. El cliente solicita `GET /products` con parámetros opcionales `categoryId?`, `status?`, `search?`, `page?`, `size?`.
2. El sistema aplica los filtros provistos.
3. El sistema responde `200 OK` con una página de `ProductSummary`, ordenados por `createdAt DESC` por defecto.

**Flujos alternativos**:
- **1a** — `search` presente: el sistema busca por texto en `name` y `sku` usando `LIKE_CONTAINS`.
- **1b** — Sin filtros: retorna todos los productos paginados.

**Postcondiciones**: ninguna (operación de solo lectura).

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

## Integración (Internal API — BC orders → catalog)

---

### UC-CAT-015: ValidateProductsAndPrices

**Actor principal**: system (BC `orders` durante el checkout)

**Precondiciones**:
- La solicitud contiene un JWT válido con rol `ROLE_CUSTOMER` o `ROLE_ADMIN`.
- La lista `productIds` tiene entre 1 y 100 elementos.

**Flujo principal**:
1. El BC `orders` envía `POST /products/price-snapshot` (internal API) con `productIds: [uuid, ...]`.
2. El sistema carga todos los productos de la lista en una sola consulta batch (`findAllByIdIn`).
3. Por cada `productId` en la lista, el sistema construye un `ProductPriceSnapshot` con `productId`, `name`, `price`, `status`.
4. Si algún `productId` no existe en el catálogo, el sistema incluye un placeholder con `status = null` (o simplemente lo omite — ver nota).
5. El sistema responde `200 OK` con `List[ProductPriceSnapshot]`.

> **Nota de diseño:** El handler retorna un snapshot por cada producto encontrado. La responsabilidad de detectar productos faltantes o con `status != ACTIVE` es del BC `orders`. Si orders recibe una lista más corta que los IDs enviados, concluye que algún producto no existe y cancela el checkout.

**Flujos de excepción**:
- **1a** — La lista `productIds` está vacía o supera los 100 elementos: `422 Unprocessable Entity` con code `VALIDATION_ERROR`.

**Postcondiciones**: ninguna (operación de solo lectura).

**Reglas de negocio**: ninguna — solo lectura de datos autoritativos.

**Eventos emitidos**: ninguno
