# Design System — Proxus Tutor

**Procedencia**: canvas de Claude Design "Proxus Tutor sistema visual"
(proyecto `8534c483-bd79-4a64-9e80-638729501461`, fichero `Proxus Tutor - Demo Interfaz Claro.dc.html`).
Todos los valores son extraídos de ese fichero. Las extensiones marcadas como *thinker* no están en el canvas original.

Aplicado en **PR-1.5** (`feat/sistema-visual`). Los PRs posteriores de UI consumen estos tokens; no inventan colores.

---

## Tokens de color

Definidos en `packages/web/src/styles.input.css` dentro del bloque `@theme`.
Tailwind v4 los expone como utilidades: `--color-brand` → `bg-brand`, `text-brand`, `border-brand`.

### Superficies

| Token | Valor | Uso |
|---|---|---|
| `--color-canvas` | `#FBFAFE` | fondo de la aplicación |
| `--color-surface` | `#FFFFFF` | tarjetas, píldoras, textarea |
| `--color-surface-raised` | `#F5F2FC` | sidebar y barra inferior |
| `--color-surface-sunken` | `#F7F4FD` | columna de evaluación (PR-07) |
| `--color-surface-muted` | `#F1EDFB` | hover, chips, skeleton |
| `--color-track` | `#E4DEF3` | barras de progreso y scrollbar |

### Texto

| Token | Valor | Uso |
|---|---|---|
| `--color-ink` | `#14102A` | títulos y texto principal |
| `--color-ink-soft` | `#2E2748` | prosa dentro de tarjetas |
| `--color-ink-mute` | `#5B5478` | texto secundario, botón secundario |
| `--color-ink-faint` | `#5F5975` | etiquetas, metadatos, eyebrow |

### Líneas

| Token | Valor | Uso |
|---|---|---|
| `--color-line` | `rgba(20,16,42,.09)` | borde estándar de tarjeta y separador de sección |
| `--color-line-soft` | `rgba(20,16,42,.06)` | separadores internos de lista |
| `--color-line-strong` | `rgba(20,16,42,.14)` | bordes de control: botón secundario, textarea |

### Marca

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

### Semánticos

| Token | Valor | Uso |
|---|---|---|
| `--color-good` / `--color-good-ink` | `#0D9488` / `#0F766E` | acierto, veredicto correcto, agente BUENO |
| `--color-good-tint` / `--color-good-line` | `rgba(13,148,136,.09)` / `rgba(13,148,136,.28)` | fondo y borde de esos bloques |
| `--color-warn` / `--color-warn-ink` | `#D97706` / `#B45309` | "a revisar", agente MALO |
| `--color-warn-tint` / `--color-warn-line` | `rgba(217,119,6,.09)` / `rgba(217,119,6,.28)` | fondo y borde |
| `--color-cite` / `--color-cite-ink` | `#0284C7` / `#0369A1` | citas y procedencia del material |
| `--color-cite-tint` / `--color-cite-line` | `rgba(2,132,199,.07)` / `rgba(2,132,199,.45)` | fondo y borde |
| `--color-danger` / `--color-danger-ink` | `#DC2626` / `#B91C1C` | fallos del sistema (*extensión thinker*) |
| `--color-danger-tint` / `--color-danger-line` | `rgba(220,38,38,.08)` / `rgba(220,38,38,.28)` | fondo y borde |

---

## Tipografía

```
--font-sans:  Geist, ui-sans-serif, system-ui, sans-serif
--font-mono:  "Geist Mono", ui-monospace, SFMono-Regular, monospace
```

Fuentes cargadas desde Google Fonts en `index.html` (pesos 300–700 para Geist, 400–500 para Geist Mono).

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

---

## Radios

| Token | Valor |
|---|---|
| `--radius-xs` | 6px |
| `--radius-sm` | 7px |
| `--radius-md` | 10px |
| `--radius-lg` | 12px |
| `--radius-xl` | 14px |
| `--radius-2xl` | 16px |
| `--radius-3xl` | 18px |

---

## Sombras

| Token | Valor | Uso |
|---|---|---|
| `--shadow-card` | `0 1px 2px rgba(20,16,42,.04)` | tarjetas |
| `--shadow-panel` | `0 1px 3px rgba(20,16,42,.05)` | paneles |
| `--shadow-brand-sm` | `0 4px 14px rgba(107,51,220,.24)` | logo |
| `--shadow-brand` | `0 6px 20px rgba(107,51,220,.28)` | CTA primario |

---

## Gradientes

No son tokens; se usan inline o como clases de componente:

