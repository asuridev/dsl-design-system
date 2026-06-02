# Catalog BC — Flujos de Validación (Given / When / Then)

> **Bounded Context:** catalog | **Paso 2 — Diseño Táctico** | Fecha: 2026-05-15  
> Prefijo de flujos: `FL-CAT-{NNN}`

---

## Matriz de Cobertura UC → Flujo

| UC | Nombre | Impl | Flujo(s) |
|----|--------|------|----------|
| UC-CAT-001 | CreateCategory | scaffold | FL-CAT-001, FL-CAT-002 |
| UC-CAT-002 | UpdateCategory | scaffold | FL-CAT-003, FL-CAT-004 |
| UC-CAT-003 | DeactivateCategory | scaffold | FL-CAT-005, FL-CAT-006 |
| UC-CAT-004 | ReactivateCategory | full | FL-CAT-007 |
| UC-CAT-005 | GetCategory | full | FL-CAT-008 |
| UC-CAT-006 | ListCategories | full | FL-CAT-009 |
| UC-CAT-007 | CreateProduct | scaffold | FL-CAT-010, FL-CAT-011, FL-CAT-012 |
| UC-CAT-008 | UpdateProduct | scaffold | FL-CAT-013, FL-CAT-014 |
| UC-CAT-009 | ActivateProduct | scaffold | FL-CAT-015, FL-CAT-016, FL-CAT-017 |
| UC-CAT-010 | DiscontinueProduct | full | FL-CAT-018 |
| UC-CAT-011 | AddProductImage | full | FL-CAT-019 |
| UC-CAT-012 | RemoveProductImage | full | FL-CAT-020 |
| UC-CAT-013 | GetProduct | full | FL-CAT-021 |
| UC-CAT-014 | ListProducts | full | FL-CAT-022 |
| UC-CAT-015 | ValidateProductsAndPrices | scaffold | FL-CAT-023, FL-CAT-024 |

---

## Categorías

---

### FL-CAT-001: CreateCategory — happy path

**Given**:
- No existe ninguna categoría con `name = "Lácteos"`.

**When**:
- `POST /api/catalog/v1/categories` con:
  ```json
  {
    "name": "Lácteos",
    "description": "Leche, quesos, yogures y derivados lácteos"
  }
  ```

**Then**:
- HTTP `201 Created`
- Header `Location: /api/catalog/v1/categories/{newCategoryId}`
- La categoría existe en BD con `status = ACTIVE`, `name = "Lácteos"`, `parentCategoryId = null`.
- `GET /categories/{newCategoryId}` retorna la categoría con todos los campos.

**Casos borde**:
- `name` con solo espacios en blanco → `422` con code `VALIDATION_ERROR` (minLength falla).
- `parentCategoryId` presente y válido → la categoría se crea con ese parent; se retorna `201`.
- `parentCategoryId` presente pero no existe → `404` con code `CATEGORY_NOT_FOUND`.
- Request duplicado con mismo `Idempotency-Key` → se retorna `201` con misma `Location` (idempotente; no se crea duplicado).

---

### FL-CAT-002: CreateCategory — nombre duplicado

**Given**:
- Existe una categoría con `name = "Limpieza"` y `status = ACTIVE`.

**When**:
- `POST /api/catalog/v1/categories` con `{ "name": "Limpieza" }`.

**Then**:
- HTTP `409 Conflict`
- Body: `{ "code": "CATEGORY_NAME_ALREADY_EXISTS", "message": "A category with name 'Limpieza' already exists." }`
- No se crea ninguna categoría nueva en BD.

---

### FL-CAT-003: UpdateCategory — cambio de nombre

> **DECISIÓN-001 (scaffold):** El handler debe:
> 1. Cargar la categoría por `id` → 404 si no existe.
> 2. Si `name` está en el body: verificar unicidad del nuevo nombre (omitiendo la categoría actual).
> 3. Si `parentCategoryId` está en el body: verificar que existe.
> 4. Llamar `category.update(name, description, parentCategoryId)` con los campos provistos.

**Given**:
- Categoría `cat-001` existe con `name = "Bebidas"`, `status = ACTIVE`.
- No existe otra categoría con `name = "Bebidas y Jugos"`.

**When**:
- `PATCH /api/catalog/v1/categories/cat-001` con `{ "name": "Bebidas y Jugos" }`.

