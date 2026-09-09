# PR-1.5 — Sistema visual: tokens, tipografía y repintado

- **Rama**: `feat/sistema-visual`
- **Depende de**: PR-01 (mergeado, `21eff12`).
- **Orden de ejecución**: **inmediatamente después del PR-01, antes que ningún otro.**
  Va primero a propósito: cada PR posterior que pinte UI nace ya con los tokens puestos.
  Orden completo: PR-01 → **PR-1.5** → PR-09 → PR-10 → PR-11 → PR-02 … PR-08.
- **Conflicto conocido**: toca los cuatro componentes de `packages/web/src`. Los planes
  PR-09, PR-10 y PR-07 traen fragmentos con clases literales (`bg-slate-900`,
  `border-sky-400`, `bg-blue-600`). **Tras el merge de este PR, el thinker actualiza esos
  fragmentos.** El doer no los adapta por su cuenta: si encuentra un fragmento con una
  clase literal, para y lo notifica.
- **Estado**: borrador
- **Contiene LLM**: no.
- **Origen**: canvas de Claude Design **"Proxus Tutor sistema visual"**
  (proyecto `8534c483-bd79-4a64-9e80-638729501461`), fichero
  `Proxus Tutor - Demo Interfaz Claro.dc.html`. Todos los valores de este plan están
  extraídos de ese fichero, no inventados. Las dos excepciones están marcadas como
  *extensión del thinker*.

> Normas de trabajo en [`../plan.md`](../plan.md). Contexto técnico obligatorio en
> [`../../documentacion/contexto-repo.md`](../../documentacion/contexto-repo.md) y
> [`../../documentacion/funcionamiento-actual.md`](../../documentacion/funcionamiento-actual.md).
> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.

---

## Problema

No hay sistema visual. Hay 145 decisiones de color sueltas.

Medido sobre `packages/web/src`:

| Fichero | Líneas | Atributos `className=` |
|---|---|---|
| `components/ArtifactWorkspace.tsx` | 380 | 48 |
| `components/Sidebar.tsx` | 94 | 31 |
| `components/Chat.tsx` | 169 | 21 |
| `App.tsx` | 23 | 1 |

- ~145 usos de clases de color, **todas literales**: `slate-800` (18), `slate-400` (16),
  `slate-100` (16), `sky-400` (7), más `red-*`, `emerald-*` y un gradiente
  `from-sky-400 to-indigo-500`.
- `styles.input.css` son 19 líneas con **cero custom properties**. No hay capa de tokens.
- El tema está clavado a oscuro en una sola línea (`styles.input.css`,
  `:root { color-scheme: dark }`), y el fondo se repite a mano en `App.tsx:11`,
  `Sidebar.tsx:16` y `Chat.tsx:73`.
- No hay escala tipográfica: los tamaños salen de las utilidades por defecto de Tailwind
  (`text-3xl`, `text-sm`…), sin relación con ningún diseño.
- `index.html` no carga ninguna fuente: todo cae en la de sistema.

Consecuencia inmediata: cambiar el tema es tocar 101 atributos a mano. Consecuencia peor:
**no existe ningún documento que diga cuál es el color correcto**, así que cada agente que
escribe UI inventa el suyo, y el resultado diverge PR a PR. El PR-09 ya lo demuestra: su
plan propone `blue-600` porque no había dónde consultar que el acento era otro.

## Objetivo

Una sola fuente de verdad de color, tipografía, radio, sombra y movimiento, aplicada a
toda la UI existente y obligatoria para toda la UI futura.

## Fuera de alcance

Decidido con producto al escribir este plan:

- **El layout de tres columnas se mantiene.** El canvas dibuja sidebar + main, sin chat.
  Aquí el chat sigue siendo la tercera columna: es el núcleo del producto y `CHALLENGE.md`
  lo puntúa. Del canvas se adopta el **ancho de sidebar (252px)** y el lenguaje visual, no
  la eliminación del chat.
- **El panel de evaluación de tres agentes** (fases BUENO / MALO / JUEZ, barras `pxSweep`,
  veredicto). Es PR-04, PR-05 y PR-07. Aquí sólo se dejan definidos los tokens y las
  animaciones que ese panel necesitará, para que el PR-07 no las reinvente.
- **La vista de informe final** (tarjetas de métricas, tabla de preguntas, "9,1 s"). No
  existe backend para eso.
- **Las citas verificadas.** El estilo de `blockquote` se documenta, pero no hay citas que
  pintar hasta el PR-02.
