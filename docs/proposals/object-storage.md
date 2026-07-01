# Propuesta / ADR — Almacenamiento de objetos (object storage / buckets) en el diseño

> **Estado:** ✅ implementada. Schema, validador (INT-028..031), tipo canónico `StoredObject`,
> docs y ejemplo `canasta-familiar` actualizados. Este documento queda como registro de la
> decisión (ADR).
>
> **Fase:** 1 (Diseño). El object storage se declara como **intención**; la tecnología concreta
> (S3, GCS, Azure Blob, MinIO, filesystem) la decide el generador en Fase 2.
>
> **Decisiones de las preguntas abiertas (§9):** (1) `StoredObject` es tipo canónico global
> (como `Money`). (2) `signedUrlTtl` se mantiene en diseño como intención opcional.
> (3) acceso cross-BC se permite pero se marca con INT-031 (warn). (4) los eventos al subir/borrar
> son opcionales — el framework no los exige.

---

## 1. Contexto y problema

Hoy un diseñador puede expresar **el borde HTTP** de subir/descargar archivos, pero **no dónde
viven los bytes**. El DSL ya soporta:

- `File` como tipo de input + `source: multipart` (con `partName`, `maxSize`, `contentTypes`) — subida.
- `BinaryStream` como `returns` de un query — descarga.
- El tipo canónico `Url` — devolver un enlace.

Lo que **falta** es declarar la intención *"este caso de uso persiste un binario en un store y me
devuelve una clave/URL"*. Sin ella, el binario "desaparece" del diseño: el generador no sabe que
existe un bucket, ni qué visibilidad tiene, ni cómo se produce la URL que el endpoint retorna.

Escenario motivador: un endpoint recibe un archivo (multipart); la lógica de un caso de uso lo
sube a un bucket y retorna la URL pública. Y sus variantes: bucket privado con URL firmada,
descarga vía proxy, y borrado del objeto al eliminar el agregado dueño.

### Alternativas consideradas

| Alternativa | Veredicto |
|---|---|
| **A. `externalSystems (type: storage)`** — el enum `storage` ya existe; se modela el bucket como API HTTP (`method/path/request/response`) y se referencia vía `outgoingCalls → port` (ACL). | ❌ **Rechazada.** No requiere cambios de schema, pero obliga a describir el bucket como una API REST concreta (semántica tipo S3: `PUT /{bucket}/{key}`). Eso **filtra implementación** y rompe el agnosticismo que exige `VISION.md`: el mismo YAML ya no alimentaría un generador de filesystem o GCS sin reescribir operaciones. |
| **B. `infrastructure.objectStorage`** — capacidad de infraestructura agnóstica, hermana de `database`/`messageBroker`/`authServer`. | ✅ **Elegida.** Declara intención (`visibility`, `urlAccess`) sin amarrar proveedor ni protocolo. El generador decide bucket, ACL, presigning, naming. Coherente con cómo ya se trata `database` (se declara `type: relational`, no "PostgreSQL"). |

---

## 2. Decisión

Modelar el almacenamiento de objetos como una **capacidad de infraestructura** declarada en
`system.yaml`, y referenciada desde los casos de uso mediante un bloque táctico `storageCalls[]`.
La forma del binario almacenado se modela con un tipo canónico compuesto `StoredObject`.

Tres piezas coordinadas:

1. **Estratégico** (`system.yaml`): `infrastructure.objectStorage[]` — qué stores existen y su intención.
2. **Táctico** (`{bc-name}.yaml`): tipo canónico `StoredObject` + bloque `storageCalls[]` en el UC.
3. **Validación**: reglas INT-028..031 que garantizan coherencia store ↔ uso.

---

## 3. Schema estratégico — `infrastructure.objectStorage`

Lista de *stores* lógicos. **Omitir el bloque** si el sistema no almacena binarios.

```yaml
infrastructure:
  objectStorage:                 # OMITIR si no hay almacenamiento de binarios
    - name: product-media        # kebab-case — nombre lógico del store
      visibility: public         # public | private
      urlAccess: public-url      # public-url | signed-url
      ownedBy: catalog           # BC dueño (debe existir en boundedContexts)
      signedUrlTtl: PT15M        # opcional, ISO-8601 Duration; solo si urlAccess: signed-url
      notes: >
        Imágenes de producto servidas públicamente vía CDN.
```