**Then**:
- HTTP `204 No Content`
- `GET /categories/cat-001` retorna `name = "Bebidas y Jugos"`.
- `description` y `parentCategoryId` permanecen sin cambio.

**Casos borde**:
- `name` en el body es idéntico al nombre actual → `204` (sin error, la categoría no cambia efectivamente; la validación de unicidad lo excluye correctamente).
- `name` en body colisiona con otra categoría diferente → `409 CATEGORY_NAME_ALREADY_EXISTS`.
- Request sin ningún campo → `204` (PATCH vacío es válido; no se modifican campos).

---

### FL-CAT-004: UpdateCategory — categoría no encontrada

**Given**:
- No existe ninguna categoría con `id = "cat-999"`.

**When**:
- `PATCH /api/catalog/v1/categories/cat-999` con `{ "name": "Nuevo Nombre" }`.

**Then**:
- HTTP `404 Not Found`
- Body: `{ "code": "CATEGORY_NOT_FOUND" }`

---

### FL-CAT-005: DeactivateCategory — happy path

> **DECISIÓN-001 (scaffold):** El handler debe:
> 1. Cargar la categoría por `id` → 404 si no existe.
> 2. Llamar `productRepository.countActiveByCategoryId(id)`.
> 3. Si count > 0, lanzar `CATEGORY_HAS_ACTIVE_PRODUCTS` (422).
> 4. Llamar `category.deactivate()`.

**Given**:
- Categoría `cat-002` existe con `status = ACTIVE`.
- No existen productos con `status = ACTIVE` asignados a `cat-002`.

**When**:
- `PATCH /api/catalog/v1/categories/cat-002/deactivate`.

**Then**:
- HTTP `204 No Content`
- La categoría `cat-002` tiene `status = INACTIVE`.
- `GET /categories/cat-002` retorna `status = INACTIVE`.

**Casos borde**:
- Categoría ya en `INACTIVE` → `204` (idempotente; el estado no cambia).

---

### FL-CAT-006: DeactivateCategory — tiene productos activos

**Given**:
- Categoría `cat-003` existe con `status = ACTIVE`.
- Existen 3 productos con `status = ACTIVE` y `categoryId = cat-003`.

**When**:
- `PATCH /api/catalog/v1/categories/cat-003/deactivate`.

**Then**:
- HTTP `422 Unprocessable Entity`
- Body: `{ "code": "CATEGORY_HAS_ACTIVE_PRODUCTS" }`
- La categoría `cat-003` permanece en `status = ACTIVE`.

---

### FL-CAT-007: ReactivateCategory — happy path

**Given**:
- Categoría `cat-004` existe con `status = INACTIVE`.

**When**:
- `PATCH /api/catalog/v1/categories/cat-004/reactivate`.

**Then**:
- HTTP `204 No Content`
- La categoría `cat-004` tiene `status = ACTIVE`.

**Casos borde**:
- Categoría ya en `ACTIVE` → `204` (idempotente).
- Categoría `{id}` no existe → `404 CATEGORY_NOT_FOUND`.

---

### FL-CAT-008: GetCategory — happy path

**Given**:
- Categoría `cat-001` existe con `name = "Lácteos"`, `status = ACTIVE`.

**When**:
- `GET /api/catalog/v1/categories/cat-001` (sin autenticación).

**Then**:
- HTTP `200 OK`
- Body contiene: `id`, `name`, `description`, `parentCategoryId`, `status`, `createdAt`, `updatedAt`.

**Casos borde**:
- Categoría no existe → `404 CATEGORY_NOT_FOUND`.

---

### FL-CAT-009: ListCategories — con filtros

**Given**:
- Existen 5 categorías `ACTIVE` y 2 `INACTIVE`.

**When**:
- `GET /api/catalog/v1/categories?status=ACTIVE&page=1&size=10` (sin autenticación).

**Then**:
- HTTP `200 OK`
- `data` contiene exactamente 5 elementos, todos con `status = ACTIVE`.
- `total = 5`, `page = 1`, `pages = 1`.
- Elementos ordenados por `name ASC`.

**Casos borde**:
- Sin filtros → retorna las 7 categorías (todas).
- `page=2&size=3` sobre 5 elementos → `data` tiene 2 elementos, `total = 5`, `page = 2`, `pages = 2`.
- `parentCategoryId=cat-001` → retorna solo subcategorías de `cat-001`.