- **Contenido del canvas sin dato real detrás**: tarjeta "Carpeta de examen · 62%",
  tarjeta de usuario "Aitana O. · Medicina 2.º", flashcards, "Guardar como artefacto" y la
  barra de demo inferior. Son atrezo de la maqueta. **No se implementan.**
- **Traducir la interfaz al español.** El canvas está en español y la UI en inglés. Este
  PR no toca ni una cadena de texto. Ver *Riesgos y decisiones*.
- **Modo oscuro.** El diseño entregado es claro. Los tokens quedan preparados para un
  segundo tema, pero no se implementa.

## Contratos afectados

Ninguno en `packages/shared`. Todo vive en `packages/web`.

### Los tokens

Fuente: los literales del `.dc.html`. Tailwind v4 los expone como utilidades desde el
bloque `@theme` (`--color-canvas` → `bg-canvas`, `text-canvas`, `border-canvas`).

**Superficies**

| Token | Valor | Uso en el canvas |
|---|---|---|
| `--color-canvas` | `#FBFAFE` | fondo de la aplicación |
| `--color-surface` | `#FFFFFF` | tarjetas, píldoras, textarea |
| `--color-surface-raised` | `#F5F2FC` | sidebar y barra inferior |
| `--color-surface-sunken` | `#F7F4FD` | columna de evaluación (PR-07) |
| `--color-surface-muted` | `#F1EDFB` | hover, chips, skeleton |
| `--color-track` | `#E4DEF3` | barras de progreso y scrollbar |

**Texto**

| Token | Valor | Uso |
|---|---|---|
| `--color-ink` | `#14102A` | títulos y texto principal |
| `--color-ink-soft` | `#2E2748` | prosa dentro de tarjetas |
| `--color-ink-mute` | `#5B5478` | texto secundario, botón secundario |
| `--color-ink-faint` | `#5F5975` | etiquetas, metadatos, eyebrow |

**Líneas**

| Token | Valor | Uso |
|---|---|---|
| `--color-line` | `rgba(20,16,42,.09)` | borde estándar de tarjeta y separador de sección |
| `--color-line-soft` | `rgba(20,16,42,.06)` | separadores internos de lista |
| `--color-line-strong` | `rgba(20,16,42,.14)` | bordes de control: botón secundario, textarea |

**Marca**

| Token | Valor | Uso |
|---|---|---|
| `--color-brand` | `#6B33DC` | acento, CTA, eyebrow destacado |
| `--color-brand-hover` | `#5A29C0` | hover de CTA |
| `--color-brand-lift` | `#7C46E8` | segundo punto del gradiente de progreso |
| `--color-brand-glow` | `#8B5CF2` | primer punto del gradiente del logo |
| `--color-brand-tint` | `rgba(131,79,240,.12)` | fila seleccionada |
| `--color-brand-tint-strong` | `rgba(131,79,240,.22)` | badge de fila seleccionada |
| `--color-focus-ring` | `rgba(107,51,220,.2)` | anillo de foco (3px) |
| `--color-focus-line` | `rgba(145,96,242,.6)` | borde del control enfocado |

**Semánticos**

| Token | Valor | Uso |
|---|---|---|
| `--color-good` / `--color-good-ink` | `#0D9488` / `#0F766E` | acierto, veredicto correcto, agente BUENO |
| `--color-good-tint` / `--color-good-line` | `rgba(13,148,136,.09)` / `rgba(13,148,136,.28)` | fondo y borde de esos bloques |
| `--color-warn` / `--color-warn-ink` | `#D97706` / `#B45309` | "a revisar", agente MALO |
| `--color-warn-tint` / `--color-warn-line` | `rgba(217,119,6,.09)` / `rgba(217,119,6,.28)` | |
| `--color-cite` / `--color-cite-ink` | `#0284C7` / `#0369A1` | citas y procedencia del material |
| `--color-cite-tint` / `--color-cite-line` | `rgba(2,132,199,.07)` / `rgba(2,132,199,.45)` | |

> **Extensión del thinker, no está en el canvas.** El diseño no define un estado de error
> (servidor caído, subida rechazada), y hoy la app usa `red-*` en ocho sitios. Se añaden:
> `--color-danger: #DC2626`, `--color-danger-ink: #B91C1C`,
> `--color-danger-tint: rgba(220,38,38,.08)`, `--color-danger-line: rgba(220,38,38,.28)`.
> Elegidos por consistencia con la saturación de `good` y `warn`. **Si producto prefiere
> que el error reutilice `warn`, es cambiar un token y ningún componente.**

**Gradientes** (no son tokens de color; van como utilidades o clases de componente)

