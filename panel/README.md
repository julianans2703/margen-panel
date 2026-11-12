# Margen · Panel de finanzas personales

## Abrir el ejemplo

Desde este directorio, ejecuta `python3 -m http.server 8080 --bind 127.0.0.1 --directory public` y abre [el panel local](http://127.0.0.1:8080). La demo funciona sin cuenta. Para probar la función de Notion en local, usa `npx netlify dev` y configura las variables en un archivo local `.env` (ignorado por Git).

## Desplegar en Netlify

1. Sube este directorio completo a un repositorio y usa **Add new project → Import an existing project**. Si el proyecto está en una subcarpeta del repositorio, elige esa carpeta como **Base directory**. El archivo `netlify.toml` configura `public` y las funciones. Deja el comando de compilación vacío.
2. Puedes publicar primero la demo. Para activar Notion, en **Project configuration → Environment variables**, añade las variables de abajo. Incluye el ámbito **Functions** si Netlify permite elegir ámbitos en tu plan. Introduce los valores solo en Netlify o en el entorno local.
3. Lanza otro despliegue. En el panel, entra en **Ajustes**, introduce la clave del panel y pulsa **Conectar y sincronizar**. Esa clave permite consultar los datos del panel. Compártela solo con quienes deban tener acceso. El sitio sirve la demo sin clave y la función exige la clave para acceder a los datos de Notion.
4. Con el panel abierto y visible, se sincroniza cada cinco minutos por defecto. **Sincronizar** actualiza a demanda. Cambia la frecuencia en **Ajustes**.

| Variable | Valor |
| --- | --- |
| `NOTION_TOKEN` | Secreto de una integración interna de Notion con capacidad de lectura. En cada base original, abre **••• → Conexiones** y añade esa integración. |
| `NOTION_FACTURAS` | Enlace o ID de la base original de facturas. |
| `NOTION_FACTURAS_YEAR` | Año de referencia opcional para filas que solo tienen el nombre del mes y ninguna fecha ni propiedad Año. Usa este valor solo si todas esas filas son del mismo año. |
| `NOTION_MOVIMIENTOS` | Opcional. Enlace o ID de la base original de movimientos. |
| `NOTION_PRESUPUESTOS` | Opcional. Enlace o ID de la base original de presupuestos. |
| `DASHBOARD_ACCESS_KEY` | Clave distinta del token de Notion, aleatoria y de al menos 24 caracteres. Por ejemplo, genera una con `openssl rand -hex 32`. |
| `NOTION_MAPPING` | JSON opcional con los nombres o ID de las propiedades. |

Para **Seguimiento de cobros**, usa el enlace que copiaste en `NOTION_FACTURAS`. El panel reconoce **Cobrado**, **Fecha de cobro**, **Importe** y **Mes**. Usa el título de la fila cuando falta Cliente. Con Cobrado desmarcado, Fecha de cobro se interpreta como fecha prevista. Una fila sin fecha de emisión puede entrar en el resumen si su Mes incluye año, pero no tendrá evento de emisión. Para separar años, añade **Año** o usa una fecha completa como **Mes**. La columna USD se conserva en Notion y el simulador calcula sus propios valores.

Si una base contiene varias fuentes, usa el ID de la fuente concreta. Un enlace de una vista puede incluir `?v=...`. El conector usa el ID que precede a la consulta. Si el enlace lleva a una página contenedora, abre primero la base original.

Puedes activar Notion solo con **Seguimiento de cobros**. Deja sin definir `NOTION_MOVIMIENTOS` y `NOTION_PRESUPUESTOS`. Una vez conectado, **Gastos y presupuesto** permite registrar gastos por fecha y guardar un presupuesto por categoría y mes. Estos datos se guardan en el navegador donde se introducen.

## Propiedades de Notion

| Base | Propiedades y tipos |
| --- | --- |
| Facturas | **Cliente** (título o texto), **Fecha de emisión** (fecha) e **Importe en €** (número, ≥ 0). Añade **Estado** (estado o selección), **Fecha de pago** (fecha), **Mes** (fecha o texto), **Vencimiento** (fecha) y **Lote Mercury** (texto o selección) según disponibilidad. |
| Movimientos | **Fecha** (fecha), **Importe** en EUR (número) y **Categoría** (texto, título o selección). **Tipo** es opcional. Si existe, se reconocen Gasto, Egreso, Salida, Expense y Debit. Si no existe, todas las filas se interpretan como gastos. Los importes de gasto se leen en valor absoluto. |
| Presupuestos | **Categoría** (texto, título o selección), **Presupuesto** en EUR (número, ≥ 0) y **Mes** opcional. Un mes vacío aplica el presupuesto cada mes. |

Los campos Mes aceptan una fecha, `AAAA-MM` o un nombre en español con año, como `noviembre de 2026`. Si falta Mes en una factura, se usa la emisión. Se admiten fórmulas y rollups escalares cuando devuelven el tipo esperado. Si una categoría o un cliente están en una relación, usa una fórmula auxiliar de texto con su nombre y mapea esa propiedad.

Ejemplo de `NOTION_MAPPING` en una sola línea:

```json
{"invoices":{"client":"Empresa","issued":"Emitida el","amount":"Total EUR","paid":"Cobrado el","batch":"Referencia transferencia"},"movements":{"category":"Nombre de categoría","amount":"Importe EUR"},"budgets":{"amount":"Límite mensual"}}
```

## Criterios de cálculo

- El facturado y pendiente se agrupan por Mes o por emisión. Cobros netos y comisiones se atribuyen al mes de pago. Una factura marcada como pagada sin fecha aparece cobrada, pero queda fuera del flujo de caja hasta completar la fecha.
- Conversión sobre el bruto en dólares. Transferencia sobre lo que queda en OneSafe. La cuota fija se aplica una vez por lote y se distribuye en proporción a ese saldo. Usa un identificador único para cada transferencia agrupada y deja vacío el lote de las individuales.
- El tipo de cambio es USD por EUR. Frankfurter trae la última referencia publicada. Puedes usar tu propio tipo de referencia en su lugar. Los resultados históricos se recalculan con los parámetros actuales. Las cifras de OneSafe y Mercury son estimaciones y no se concilian con extractos bancarios.
- La reserva fiscal es una estimación sobre el cobro neto. Las previsiones usan el mes de vencimiento de las facturas pendientes.
- Saldos, historial de ahorro, objetivo y ajustes se guardan en este navegador. Para registrar el historial, selecciona el mes y guarda los saldos. Los saldos de demo y los de la conexión real se guardan por separado. El fondo de emergencia excluye la tarjeta de inversiones.
- El token solo se usa en la función de Netlify. La clave del panel se guarda en la sesión de la pestaña y se puede borrar en **Ajustes → Desconectar**.

[API de Notion](https://developers.notion.com/reference/query-a-data-source) · [Variables de Netlify Functions](https://docs.netlify.com/build/functions/environment-variables/) · [Frankfurter](https://frankfurter.dev/)