- Logo: `linear-gradient(145deg, #8B5CF2, #6B33DC)`
- Barra de progreso: `linear-gradient(90deg, #6B33DC, #7C46E8)`
- Avatar neutro: `linear-gradient(145deg, #F1EDFB, #E4DEF3)`

---

## Mapeo viejo → nuevo

| Antes | Después |
|---|---|
| `bg-slate-950` (fondo app) | `bg-canvas` |
| `bg-slate-950` (sidebar) | `bg-surface-raised` |
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
| `bg-sky-400` / `bg-sky-300` (CTA) | `bg-brand` / `bg-brand-hover` + texto `text-white` |
| `text-slate-950` sobre CTA | `text-white` |
| `bg-sky-950/40` (fila seleccionada) | `bg-brand-tint` |
| `from-sky-400 to-indigo-500` (logo) | gradiente `145deg #8B5CF2 → #6B33DC` |
| `text-emerald-*`, `bg-emerald-950*`, `border-emerald-900` | `good` / `good-ink` / `good-tint` / `good-line` |
| `text-red-*`, `bg-red-950*`, `border-red-900` | `danger` / `danger-ink` / `danger-tint` / `danger-line` |
| `shadow-slate-950/30` | `shadow-card` |

---

## Recetas de componente

### Eyebrow

```tsx
<p style={{
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: ".14em",
  textTransform: "uppercase",
}} className="text-ink-faint">
  LABEL
</p>
```

Eyebrow destacado (sección activa): `className="text-brand"`.

### CTA primario

```tsx
<button
  className="text-white bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
  style={{
    borderRadius: 8,
    padding: "12px 20px",
    fontSize: 14,
    fontWeight: 600,
    boxShadow: "var(--shadow-brand)",
    transitionProperty: "background-color, box-shadow",
    transitionDuration: "120ms",
    transitionTimingFunction: "var(--ease-dc)",
  }}
>
```

### Botón secundario

```tsx
<button
  className="border border-line-strong bg-transparent text-ink-mute hover:bg-surface-muted"
  style={{ borderRadius: 999, padding: "8px 20px", fontSize: 13 }}
>
```

### Tarjeta

```tsx
<div className="bg-surface border border-line shadow-card" style={{ borderRadius: 16, padding: 18 }}>
```

### Fila de lista (sidebar)

```tsx
<li className="flex items-center gap-2.5 rounded-[10px] cursor-default" style={{ padding: "10px 8px" }}>
  {/* badge izquierda (22×26), nombre flex-1 truncate, meta mono derecha */}
</li>
```

### Badge de tipo de artifact

```
note → text-cite bg-cite-tint border-cite-line  letra "N"
quiz → text-brand bg-brand-tint-strong border-brand  letra "Q"
test → text-good bg-good-tint border-good-line  letra "T"
```

### Píldora de veredicto (ejercicio)

```
correcto → bg-good-tint text-good-ink border border-good-line  rounded-full px-3 py-1
a revisar → bg-warn-tint text-warn-ink border border-warn-line  rounded-full px-3 py-1
```

### Textarea con foco de marca

```tsx
<textarea
  className="bg-surface border border-line-strong text-ink outline-none"
  style={{ borderRadius: 14, padding: "14px 16px" }}
  onFocus={(e) => {
    e.currentTarget.style.borderColor = "var(--color-focus-line)";
    e.currentTarget.style.boxShadow = "0 0 0 3px var(--color-focus-ring)";
  }}
  onBlur={(e) => {
    e.currentTarget.style.borderColor = "";
    e.currentTarget.style.boxShadow = "";
  }}
/>
```

### Zona punteada vacía

```tsx
<div className="rounded-2xl border border-dashed border-line p-8 text-center">
  <h2 className="text-ink-mute" style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: "32ch" }}>
    …
  </h2>
</div>
```

### Blockquote de cita (PR-02 / PR-07)

```tsx
<blockquote className="border-l-2 border-cite rounded-r-xl bg-cite-tint text-ink-soft px-4 py-3.5">
```

---

## Reglas duras

1. **Prohibido escribir una clase de color literal de Tailwind en `packages/web`.** Sin excepciones. El color sale de un token.
2. **¿Falta un color?** Se añade un token a `styles.input.css` y una fila a este documento, en el mismo commit. No se resuelve con un literal "de momento".
3. **`styles.generated.css` es generado.** Se edita `styles.input.css`.
4. **El guard debe dar 0** antes de abrir cualquier PR de UI:
   ```bash
   grep -rnE '(bg|text|border|ring|from|to|via|fill|stroke|placeholder|divide|shadow|accent)-(slate|sky|indigo|emerald|red|blue|gray|zinc|neutral|stone|violet|purple)-[0-9]{2,3}' packages/web/src/
   ```