- Logo: `linear-gradient(145deg, #8B5CF2, #6B33DC)`
- Barra de progreso: `linear-gradient(90deg, #6B33DC, #7C46E8)`
- Avatar neutro: `linear-gradient(145deg, #F1EDFB, #E4DEF3)`

**Tipografía**

- `--font-sans: Geist, ui-sans-serif, system-ui, sans-serif`
- `--font-mono: "Geist Mono", ui-monospace, SFMono-Regular, monospace`
- Pesos usados: 400, 500, 600, 700 (sans) · 400, 500 (mono).
- Escala, con el interlineado que usa el canvas:

  | Token | Tamaño / interlineado | Uso |
  |---|---|---|
  | `--text-micro` | 11px / 1 | eyebrow y badges en mono |
  | `--text-xs` | 12px / 1.4 | metadatos |
  | `--text-sm` | 12.5px / 1.3 | etiquetas de fila |
  | `--text-base` | 13px / 1.35 | filas de lista |
  | `--text-md` | 13.5px / 1.6 | texto de apoyo |
  | `--text-body` | 14.5px / 1.7 | prosa larga: feedback, respuestas |
  | `--text-lg` | 15px / 1.7 | entradilla |
  | `--text-question` | 19px / 1.45 | enunciado de pregunta |
  | `--text-title` | 20px / 1.2 | h1 de cabecera |
  | `--text-display` | 30px / 1.15 | h2 de informe (PR-07) |

- **Eyebrow**: la receta más repetida del diseño. Mono, 11px, peso 500,
  `letter-spacing: .14em`, mayúsculas, color `ink-faint` — o `brand` cuando la sección es
  la destacada (`SESIÓN EFÍMERA`, `INFORME DE EVALUACIÓN`).
- **Títulos**: `letter-spacing: -.02em`; el display de 30px, `-.025em`.

**Radios**: `--radius-xs: 6px`, `--radius-sm: 7px`, `--radius-md: 10px`,
`--radius-lg: 12px`, `--radius-xl: 14px`, `--radius-2xl: 16px`, `--radius-3xl: 18px`.
Las píldoras usan `rounded-full`, que ya existe.

**Sombras**

- `--shadow-card: 0 1px 2px rgba(20,16,42,.04)`
- `--shadow-panel: 0 1px 3px rgba(20,16,42,.05)`
- `--shadow-brand-sm: 0 4px 14px rgba(107,51,220,.24)` — logo
- `--shadow-brand: 0 6px 20px rgba(107,51,220,.28)` — CTA primario

**Movimiento**

- `--ease-dc: cubic-bezier(.32,.72,0,1)`, la única curva del diseño.
- Transición estándar: `120ms var(--ease-dc)`. Entrada de contenido: `260ms`.
- Cuatro keyframes, copiados literalmente del canvas: `pxPulse` (skeleton), `pxRise`
  (entrada), `pxGlow` y `pxSweep` (fases del panel de PR-07 — se definen ahora aunque no
  se usen todavía).
- Guard obligatorio, tal cual está en el canvas:
  `@media (prefers-reduced-motion: reduce) { * { animation-duration:.01ms !important; transition-duration:.01ms !important } }`

**Cromo del navegador**

- `::selection { background: rgba(107,51,220,.28) }`
- Scrollbar webkit: 10px, thumb `--color-track`, `border-radius: 999px`,
  `border: 3px solid var(--color-canvas)`.

### Mapeo viejo → nuevo

Esta tabla es el repintado mecánico. **No hay margen de interpretación**: si una clase
literal no está aquí, el doer para y lo notifica.

| Hoy | Pasa a ser |
|---|---|
| `bg-slate-950` (fondo app) | `bg-canvas` |
| `bg-slate-950` (sidebar, `Sidebar.tsx:16`) | `bg-surface-raised` |
| `bg-slate-900` (tarjeta, textarea) | `bg-surface` |
| `bg-slate-900/40`, `bg-slate-950/70`, `bg-slate-950/60` | `bg-surface-muted` |
| `bg-slate-950/90`, `bg-slate-950/95` | `bg-surface-raised` |
| `border-slate-800` | `border-line` |
| `border-slate-700` | `border-line-strong` |
| `text-slate-100` | `text-ink` |
| `text-slate-200` | `text-ink-soft` |
| `text-slate-300` | `text-ink-mute` |
| `text-slate-400` | `text-ink-faint` |
| `text-sky-400`, `border-sky-400`, `ring-sky-400`, `border-sky-500` | `*-brand` |
| `bg-sky-400` / `bg-sky-300` (CTA y su hover) | `bg-brand` / `bg-brand-hover`, texto blanco |
| `text-slate-950` sobre CTA | `text-white` |
| `bg-sky-950/40` (fila seleccionada) | `bg-brand-tint` |
| `from-sky-400 to-indigo-500` (logo) | gradiente de marca, `145deg #8B5CF2 → #6B33DC` |
| `text-emerald-*`, `bg-emerald-950*`, `border-emerald-900` | `good` / `good-ink` / `good-tint` / `good-line` |
| `text-red-*`, `bg-red-950*`, `border-red-900` | `danger` / `danger-ink` / `danger-tint` / `danger-line` |
| `shadow-slate-950/30` | `shadow-card` |