---

## Productos

---

### FL-CAT-010: CreateProduct — happy path

> **DECISIÓN-001 (scaffold):** El handler debe:
> 1. Verificar unicidad de `sku` (findBySku) → 409 si ya existe (CAT-RULE-002).
> 2. Cargar la categoría por `categoryId` → 404 si no existe.
> 3. Verificar que la categoría tiene `status = ACTIVE` → 422 si no (CAT-RULE-008).
> 4. Llamar `Product.create(name, sku, description, price, categoryId)`.
> 5. Persistir el producto.

**Given**:
- Categoría `cat-001` existe con `status = ACTIVE`.
- No existe ningún producto con `sku = "LAC-001"`.

**When**:
- `POST /api/catalog/v1/products` con:
  ```json
  {
    "name": "Leche Entera 1L",
    "sku": "LAC-001",
    "description": "Leche entera pasteurizada 1 litro",
    "price": { "amount": "3500.0000", "currency": "COP" },
    "categoryId": "cat-001"
  }
  ```

**Then**:
- HTTP `201 Created`
- Header `Location: /api/catalog/v1/products/{newProductId}`
- El producto existe con `status = DRAFT`, `sku = "LAC-001"`, `price.amount = "3500.0000"`.

**Casos borde**:
- `price.amount = "0.0000"` → `422 VALIDATION_ERROR` (Money.amount positivo).
- `price.amount = "-100.0000"` → `422 VALIDATION_ERROR` (Money.amount positivo).
- Request duplicado con mismo `Idempotency-Key` → `201` con misma `Location` (idempotente).

---

### FL-CAT-011: CreateProduct — SKU duplicado

**Given**:
- Ya existe un producto con `sku = "LAC-001"`.

**When**:
- `POST /api/catalog/v1/products` con `sku = "LAC-001"`.

**Then**:
- HTTP `409 Conflict`
- Body: `{ "code": "PRODUCT_SKU_ALREADY_EXISTS", "message": "A product with SKU 'LAC-001' already exists." }`

---

### FL-CAT-012: CreateProduct — categoría inactiva

**Given**:
- Categoría `cat-005` existe con `status = INACTIVE`.

**When**:
- `POST /api/catalog/v1/products` con `categoryId = "cat-005"` y datos válidos.

**Then**:
- HTTP `422 Unprocessable Entity`
- Body: `{ "code": "CATEGORY_NOT_ACTIVE" }`

---

### FL-CAT-013: UpdateProduct — cambio de precio y categoría

> **DECISIÓN-001 (scaffold):** El handler debe:
> 1. Cargar el producto → 404 si no existe.
> 2. Verificar que el producto no está `DISCONTINUED` (CAT-RULE-003) → 409 si lo está.
> 3. Si `categoryId` está en el body: cargar categoría, verificar `ACTIVE` (CAT-RULE-008).
> 4. Llamar `product.update(name, description, price, categoryId)` con campos provistos.

**Given**:
- Producto `prod-001` existe con `status = ACTIVE`, `price.amount = "3500.0000"`.
- Categoría `cat-002` existe con `status = ACTIVE`.

**When**:
- `PATCH /api/catalog/v1/products/prod-001` con:
  ```json
  {
    "price": { "amount": "3800.0000", "currency": "COP" },
    "categoryId": "cat-002"
  }
  ```

**Then**:
- HTTP `204 No Content`
- `GET /products/prod-001` retorna `price.amount = "3800.0000"` y `categoryId = "cat-002"`.

---

### FL-CAT-014: UpdateProduct — producto discontinuado

**Given**:
- Producto `prod-002` existe con `status = DISCONTINUED`.

**When**:
- `PATCH /api/catalog/v1/products/prod-002` con `{ "price": { "amount": "1000.0000", "currency": "COP" } }`.

**Then**:
- HTTP `409 Conflict`
- Body: `{ "code": "PRODUCT_ALREADY_DISCONTINUED" }`
- El producto no es modificado.

---

### FL-CAT-015: ActivateProduct — happy path