| Campo | Obligatorio | Valores | Significado (intención) |
|---|---|---|---|
| `name` | sí | kebab-case | Nombre lógico del store. Referenciado por `storageCalls[].store`. |
| `visibility` | sí | `public` \| `private` | ¿Los objetos son legibles sin autorización? |
| `urlAccess` | sí | `public-url` \| `signed-url` | Cómo se produce la URL de acceso: enlace estable vs. firmado/temporal. |
| `ownedBy` | sí | nombre de BC | BC responsable del store. Debe existir en `boundedContexts`. |
| `signedUrlTtl` | no | ISO-8601 Duration | Vigencia del enlace firmado. Solo con `urlAccess: signed-url`. |
| `notes` | no | prosa | Aclaración de propósito. |

**Lo que NO se declara aquí** (decisión del generador, Fase 2): proveedor, región, nombre real del
bucket, endpoint, credenciales, política IAM, CDN, algoritmo de firma.

Coherencia con el resto de `infrastructure`: nótese que `messageBroker: true` es un booleano y
`database.type` es una categoría; `objectStorage` sigue el mismo principio — declara la **categoría
de capacidad**, nunca el producto.

---

## 4. Schema táctico — `{bc-name}.yaml`

### 4.1 Tipo canónico `StoredObject`

Tipo compuesto (análogo a `Money`) que evita redeclarar la forma del binario almacenado en cada BC:

```
StoredObject  →  { storageKey: String, url: Url, contentType: String, sizeBytes: Long }
```

| Campo | Tipo | Significado |
|---|---|---|
| `storageKey` | `String` | Clave/identificador del objeto dentro del store. Es lo que persiste el agregado. |
| `url` | `Url` | URL de acceso. Estable si el store es `public-url`; vacía o firmada en lectura si es `signed-url`. |
| `contentType` | `String` | MIME type del objeto. |
| `sizeBytes` | `Long` | Tamaño en bytes. |