## Pasos

### Paso 0 — Comprobación previa

1. [ ] `git switch -c feat/sistema-visual` desde `main` con el PR-01 dentro.
2. [ ] `pnpm run typecheck` y `pnpm --filter @proxus/web run build`, ambos en verde.
3. [ ] Anotar el estado inicial del guard que se usará al final:

   ```bash
   grep -rnE '(bg|text|border|ring|from|to|via|fill|stroke|placeholder|divide|shadow|accent)-(slate|sky|indigo|emerald|red|blue|gray|zinc|neutral|stone|violet|purple)-[0-9]{2,3}' packages/web/src --include=*.tsx | wc -l
   ```

   Debe dar ~145. Al final del PR tiene que dar **0**.
4. [ ] Comprobar la versión de Tailwind: `packages/web/package.json` declara
       `tailwindcss ^4.3.1` (línea 23) y `@tailwindcss/vite ^4.3.3` (línea 26) — el
       **plugin de Vite**, no el CLI. El bloque `@theme` y los tokens
       `--text-*` son sintaxis de v4. **Verificar contra la versión instalada antes de
       escribir el fichero entero**; si `--text-<n>--line-height` no funciona en 4.3.1,
       usar utilidades `leading-*` en los componentes y dejar sólo el tamaño en el token.
       **No inventar sintaxis: si no compila, para y notifica.**

### Paso 1 — La capa de tokens

Reescribir `packages/web/src/styles.input.css`. Estructura obligatoria, en este orden:

1. [ ] `@import "tailwindcss";` y los dos `@source` que ya están. **No tocarlos**: el
       segundo (`streamdown/dist/*.js`) es el que hace que las clases del renderizador de
       markdown existan.
2. [ ] Bloque `@theme` con **todos** los tokens de la sección *Contratos afectados*.
3. [ ] `@layer base`:
   - `:root { color-scheme: light; }` — era `dark`.
   - `body { margin: 0; background: var(--color-canvas); color: var(--color-ink); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }`
   - `button, textarea, input { font: inherit; }` — añadir `input`, que hoy falta y lo
     necesita el `<input type="file">` del PR-09.
   - `::selection`, scrollbar webkit, y los cuatro `@keyframes`.
   - El bloque `prefers-reduced-motion`.
4. [ ] **No** definir clases de componente (`.btn`, `.card`). El repo usa utilidades; una
       capa de componentes sería un segundo sistema compitiendo con el primero.
5. [ ] `pnpm --filter @proxus/web run build` para comprobar que el CSS compila **antes**
       de tocar ningún `.tsx`.

### Paso 2 — Fuentes

En `packages/web/src/index.html` (11 líneas hoy), dentro de `<head>`, copiando lo que hace
el canvas:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

1. [ ] Añadir también `<html lang="es">`? **No.** La interfaz sigue en inglés; el `lang`
       se queda como está.
2. [ ] Verificar en el navegador que Geist carga de verdad (DevTools → Network → Font, o
       `document.fonts.check('14px Geist')` en consola). Con el fallback declarado, un
       fallo de red no rompe nada pero **cambia la métrica de todo**: si no carga, la QA
       visual no vale.

### Paso 3 — `App.tsx`: el armazón

1. [ ] Fondo: `bg-slate-950` → `bg-canvas`; `text-slate-100` → `text-ink`.
2. [ ] Columnas: `340px` → **`252px`** (valor del canvas). La tercera columna del chat se
       queda en `420px`.
3. [ ] Nada más. La lógica de `selectedArtifactId` no se toca.

### Paso 4 — `Sidebar.tsx`

Es el componente que más se parece al canvas y donde el rediseño se nota.

1. [ ] Contenedor: `bg-surface-raised`, `border-line` a la derecha, padding `16px 12px`,
       `flex flex-col gap-5`.