> **DECISIÓN-001 (scaffold):** El handler debe:
> 1. Cargar el producto → 404 si no existe.
> 2. Cargar la categoría por `product.categoryId`.
> 3. Verificar que la categoría tiene `status = ACTIVE` → 422 si no (parte de CAT-RULE-001).
> 4. Verificar que `product.name` no está vacío y `product.price.amount > 0` (CAT-RULE-001).
> 5. Llamar `product.activate()` → emite `ProductActivated`.
> 6. Persistir el producto.
> 7. El outbox publica `ProductActivated` al broker.

**Given**:
- Producto `prod-003` existe con `status = DRAFT`, `name = "Queso Campesino 500g"`, `price.amount = "8500.0000"`.
- La categoría asignada (`cat-001`) tiene `status = ACTIVE`.

**When**:
- `PATCH /api/catalog/v1/products/prod-003/activate`.

**Then**:
- HTTP `204 No Content`
- `GET /products/prod-003` retorna `status = ACTIVE`.
- El evento `ProductActivated` fue publicado al canal `catalog.product.activated` con:
  ```json
  { "productId": "prod-003", "sku": "...", "name": "Queso Campesino 500g", "categoryId": "cat-001" }
  ```

---

### FL-CAT-016: ActivateProduct — categoría inactiva

**Given**:
- Producto `prod-004` existe con `status = DRAFT` y `categoryId = "cat-005"`.
- Categoría `cat-005` tiene `status = INACTIVE`.

**When**:
- `PATCH /api/catalog/v1/products/prod-004/activate`.

**Then**:
- HTTP `422 Unprocessable Entity`
- Body: `{ "code": "PRODUCT_NOT_READY_FOR_ACTIVATION" }`
- El producto permanece en `status = DRAFT`.
- No se emite ningún evento.

---

### FL-CAT-017: ActivateProduct — producto ya activo

**Given**:
- Producto `prod-003` tiene `status = ACTIVE`.

**When**:
- `PATCH /api/catalog/v1/products/prod-003/activate`.

**Then**:
- HTTP `204 No Content` (idempotente — el estado ya es ACTIVE, la transición no ocurre pero tampoco falla).

> **Nota de implementación:** El domainMethod `activate()` debe verificar si el estado ya es ACTIVE y, si es así, retornar sin emitir un segundo evento `ProductActivated`.

---

### FL-CAT-018: DiscontinueProduct — happy path

**Given**:
- Producto `prod-005` existe con `status = ACTIVE`, `sku = "LAC-002"`.

**When**:
- `PATCH /api/catalog/v1/products/prod-005/discontinue`.

**Then**:
- HTTP `204 No Content`
- `GET /products/prod-005` retorna `status = DISCONTINUED`.
- El evento `ProductDiscontinued` fue publicado al canal `catalog.product.discontinued` con:
  ```json
  { "productId": "prod-005", "sku": "LAC-002" }
  ```

**Casos borde**:
- Producto ya en `DISCONTINUED` → `204` (idempotente; no se emite segundo evento).
- Producto no existe → `404 PRODUCT_NOT_FOUND`.

---

### FL-CAT-019: AddProductImage — happy path

**Given**:
- Producto `prod-001` existe con `status = ACTIVE`.

**When**:
- `POST /api/catalog/v1/products/prod-001/images` con:
  ```json
  {
    "url": "https://cdn.canastafamiliar.co/images/leche-1l-main.jpg",
    "altText": "Leche entera 1 litro",
    "imageType": "MAIN",
    "displayOrder": 0
  }
  ```

**Then**:
- HTTP `201 Created`
- Header `Location: /api/catalog/v1/products/prod-001/images/{imageId}`
- `GET /products/prod-001` incluye la imagen en el array `images`.

**Casos borde**:
- Producto no existe → `404 PRODUCT_NOT_FOUND`.
- Producto en `DISCONTINUED` → `409 PRODUCT_ALREADY_DISCONTINUED`.
- `displayOrder = -1` → `422 VALIDATION_ERROR` (positiveOrZero falla).

---

### FL-CAT-020: RemoveProductImage — happy path

**Given**:
- Producto `prod-001` existe con `status = ACTIVE`.
- La imagen `img-001` existe en el gallery del producto.

**When**:
- `DELETE /api/catalog/v1/products/prod-001/images/img-001`.

**Then**:
- HTTP `204 No Content`
- `GET /products/prod-001` ya no incluye `img-001` en el array `images`.