Se usa como `type` de una propiedad del agregado (ej. `image: StoredObject`) o de una projection de
respuesta. Para stores privados, el agregado normalmente persiste solo `storageKey` y la `url`
firmada se materializa en lectura (ver combinación #2).

### 4.2 Bloque `storageCalls[]` en el use case

Se introduce un bloque nuevo en el UC, **paralelo a `outgoingCalls[]`** pero distinto: los
`outgoingCalls` exigen un `port` declarado en `integrations.outbound[]` (integración BC↔BC o
externa), mientras que el object storage es **infraestructura**, no una integración. Mezclarlos
obligaría a declarar el bucket como `externalSystem` (alternativa A, rechazada).

```yaml
storageCalls:
  - store: product-media     # debe existir en infrastructure.objectStorage[].name
    operation: put           # put | signUrl | get | delete
    input: image             # nombre del input File (put) o del campo que aporta el storageKey
    bindsTo: image           # param del domainMethod que recibe el StoredObject / Url resultante
```

| `operation` | Entrada | Resultado | Uso |
|---|---|---|---|
| `put` | input `File` (multipart) | `StoredObject` | Subir un binario y obtener su clave/URL. |
| `signUrl` | `storageKey` | `Url` (firmada) | Producir un enlace temporal para un objeto privado. |
| `get` | `storageKey` | `BinaryStream` | Leer el objeto para servirlo por proxy. |
| `delete` | `storageKey` | `void` | Eliminar el objeto del store. |

`bindsTo` enlaza el resultado con un parámetro del `domainMethod` del UC (mismo mecanismo que
`outgoingCalls[].bindsTo`), preservando la trazabilidad.

---

## 5. Las cuatro combinaciones

### 5.1 Subida → URL pública

El endpoint recibe el archivo; el UC lo sube a un bucket público y retorna la URL estable.

```yaml
# system.yaml
infrastructure:
  objectStorage:
    - name: product-media
      visibility: public
      urlAccess: public-url
      ownedBy: catalog
```

```yaml
# catalog.yaml
valueObjects:
  - name: ProductImage
    description: Imagen asociada a un producto, persistida en el store de media.
    properties:
      - { name: storageKey,  type: String, required: true }
      - { name: url,         type: Url,    required: true }
      - { name: contentType, type: String, required: true }
      - { name: sizeBytes,   type: Long,   required: true }

useCases:
  - id: UC-CAT-011
    name: UploadProductImage
    type: command
    actor: operator
    trigger: { kind: http, operationId: uploadProductImage }
    aggregate: Product
    method: attachImage
    input:
      - { name: id,    type: Uuid, required: true, source: path, loadAggregate: true }
      - name: image
        type: File
        required: true
        source: multipart
        partName: image
        maxSize: 5MB
        contentTypes: [image/png, image/jpeg, image/webp]
    storageCalls:
      - { store: product-media, operation: put, input: image, bindsTo: image }
    notFoundError: [PRODUCT_NOT_FOUND]
    returns: ProductImageResponse     # projection con url: Url
    implementation: scaffold
```

**OpenAPI:** `requestBody` con `multipart/form-data`; respuesta `200`/`201` `application/json` con
el campo `url`.

### 5.2 Subida privada → URL firmada

El binario se guarda en un bucket privado; el agregado persiste solo `storageKey`. La URL de acceso
se firma en el momento de lectura.

```yaml
# system.yaml
infrastructure:
  objectStorage:
    - name: invoice-pdf
      visibility: private
      urlAccess: signed-url
      signedUrlTtl: PT15M
      ownedBy: billing
```

```yaml
# billing.yaml
useCases:
  # Subida: persiste storageKey
  - id: UC-BIL-004
    name: UploadInvoiceDocument
    type: command
    actor: system
    trigger: { kind: http, operationId: uploadInvoiceDocument }
    aggregate: Invoice
    method: attachDocument
    input:
      - { name: id,       type: Uuid, required: true, source: path, loadAggregate: true }
      - { name: document, type: File, required: true, source: multipart,
          partName: document, maxSize: 10MB, contentTypes: [application/pdf] }
    storageCalls:
      - { store: invoice-pdf, operation: put, input: document, bindsTo: document }
    returns: void
    implementation: scaffold

  # Lectura: firma una URL temporal para el storageKey persistido
  - id: UC-BIL-005
    name: GetInvoiceDocumentUrl
    type: query
    actor: customer
    trigger: { kind: http, operationId: getInvoiceDocumentUrl }
    aggregate: Invoice
    input:
      - { name: id, type: Uuid, required: true, source: path, loadAggregate: true }
    storageCalls:
      - { store: invoice-pdf, operation: signUrl, input: documentKey, bindsTo: signedUrl }
    returns: SignedUrlResponse        # projection con url: Url (firmada, temporal)
    implementation: scaffold
```

**OpenAPI:** la lectura retorna `application/json` con la `url` firmada; el cliente la usa
directamente contra el store. El backend nunca expone credenciales del bucket.

### 5.3 Descarga (proxy)

El backend lee el objeto del store y lo devuelve por el endpoint; el bucket no se expone al cliente.

```yaml
# delivery.yaml
useCases:
  - id: UC-DEL-007
    name: DownloadDeliveryProof
    type: query
    actor: operator
    trigger: { kind: http, operationId: downloadDeliveryProof }
    aggregate: Delivery
    input:
      - { name: id, type: Uuid, required: true, source: path, loadAggregate: true }
    storageCalls:
      - { store: delivery-proofs, operation: get, input: proofKey, bindsTo: proofStream }
    returns: BinaryStream
    implementation: scaffold
```

**OpenAPI:** respuesta binaria (`application/octet-stream` o el MIME concreto) con
`Content-Disposition`. Reutiliza el soporte existente de `BinaryStream`.

### 5.4 Borrado / ciclo de vida

El UC elimina el objeto del store, típicamente como efecto del borrado del agregado dueño.

```yaml
# catalog.yaml
useCases:
  - id: UC-CAT-012
    name: RemoveProductImage
    type: command
    actor: operator
    trigger: { kind: http, operationId: removeProductImage }
    aggregate: Product
    method: removeImage
    input:
      - { name: id, type: Uuid, required: true, source: path, loadAggregate: true }
    storageCalls:
      - { store: product-media, operation: delete, input: imageKey, bindsTo: removedKey }
    notFoundError: [PRODUCT_NOT_FOUND]
    returns: void
    implementation: scaffold
```

**OpenAPI:** `DELETE` → `204 No Content`.

---

## 6. Tabla intención → implementación

| El diseño declara | El generador decide |
|---|---|
| `objectStorage.visibility: public` | bucket público / CDN, ACL public-read |
| `urlAccess: signed-url` + `signedUrlTtl` | presigned URL, firma HMAC, expiración |
| `storageCalls.operation: put` | `putObject`, multipart upload, headers de content-type |
| `operation: signUrl` | `generatePresignedUrl(key, ttl)` |
| `operation: get` / `returns: BinaryStream` | streaming, `Content-Disposition` |
| `operation: delete` | `deleteObject`, lifecycle policy |
| `File` + `source: multipart` | `MultipartFile`, `@RequestPart`, streaming de subida |
| `StoredObject.storageKey` | columna varchar + estrategia de naming (uuid/path) |
| `ownedBy: catalog` | módulo/esquema donde vive el adaptador de storage |

El mismo YAML debe alimentar un generador Spring Boot + S3, otro Django + GCS y otro NestJS +
filesystem sin cambiar una línea del diseño.

---

## 7. Reglas de validación propuestas

| ID | Severidad | Regla |
|---|---|---|
| **INT-028** | 🔴 ERROR | Todo `useCases[].storageCalls[].store` debe coincidir con un `infrastructure.objectStorage[].name` declarado. |
| **INT-029** | 🔴 ERROR | `operation: signUrl` solo es válido si el store referenciado tiene `urlAccess: signed-url` (contradicción con `public-url`). |
| **INT-030** | 🟡 WARN | Un `storageCalls: put` debería convivir con un input `File`/`source: multipart` en el mismo UC (coherencia de subida). |
| **INT-031** | 🟡 WARN | `objectStorage[].ownedBy` debe ser un BC declarado; `storageCalls` desde un BC distinto al `ownedBy` se marca (acceso cruzado a storage — revisar si debería pasar por el BC dueño). |

Consideración adicional para `system.yaml` (consistencia, junto a las reglas existentes): si algún
BC declara `storageCalls`, debe existir el bloque `infrastructure.objectStorage` con el store
correspondiente — corolario directo de INT-028.

---

## 8. Checklist de implementación futura

Cuando se apruebe formalizar la convención (no forma parte de esta propuesta):

- `src/skills/ddd-step1-authoring/references/system-yaml-schema.md` y `system-yaml-guide.md`
  — documentar `infrastructure.objectStorage`.
- `src/skills/ddd-tactical-design/references/bc-yaml-schema.md`, `bc-yaml-guide.md`,
  `canonical-types.md`, `openapi-conventions.md` — documentar `StoredObject` y `storageCalls`.
- `src/utils/canonical-types.js` — registrar el tipo `StoredObject`.
- `src/utils/integration-validator.js` — implementar INT-028..031.
- `docs/artifact-reference.md` — añadir el vocabulario de campos y los tipos.
- `examples/canasta-familiar/` — UC de subida real en `catalog` (combinación #1) como referencia.
- `test/` — casos de validación para las nuevas reglas.

---

## 9. Preguntas abiertas

1. **`StoredObject` canónico vs. VO por BC.** ¿Se registra como tipo canónico global (como `Money`)
   o cada BC declara su propio VO (`ProductImage`, `InvoiceDocument`) con la misma forma? El canónico
   reduce duplicación; el VO por BC permite invariantes propias (ej. `contentTypes` permitidos).
2. **`signedUrlTtl` en diseño o en generador.** El TTL es a la vez intención de negocio (cuánto vale
   un enlace) y política de implementación. ¿Pertenece al diseño o se delega al generador?
3. **Storage compartido entre BCs.** ¿Se permite que un BC distinto al `ownedBy` haga `storageCalls`
   sobre un store, o debe enrutarse siempre por el BC dueño (INT-031 como ERROR en vez de WARN)?
4. **Relación con eventos de dominio.** Cuando se sube/borra un objeto, ¿debe emitirse un evento
   (`ProductImageUploaded`) para que otros BCs reaccionen, o el storage es siempre un detalle local?