2. [ ] **Bloque de marca**: cuadrado 34px, `rounded-[10px]`, gradiente de marca,
       `shadow-brand-sm`, letra `P` en 700/18 blanca. Al lado, nombre `Proxus Tutor` en
       600/14 con `-.01em` y subtítulo en 400/11.5 `text-ink-faint`. **El texto del
       subtítulo no cambia**: sigue siendo `Academic assistant`.
3. [ ] **Eyebrow de sección**: `MATERIALS` y `ARTIFACTS` pasan a la receta de eyebrow
       (mono, 11px, 500, `tracking-[.14em]`, `text-ink-faint`), con `padding: 0 6px`.
4. [ ] **Lista de materiales**: sustituir el `<details>/<summary>` por una **lista plana**,
       como en el canvas. Cada fila:
   - `flex items-center gap-2.5 px-2 py-2.5 rounded-[10px] cursor-default`
   - badge de tipo a la izquierda: 22×26, `rounded`, borde `line-strong`, fondo
     `surface-muted`, texto mono 8px `ink-faint`, contenido `PDF`.
   - nombre: `flex-1 min-w-0 truncate`, 400/13, `text-ink-mute`.
   - meta a la derecha: mono 10.5px `ink-faint`, contenido `{pageCount} p`.
   - **Sin estado seleccionado**: hoy no se puede seleccionar un material. El canvas lo
     tiene porque su maqueta sí. No se inventa interacción.
5. [ ] **Skeleton de carga**: la rama `onInitial` deja de ser `"Loading materials…"` y pasa
       a tres barras de 36px, `rounded-[10px]`, `bg-surface-muted`, con `pxPulse` y
       retardos `0 / .2s / .4s`. Igual para artifacts.
6. [ ] **Lista de artifacts**: misma fila, con el badge coloreado por `artifact.kind`, que
       es dato real:

   | kind | letra | color del badge |
   |---|---|---|
   | `note` | `N` | `cite` sobre `cite-tint` |
   | `quiz` | `Q` | `brand` sobre `brand-tint-strong` |
   | `test` | `T` | `good` sobre `good-tint` |

   Fila seleccionada (`selectedArtifactId === artifact.id`): fondo `brand-tint`, texto
   `ink`. Fila normal: `text-ink-mute`, hover `bg-surface-muted` con la transición de
   120ms.
7. [ ] Los estados `onError`/`onDefect` pasan a `danger`.
8. [ ] **No se añade** la tarjeta de "Carpeta de examen" ni la de usuario: no hay dato.

### Paso 5 — `Chat.tsx`

Sólo tema y escala. **La lógica no se toca** — eso es el PR-10.

1. [ ] Contenedor `bg-canvas`; cabecera con `border-line`.
2. [ ] Eyebrow `Ephemeral session` → receta de eyebrow en **`text-brand`**.
3. [ ] `<h1>`: de `text-3xl` a `--text-title` (20px, 600, `-.02em`). El titular gigante del
       estado vacío (`text-4xl md:text-6xl`, `Chat.tsx:93`) baja a 30px/600/`-.025em`
       (`--text-display`): el canvas no tiene nada de 60px.
4. [ ] Burbuja de usuario: `border-blue-700 bg-blue-950` → `border-brand-line`/`bg-brand-tint`
       con texto `ink`. Burbuja del tutor: `bg-surface`, `border-line`, `shadow-card`,
       `rounded-2xl`, prosa en `--text-body` (14.5/1.7) `text-ink-soft`.
5. [ ] Bloques `<details>` de tool call/result: `bg-surface`, `border-line`,
       `text-ink-faint`, y el `<pre>` en `--font-mono` a 12px.
6. [ ] `<textarea>`: `bg-surface`, `border-line-strong`, `rounded-xl` (14px), padding
       `14px 16px`, `--text-body`; foco con `border-focus-line` y anillo de 3px
       `focus-ring`. **Sustituye al `focus:ring-2 focus:ring-sky-400` actual.**
7. [ ] Botón *Send*: receta de CTA primario — `bg-brand text-white rounded-lg px-5 py-3`,
       600/14, `shadow-brand`, hover `bg-brand-hover`, `active:translate-y-px`,
       `disabled:opacity-50 disabled:cursor-not-allowed` y **sin sombra en disabled**.
8. [ ] Botón *Clear chat* y los tres prompts sugeridos: receta de botón secundario —
       `border-line-strong bg-transparent text-ink-mute`, hover `bg-surface-muted`.
9. [ ] El párrafo de error pasa a `danger` (el PR-10 lo convertirá en una fila con botón).

