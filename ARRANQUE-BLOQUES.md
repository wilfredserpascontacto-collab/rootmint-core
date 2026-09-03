# Módulo de bloques — arranque

Estado al **25 de agosto de 2026**. Todavía no hay rutas ni interfaz: lo que
existe es el esquema, los valores de fábrica y las decisiones que los sostienen.

Este documento es lo que no se deduce leyendo el código: por qué está armado
así, qué se probó, y qué rompe si se toca sin saber.

---

## Qué es

Un sistema para una planta de bloques de concreto. Administra recetas, produce
lotes, registra ensayos de resistencia y calcula el costo por bloque.

Cuelga del núcleo de RootMint —`users`, `activity_log`, `counters`— sin tocarlo,
tal como describe `nucleodedatos.md`: el flujo comercial es común y lo que no se
parece entre rubros vive aparte.

---

## Las dos decisiones que gobiernan todo

### 1. El costo y la resistencia viajan siempre juntos

El cliente pidió primero el costo por bloque, y comercialmente tiene razón. Pero
la forma más rápida de abaratar un bloque es bajarle el cemento, y un sistema
que muestre sólo el costo convierte eso en un juego con marcador que se gana
cada semana. La resistencia perdida no aparece en ninguna pantalla hasta que una
pared falla.

Esta planta **tiene prensa propia**, así que el ciclo cierra adentro: cada lote
termina con un ensayo real. Ninguna pantalla muestra el costo de un bloque sin
mostrar también lo que aguanta.

### 2. Los valores de fábrica no se copian a la base del cliente

`settings` guarda **únicamente lo que el cliente cambió**. Todo lo demás se lee
del código, en `src/bloques/defaults.ts`, con la regla:

```
valor = ajuste del cliente ?? valor de fábrica
```

Si copiáramos los valores de fábrica a su base al instalar, después sería
imposible distinguir lo que él eligió de lo que apenas heredó, y ninguna mejora
nuestra sería segura de aplicar.

Ya pagamos esa lección en la cotizadora de Grupo Phoenix: el perfil de la
empresa se copió a IndexedDB la primera vez que la app abrió, y cuando después
cambiamos el nombre, el logo y el teléfono, ningún teléfono que ya tenía la app
se enteró. Hubo que borrar la base entera para verlo.

Acá sería peor: el cliente va a estar afinando rangos durante meses.

---

## Trampas

**Un MPa sin criterio de área no significa nada.** ASTM C90 exige 13.8 MPa sobre
área **neta**, descontando huecos. Otras normas piden su mínimo sobre área
**bruta**, el rectángulo completo. En un bloque hueco la diferencia pasa del
doble — los tipos de fábrica dan entre 58% y 67% de área neta. Por eso
`strength_basis` es obligatorio en `tests` y acompaña a la resistencia objetivo
en `block_types`. Si alguien agrega un campo de resistencia sin su criterio, lo
está preparando para aprobar un bloque que no da.

**Los rangos editables valen lo que valga quien los pone.** Si el cliente
ensancha la proporción a 1:14, deja de recibir avisos y el sistema no tiene
forma de saber que eso está mal. Por eso cada rango de `defaults.ts` lleva su
`norma`, que **no es editable y no se quita de la pantalla**: se dibuja detrás
del rango propio, con su fuente escrita. Manda el número del cliente; la norma
queda a la vista para que apartarse sea una decisión y no un descuido. Y cada
cambio queda en `activity_log`.

**El costo del lote no se recalcula nunca.** `batch_lines` congela nombre,
cantidad y precio del día. Un lote de agosto tiene que seguir costando lo que
costó en agosto aunque el cemento suba en septiembre. Es la misma regla que los
precios congelados de la cotizadora.

**Todo entero.** Montos en centavos, cantidades en milésimas de la unidad de
dosificación, resistencia en milésimas de MPa. No hay un solo float en las
cuentas.

**El correlativo de lote se pide con `UPDATE ... RETURNING`** dentro de la misma
transacción que crea el lote, igual que las cotizaciones del núcleo. Nunca con
`MAX() + 1` fuera de transacción.

---

## Lo que ya está y se probó

`src/db/schema-bloques.ts` — nueve tablas: `settings`, `units`, `materials`,
`block_types`, `recipes`, `recipe_lines`, `batches`, `batch_lines`, `tests`.
Compila con `tsc --strict`.

`src/bloques/defaults.ts` — unidades, materiales, tipos de bloque, rangos con su
referencia de norma, y el resolutor. Ejecutado de verdad, no sólo compilado:

- Las áreas salen coherentes: el bloque de 15 da 62% de área neta, el de 20 da 58%.
- Sin ajustes, mandan los valores de fábrica.
- Con un ajuste, manda el del cliente y queda marcado con `esDelCliente`.
- Lo que el cliente no tocó sigue recibiendo el valor de fábrica.
- La misma mezcla 1:9.4 sale **alta** con el rango de fábrica y **dentro** con
  el rango ensanchado por el cliente. Esa es exactamente la libertad que se
  pidió, y la razón por la que la norma se queda dibujada detrás.

`drizzle.config.ts` — ahora lee los dos archivos de esquema.

---

## Lo que falta, en orden

**1. Migración y siembra.** `npm run db:generate` y un `seed-bloques.ts` que
cargue unidades, materiales y tipos de bloque de fábrica. Ojo: la siembra crea
filas, no ajustes. `settings` nace vacía y así debe quedarse hasta que el
cliente cambie algo.

**2. Rutas de catálogo.** Materiales, unidades, tipos de bloque y recetas, con
el mismo patrón de `src/routes/catalog-items.ts`.

**3. Costo teórico por bloque.** Es la fase 1 que pidió el cliente: receta más
precios vigentes, dividido entre los bloques esperados por mezcla.

**4. Lotes.** Registro en planta, con bloques buenos y rotos. Aquí aparece el
rendimiento real y la brecha contra el costo teórico, que es plata que hoy nadie
cuenta.

**5. Ensayos y estado de receta.** Una receta pasa de `draft` a `validated` sólo
con ensayos que la respalden.

**6. Advertencias.** `evaluar()` ya existe y es toda la lógica; falta la interfaz
y el ajuste de los rangos con el historial propio de la planta.

---

## Lo que no sabemos de la planta

No se pudo levantar antes de arrancar, y por eso todo es editable. Cuando haya
acceso, estos cuatro datos convierten los valores de fábrica en valores reales:

Los tipos de bloque que fabrica hoy, con las medidas de sus moldes y sus huecos
—de ahí sale el área neta buena—. En qué unidad dosifica realmente. Cuántos
bloques cree que salen de una mezcla, que es contra lo que se va a contrastar el
rendimiento. Y qué ensaya con su prensa: si tiene registros viejos, los rangos
arrancan calibrados a sus materiales en vez de a un promedio de la literatura.
