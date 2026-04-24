# Guía de Preguntas por Dominio de Negocio

Esta referencia orienta qué preguntas hacer según el tipo de sistema.
El objetivo es reducir el número de preguntas al mínimo necesario.

---

## Principio General

Antes de preguntar, extrae del contexto libre del usuario:
- ¿Qué se vende o entrega? → define si hay catálogo, inventario, fulfillment
- ¿Quién compra? → define actores y segmento (B2C, B2B)
- ¿Cómo se cobra? → define complejidad del BC Pagos
- ¿Cómo llega al cliente? → define BC de Despacho/Logística/Entrega

Si el usuario ya respondió alguna de estas preguntas en su descripción, NO vuelvas a preguntarla.

---

## E-Commerce / Venta de Productos Físicos

### Preguntas prioritarias (en orden de impacto en el diseño)

1. **Modelo de negocio**
   - Tienda propia (inventario propio)
   - Marketplace (vendors externos)
   - Híbrido

2. **Fulfillment**
   - Flota propia
   - Operador logístico externo
   - Click & Collect (retiro en tienda)
   - Digital (sin entrega física)

3. **Inventario**
   - Centralizado (una bodega)
   - Distribuido (varias bodegas/tiendas)
   - Sin inventario propio (dropshipping / sincronización con proveedor)

4. **Medios de pago** (multiselect)
5. **Funcionalidades del lanzamiento** (multiselect — evitar feature creep)
6. **Sistemas externos ya definidos**

### BCs que aparecen casi siempre
`Clientes`, `Catálogo`, `Pedidos`, `Pagos`, `Notificaciones`

### BCs que dependen de las respuestas
- `Inventario` → si hay inventario propio
- `Despacho` → si hay entrega propia o seguimiento
- `Facturación` → si hay obligación tributaria o el usuario lo menciona
- `Vendedores` → si es marketplace
- `Fidelización` → si hay programa de puntos

---

## Venta de Seguros

### Preguntas prioritarias

1. **Tipo de seguros** (vida, hogar, auto, salud, viaje — define las entidades del producto)
2. **Canal de venta** (directo digital, agentes, corredores, mixto)
3. **¿Cotización online o requiere análisis manual?** (define si hay BC de Suscripción/Underwriting)
4. **Gestión de siniestros** (¿forma parte del alcance inicial?)
5. **Renovaciones** (automáticas, manuales, con notificación)
6. **Medios de pago** y **frecuencia** (mensual, anual, único)

### BCs que aparecen casi siempre
`Clientes`, `Productos (Pólizas)`, `Cotizaciones`, `Emisión`, `Pagos`, `Notificaciones`

### BCs que dependen de las respuestas
- `Siniestros` → si la gestión de claims está en alcance
- `Agentes/Corredores` → si hay canal indirecto
- `Renovaciones` → si es un proceso diferenciado
- `Documentos` → si hay generación de pólizas, certificados

---

## Venta de Tickets / Eventos

### Preguntas prioritarias

1. **Tipo de eventos** (conciertos, deportes, teatro, conferencias — afecta el modelo de asientos)
2. **¿Tiene asientos numerados?** (define si existe BC de Mapa de Asientos)
3. **¿El organizador es tercero o plataforma propia?** (define si hay BC de Organizadores)
4. **¿Tickets físicos, digitales (QR), o ambos?**
5. **¿Reventa entre usuarios?** (agrega BC de Reventa)
6. **Medios de pago**
7. **¿Gestión de aforo/capacidad en tiempo real?**

### BCs que aparecen casi siempre
`Clientes`, `Eventos`, `Tickets`, `Pedidos`, `Pagos`, `Notificaciones`

### BCs que dependen de las respuestas
- `Asientos` → si hay mapa de sala con asientos numerados
- `Organizadores` → si hay terceros que publican eventos
- `Reventa` → si existe mercado secundario
- `Acceso/Validación` → si hay control de entrada con QR

---

## SaaS / Plataforma B2B

### Preguntas prioritarias

1. **¿Multitenancy?** (una instancia para todos los clientes vs instancias separadas)
2. **Modelo de facturación** (suscripción mensual, por uso, por seat, freemium)
3. **¿Roles y permisos complejos dentro de cada tenant?**
4. **¿El producto tiene un dominio funcional central?** (CRM, ERP, HRM, etc.)
5. **¿Integraciones con sistemas del cliente?** (webhooks, API pública, SSO)
6. **¿Trials o planes gratuitos?** (afecta BC de Suscripciones)

### BCs que aparecen casi siempre
`Organizaciones (Tenants)`, `Usuarios`, `Suscripciones`, `Facturación`, `Notificaciones`

### BCs que dependen de las respuestas
- El BC del dominio funcional principal (ej: `Proyectos`, `Contactos`, `Nómina`)
- `Integraciones` → si hay API pública o webhooks
- `Onboarding` → si el proceso de activación es complejo

---

## Señales de Alerta Durante el Diseño

Estas situaciones requieren pausar y aclarar con el usuario:

| Señal | Qué preguntar |
|-------|--------------|
| Un BC tiene > 5 agregados | ¿Este BC tiene dos responsabilidades distintas? |
| Dos BCs comparten un término con el mismo significado | ¿Realmente son el mismo BC? |
| Un BC no tiene ninguna integración | ¿Es realmente un BC o una feature de otro? |
| El flujo principal pasa por > 5 BCs | ¿Hay orquestación innecesaria? |
| Un BC "genérico" tiene lógica de negocio compleja | ¿No debería ser supporting o core? |

---

## Supuestos Seguros de Asumir (sin preguntar)

Estos elementos casi siempre existen y pueden asumirse salvo contradicción:

- `Notificaciones` como BC genérico si hay eventos que el usuario debe conocer
- `Clientes/Usuarios` como BC supporting si hay registro de usuarios
- ACL en toda integración con sistema externo
- `schema-per-bc` como estrategia de aislamiento de DB en monolito modular
- `database.type: relational` como tipo de BD por defecto (tecnología concreta → generador Fase 2)
- `messageBroker: true` si hay canales de eventos (tecnología concreta → generador Fase 2)
- `hexagonal` como estilo arquitectónico (es una restricción del framework)