### Paso 6 — `ArtifactWorkspace.tsx`

48 atributos, el fichero más grande. Repintado mecánico con la tabla de mapeo, más tres
recetas del canvas que sí aplican hoy:

1. [ ] **Enunciado de pregunta**: `--text-question` (19px/1.45/500), `text-ink`,
       `max-w-[46ch]`, `text-wrap: pretty`.
2. [ ] **Badges de tipo de pregunta**: píldora `rounded-[7px] px-2.5 py-1.5`, mono 11px,
       `tracking-[.1em]`; neutra sobre `surface-muted`, y la de tipo sobre `cite-tint`
       con `text-cite-ink`.
3. [ ] **Veredicto por pregunta**: correcto → `good-tint` / `good-line` / `good-ink`;
       incorrecto → `warn-tint` / `warn-line` / `warn-ink`. **Ojo**: hoy el incorrecto es
       rojo. En el canvas el "a revisar" es ámbar y el rojo queda sólo para fallos del
       sistema. Se adopta el criterio del canvas: **una respuesta mal no es un error de la
       aplicación.**
4. [ ] Tarjetas: `bg-surface border-line rounded-2xl shadow-card p-[18px]`.
5. [ ] Zona vacía punteada (`ArtifactWorkspace.tsx:33`): `rounded-2xl border-dashed
       border-line`, texto centrado `--text-md` `text-ink-mute`, `max-w-[32ch]`.
6. [ ] Botón de envío del intento: CTA primario, igual que el del chat.

### Paso 7 — El documento que hace esto permanente

1. [ ] Crear **`documentacion/design-system.md`**. Contenido mínimo, transcrito de este
       plan:
   - Procedencia: proyecto y fichero del canvas, con su URL.
   - Las cinco tablas de tokens completas.
   - La tabla de mapeo viejo → nuevo.
   - **Recetas de componente**, con el fragmento exacto de clases: eyebrow, CTA primario,
     botón secundario, tarjeta, fila de lista, badge de tipo, píldora de veredicto,
     textarea, zona punteada, blockquote de cita (`border-l-2 border-cite rounded-r-xl
     bg-cite-tint px-4 py-3.5`, para el PR-02/PR-07).
   - **Las reglas duras**, literales:
     1. Prohibido escribir una clase de color literal de Tailwind en `packages/web`. Sin
        excepciones. El color sale de un token.
     2. ¿Falta un color? Se añade un token a `styles.input.css` y una fila a este
        documento, en el mismo commit. No se resuelve con un literal "de momento".
     3. El único fichero de estilos del repo es `styles.input.css`, y es el que se edita.
        Tailwind corre como plugin de Vite; no hay CSS generado que versionar ni tocar.
     4. El guard del Paso 8 tiene que dar 0 antes de abrir cualquier PR de UI.
2. [ ] `AGENTS.md`, sección `## Frontend`: añadir tres viñetas apuntando al documento y a
       la regla del literal prohibido, más el comando del guard.
3. [ ] `documentacion/funcionamiento-actual.md` §7: hoy describe una UI oscura sin sistema.
       Corregir.
4. [ ] **`documentacion/dificultades.md`** — crear si no existe, y añadir la entrada del
       PR-1.5 con el formato del PR-09 §Paso 9 (Síntoma / Causa / Solución / Descartado).
       Candidatas: la sintaxis de `@theme` en 4.3.1, los tokens con `rgba()` y la opacidad
       de Tailwind, la carga de Geist, algún contraste que no pase AA.

### Paso 8 — Cierre

1. [ ] Ejecutar el guard. **Tiene que dar 0**:

   ```bash
   grep -rnE '(bg|text|border|ring|from|to|via|fill|stroke|placeholder|divide|shadow|accent)-(slate|sky|indigo|emerald|red|blue|gray|zinc|neutral|stone|violet|purple)-[0-9]{2,3}' packages/web/src --include=*.tsx
   ```

2. [ ] `pnpm --filter @proxus/web run build` termina en verde: el plugin de Tailwind
       genera el CSS dentro del bundle de `packages/web/dist/`, que está en `.gitignore`.
       `git status` **no** debe mostrar ningún `.css` nuevo bajo `packages/web/src/`.
3. [ ] Revisar contraste con las DevTools en los textos pequeños. Los sospechosos son
       `ink-faint` (`#5F5975`) sobre `surface-raised` (`#F5F2FC`) a 11px, y el mono de
       10.5px de las filas de material. **Si alguno no llega a 4.5:1, no se cambia el
       token por tu cuenta: se anota en `dificultades.md` y se notifica al thinker.**