**Casos borde**:
- Producto no existe → `404 PRODUCT_NOT_FOUND`.
- Imagen `img-999` no existe en el gallery → `404 IMAGE_NOT_FOUND`.
- Producto en `DISCONTINUED` → `409 PRODUCT_ALREADY_DISCONTINUED`.

---

### FL-CAT-021: GetProduct — happy path

**Given**:
- Producto `prod-001` existe con `status = ACTIVE` y 2 imágenes asociadas.

**When**:
- `GET /api/catalog/v1/products/prod-001` (sin autenticación).

**Then**:
- HTTP `200 OK`
- Body `ProductDetail` contiene: `id`, `name`, `sku`, `description`, `price`, `status`, `categoryId`, `images` (2 elementos ordenados por `displayOrder ASC`), `createdAt`, `updatedAt`.

**Casos borde**:
- Producto no existe → `404 PRODUCT_NOT_FOUND`.
- Producto sin imágenes → `images = []`.

---

### FL-CAT-022: ListProducts — con filtros

**Given**:
- Existen 10 productos, 6 con `status = ACTIVE` en `categoryId = cat-001`, 4 en otras categorías.

**When**:
- `GET /api/catalog/v1/products?categoryId=cat-001&status=ACTIVE&page=1&size=5` (sin autenticación).

**Then**:
- HTTP `200 OK`
- `data` tiene 5 elementos, todos con `status = ACTIVE` y `categoryId = cat-001`.
- `total = 6`, `page = 1`, `size = 5`, `pages = 2`.

**Casos borde**:
- `search=leche` → retorna solo productos cuyo `name` o `sku` contiene "leche" (case-insensitive).
- Sin filtros → retorna todos los productos, ordenados por `createdAt DESC`.
- `size=101` → `422 VALIDATION_ERROR` (max = 100).

---

### FL-CAT-023: ValidateProductsAndPrices — happy path

> **DECISIÓN-001 (scaffold):** El handler debe:
> 1. Validar la lista (minSize=1, maxSize=100) → 422 si falla.
> 2. Llamar `productRepository.findAllByIdIn(productIds)` para carga batch.
> 3. Construir un `ProductPriceSnapshot` por cada producto encontrado.
> 4. Retornar la lista de snapshots (puede ser más corta que `productIds` si alguno no existe).

**Given**:
- Producto `prod-001` con `status = ACTIVE`, `price = { "amount": "3500.0000", "currency": "COP" }`, `name = "Leche Entera 1L"`.
- Producto `prod-002` con `status = ACTIVE`, `price = { "amount": "8500.0000", "currency": "COP" }`, `name = "Queso Campesino 500g"`.

**When**:
- `POST /api/catalog/v1/internal/products/price-snapshot` (internal API) con:
  ```json
  { "productIds": ["prod-001", "prod-002"] }
  ```

**Then**:
- HTTP `200 OK`
- Body:
  ```json
  [
    { "productId": "prod-001", "name": "Leche Entera 1L", "price": { "amount": "3500.0000", "currency": "COP" }, "status": "ACTIVE" },
    { "productId": "prod-002", "name": "Queso Campesino 500g", "price": { "amount": "8500.0000", "currency": "COP" }, "status": "ACTIVE" }
  ]
  ```

---

### FL-CAT-024: ValidateProductsAndPrices — producto discontinuado en el cart

**Given**:
- Producto `prod-003` existe con `status = DISCONTINUED`.
- Producto `prod-004` existe con `status = ACTIVE`.

**When**:
- `POST /api/catalog/v1/internal/products/price-snapshot` con `productIds: ["prod-003", "prod-004"]`.

**Then**:
- HTTP `200 OK`
- Body contiene snapshot de `prod-003` con `status = DISCONTINUED` y snapshot de `prod-004` con `status = ACTIVE`.
- El BC `orders` detecta el status `DISCONTINUED` y rechaza el checkout para ese ítem.

**Casos borde**:
- `productIds = []` → `422 VALIDATION_ERROR` (minSize=1).
- `productIds` con 101 elementos → `422 VALIDATION_ERROR` (maxSize=100).
- `productIds` contiene un UUID que no existe en el catálogo → el snapshot de ese ID se omite de la respuesta; orders detecta el ID faltante y rechaza el checkout.
