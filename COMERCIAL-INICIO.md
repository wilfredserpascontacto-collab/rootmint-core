# Primera etapa comercial — 11 septiembre 2026

Decisión del usuario: DTE al final. Primero cotizaciones profesionales, prospectos/clientes y base comercial; después pedidos, cuentas por cobrar y cuentas por pagar. El primer caso es la fábrica de ladrillos, manteniendo núcleo reutilizable para construcción.

## Implementado
- Área independiente en /#/comercial, con acceso al módulo de producción existente.
- Alta y edición de prospectos/clientes, búsqueda, filtro y expediente con cotizaciones.
- Catálogo comercial de productos/servicios con precios en centavos.
- Datos de empresa y condiciones predeterminadas.
- Cotizaciones de varias partidas, importes calculados en servidor, impuestos, vigencia, lugar de entrega y condiciones.
- Vista imprimible; usar Imprimir / guardar PDF y seleccionar Guardar como PDF en el navegador. No es un generador PDF independiente.
- Copia histórica de cliente, empresa y precios en cotizaciones nuevas.
- Estados borrador → emitida → aceptada/rechazada/vencida con control en servidor.
- Migración 0003 y metadatos coherentes, sin reescribir migraciones anteriores.

## Desarrollo local
Node 22.18+ o Node 24. Instalar con npm ci en raíz y en web. Para el motor local: incluir dependencias de desarrollo.

En Windows, compilación validada:
1. node node_modules/typescript/bin/tsc -b
2. Dentro de web: node node_modules/typescript/bin/tsc -b
3. Dentro de web: node node_modules/vite/bin/vite.js build --configLoader native
4. En raíz: node scripts/local.mjs
5. Abrir http://127.0.0.1:4310/#/comercial

El modo local usa PostgreSQL embebido (PGlite) y persiste en .local-data, excluido de Git. No sustituye el PostgreSQL de producción. No admite DATABASE_URL ni NODE_ENV=production; escucha solo en 127.0.0.1. No abrir dos procesos contra la misma carpeta. Las pruebas usan una base en memoria independiente.

El código de producción conserva node-postgres y los comandos existentes. No se ha desplegado ni modificado el servidor real. No se importaron datos reales. Se guardó un prospecto y una propuesta claramente etiquetados como PRUEBA para revisar la interfaz local.

## Verificación
Compilación backend y frontend; pruebas de API con migraciones reales en PGlite: importes, copias históricas ante cambios de catálogo/cliente/empresa, transiciones, rechazo de cantidades negativas/overflow, catálogo inactivo, correlativos concurrentes, baja lógica y rutas inexistentes.
Comando tras compilar backend: node scripts/test-comercial.mjs.
Prueba de interfaz: crear prospecto y cotización de 3,000 unidades a $0.65; subtotal $1,950, impuesto de ejemplo 13% $253.50, total $2,203.50. Revisión visual de resumen y propuesta guardada.

## Límites de esta primera entrega
- Solo desarrollo local: autenticación, roles y endurecimiento del servidor heredado son pendientes antes de exposición o datos reales.
- Cantidades comerciales enteras por el esquema heredado; fracciones requieren una migración de precisión explícita.
- No hay edición de partidas de cotizaciones guardadas, revisiones, descuentos ni envío automático todavía.
- Guardado de cotización no tiene clave de idempotencia ante respuesta de red incierta; revisar listado antes de reenviar. Agregar antes del piloto real.
- No hay pedidos, cobros, cuentas por pagar, inventario financiero ni DTE implementados en esta entrega.
- El catálogo comercial aún no está vinculado al catálogo de producción.
- La vista de impresión debe verificarse con documentos largos y formato final de la empresa antes de entregarla a clientes.
- No es todavía una plataforma multiempresa ni contabilidad formal.

## Siguiente etapa
Revisión de cotizaciones y experiencia del usuario; luego pedido desde cotización aceptada, con saldos comerciales separados de entregas y pagos. Completar controles de acceso e idempotencia antes de operar. Mantener DTE al final por instrucción expresa.