## Criterio de aceptación

- [ ] El guard del Paso 8 devuelve **0 aciertos**.
- [ ] `styles.input.css` contiene un bloque `@theme` con todos los tokens de este plan y
      ningún color literal fuera de él.
- [ ] La aplicación arranca en **claro**: fondo `#FBFAFE`, no queda ni un panel oscuro.
- [ ] Geist y Geist Mono se cargan y se aplican; los eyebrow se ven en mono con
      `letter-spacing` amplio.
- [ ] La columna del sidebar mide 252px y el chat sigue siendo la tercera columna.
- [ ] Materiales y artifacts se pintan como listas planas con badge de tipo; el artifact
      seleccionado se distingue con `brand-tint`.
- [ ] Mientras cargan, materiales y artifacts muestran skeletons que laten, no la palabra
      "Loading".
- [ ] El badge de artifact es `N`, `Q` o `T` según el `kind` real, con su color.
- [ ] El CTA primario es morado `#6B33DC`, con sombra de marca, y su hover es `#5A29C0`.
- [ ] El textarea enfocado muestra el anillo morado de 3px, no el `sky` anterior.
- [ ] Una respuesta incorrecta se pinta en ámbar (`warn`), y el rojo (`danger`) queda sólo
      para fallos de la aplicación.
- [ ] Con `prefers-reduced-motion: reduce` activo, nada late ni se desliza.
- [ ] `documentacion/design-system.md` existe, con tokens, mapeo, recetas y las cuatro
      reglas duras.
- [ ] `AGENTS.md` §Frontend apunta a ese documento y al guard.
- [ ] `documentacion/dificultades.md` tiene al menos una entrada del PR-1.5.
- [ ] Ninguna cadena de texto de la interfaz ha cambiado.

## Checks

```bash
pnpm run typecheck
pnpm --filter @proxus/web run build

# guard: 0 aciertos
grep -rnE '(bg|text|border|ring|from|to|via|fill|stroke|placeholder|divide|shadow|accent)-(slate|sky|indigo|emerald|red|blue|gray|zinc|neutral|stone|violet|purple)-[0-9]{2,3}' packages/web/src --include=*.tsx

# los tokens existen en la única hoja de estilos del repo
grep -c -- "--color-brand" packages/web/src/styles.input.css          # ≥ 1
grep -c "color-scheme: light" packages/web/src/styles.input.css       # 1

# no aparece ningún CSS suelto en el árbol: el plugin de Vite emite dentro de dist/
git status --porcelain packages/web/src                               # vacío
```

## QA manual

1. `pnpm run dev` y abrir `http://localhost:5173` con las DevTools en Network.
2. Confirmar que las tres peticiones de fuentes vuelven 200 y que el cuerpo se pinta en
   Geist (`document.fonts.check('14px Geist')` → `true`).
3. Poner el canvas al lado (`Proxus Tutor - Demo Interfaz Claro.dc.html`) y comparar, en
   este orden: fondo, sidebar, eyebrow, botón primario, tarjeta, textarea enfocado.
4. Recargar con la red lenta para ver los skeletons latiendo.
5. Seleccionar un artifact: la fila queda en morado tenue, no en azul.
6. Resolver un quiz con un fallo: el badge de esa pregunta es ámbar, no rojo.
7. Apagar el servidor y provocar un error en el chat: **ahí** sí sale rojo.
8. Activar *Reducir movimiento* en el sistema operativo y recargar: nada se anima.
9. Zoom del navegador al 150%: nada se solapa ni desborda en horizontal.
10. Con las DevTools, comprobar el contraste de los textos de 11px del sidebar.

## Riesgos y decisiones

- **El canvas no tiene chat, y el producto sí.** Decidido con producto: se mantienen las
  tres columnas y se adopta el lenguaje visual, no la estructura completa. Del canvas se
  toma el ancho de sidebar (252px). La consecuencia honesta es que la app no será idéntica
  a la maqueta, y hay que decirlo en el cuerpo del PR.

- **La maqueta enseña producto que no existe.** Panel de tres agentes, citas verificadas,
  informe con métricas, flashcards, progreso de carpeta. Implementarlo ahora sería pintar
  interfaz falsa durante cinco PRs. Se implementa el tema; las pantallas llegan con sus
  PRs y usarán estos tokens. Por eso `pxGlow`, `pxSweep`, `surface-sunken` y los tokens
  `good`/`warn`/`cite` se definen ya aunque este PR apenas los use: son para el PR-07, y
  definirlos ahora evita que se inventen otros.

- **El diseño está en español, la interfaz en inglés.** Traducir es una decisión de
  producto con su propio riesgo (los prompts del agente están en inglés y algunas cadenas
  vienen del servidor). Este PR no cambia ni una palabra. Si se decide traducir, es un PR
  propio y trivial de revisar.

- **Google Fonts es una dependencia de red.** El canvas las carga así y este PR lo copia.
  Sin red, la app cae al fallback y **se ve distinta**, aunque funciona. La alternativa
  —autoalojar con `@fontsource/geist`— añade dependencia y peso al bundle. **Decisión:
  Google Fonts ahora**, autoalojar si aparece un requisito de offline.

- **`@theme` de Tailwind v4 es sintaxis nueva.** Tailwind corre como **plugin de Vite**
  (`@tailwindcss/vite`, registrado en `packages/web/vite.config.ts:3,10`): el CSS se genera
  en memoria durante el build y sale dentro de `packages/web/dist/`, nunca al árbol de
  fuentes. La única hoja del repo es `styles.input.css`. Si algún token no genera
  la utilidad esperada en 4.3.1, el Paso 0.4 obliga a parar y notificar en vez de
  improvisar clases arbitrarias (`bg-[#6B33DC]`), que reintroducirían el problema que este
  PR viene a resolver.

- **Tokens con `rgba()` y la opacidad de Tailwind.** Utilidades como `bg-brand-tint/50`
  pueden no comportarse como se espera cuando el token ya lleva alfa. Regla: los tokens con
  alfa se usan **tal cual**, sin sufijo de opacidad.

- **Ámbar para respuestas incorrectas.** Cambia el significado del color respecto a hoy.
  Es el criterio del canvas y es mejor pedagogía: el rojo se reserva para "la aplicación
  ha fallado". Queda anotado porque es un cambio visible que alguien podría tomar por un
  bug.

- **Este PR invalida fragmentos de otros planes.** PR-09 (`blue-600`, `bg-slate-900`),
  PR-10 (`border-red-900`, `hover:border-sky-400`) y PR-07 traen clases literales en sus
  ejemplos. **El thinker los actualiza tras el merge.** Ya hay una nota en el `Historial`
  de PR-09 y PR-10.

- **145 atributos tocados a mano.** Es un diff grande y aburrido, y el compilador no caza
  ni uno: un `text-ink` donde tocaba `text-ink-faint` compila igual. Por eso el criterio de
  aceptación es la comparación visual contra el canvas, y por eso el guard es un `grep`, no
  una revisión a ojo.

## Historial

### 2026-09-08 — Corregidas las referencias al `styles.generated.css` difunto

El plan describía un montaje de Tailwind que el repo ya no tiene: un CLI que producía
`packages/web/src/styles.generated.css`, fichero versionado-pero-ignorado que había que
regenerar a mano. **Ese fichero no existe y ningún build lo escribe.** Verificado contra el
código: `@tailwindcss/vite` está registrado como plugin en `packages/web/vite.config.ts:3,10`,
la única hoja de estilos del repo es `packages/web/src/styles.input.css` —importada desde
`packages/web/src/main.tsx:5`— y el CSS resultante sale dentro del bundle de
`packages/web/dist/`. `packages/web/package.json` declara `@tailwindcss/vite` (línea 26),
no `@tailwindcss/cli`.

Corregido, sin tocar nada más del plan:

- **Paso 0.4** — decía que el `package.json` declara `@tailwindcss/cli ^4.3.1`. Ahora cita
  el plugin de Vite con su línea real.
- **Paso 7.1, regla dura 3** — *"`styles.generated.css` es generado. Se edita
  `styles.input.css`"* pasa a decir que `styles.input.css` es la única hoja del repo y que
  no hay CSS generado que versionar.
- **Paso 8.2** — pedía que el build *"regenerase"* el fichero y que `git status` no lo
  mostrase. Ahora comprueba lo que sí es comprobable: que el build va en verde y que no
  aparece ningún `.css` nuevo bajo `packages/web/src/`.
- **Checks** — los dos `grep` sobre `styles.generated.css` apuntaban a un fichero
  inexistente, así que siempre habrían fallado. El de `--color-brand` pasa a leer
  `styles.input.css` (da 6); el `git status --porcelain` se amplía a `packages/web/src`.
- **Riesgos** — *"El repo usa el CLI de Tailwind, no el plugin de Vite"* decía exactamente
  lo contrario de la realidad. Reescrito.

El guard de color canónico vive en `documentacion/design-system.md:275`; el de este plan es
copia y ahora coincide con él.
