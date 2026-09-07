# Dificultades y decisiones técnicas

Registro de obstáculos encontrados durante la implementación, con síntoma, causa, solución adoptada y alternativas descartadas.

---

## PR-1.5 — Sistema visual: tokens, tipografía y repintado

### Guard inicial devolvía 87, no ~145

**Síntoma**: el grep de colores literales antes del PR daba 87 coincidencias, no ~145 como estimaba el plan.

**Causa**: el plan se escribió a partir de un conteo manual del canvas; el grep real cuenta matches distintos (una clase puede repetirse en la misma línea, o no ser la única clase en un atributo `className`).

**Solución**: el objetivo relevante es 0 al final, no el valor inicial. Se anotó la discrepancia y se continuó.

**Descartado**: ajustar el grep para coincidir con el plan (no aporta valor; el guard en 0 es el criterio real).

---

### Sintaxis `@theme` en Tailwind 4.3.1

**Síntoma**: riesgo documentado en el plan — los tokens `--text-*` podrían no generar utilidades de interlineado en 4.3.1.

**Causa**: Tailwind v4 tiene soporte progresivo de algunos tokens; `--text-<n>--line-height` puede variar entre betas.

**Solución**: se definieron solo los tamaños (`--text-micro: 11px`, etc.) y el interlineado se aplicó inline con `style={{ lineHeight: 1.7 }}` donde era necesario. El build compiló sin errores.

**Descartado**: usar clases `leading-*` de Tailwind (habrían introducido valores no acordados con el canvas).

---

### Tokens con `rgba()` y opacidad de Tailwind

**Síntoma**: los tokens de color semitransparente (`--color-brand-tint: rgba(131,79,240,.12)`) podrían comportarse de forma inesperada con el sufijo de opacidad de Tailwind (p.ej. `bg-brand-tint/50`).

**Causa**: cuando el token ya lleva alfa, Tailwind no puede componer la opacidad correctamente.

**Solución**: regla fija — los tokens con alfa se usan tal cual, sin sufijo de opacidad. Documentado en el design system.

**Descartado**: usar tokens opacos + sufijo (habría requerido doblar tokens o aceptar valores no canónicos del canvas).

---

### Carga de Geist desde Google Fonts

**Síntoma**: la carga de fuentes es una dependencia de red; sin conexión, la app cae al fallback del sistema.

**Causa**: el canvas carga Geist desde Google Fonts y este PR lo replica.

**Solución**: Google Fonts con `display=swap`, fallback declarado (`ui-sans-serif, system-ui, sans-serif`). Sin red, la UI funciona pero se ve distinta métricamente.

**Descartado**: autoalojar con `@fontsource/geist` (añade dependencia y peso al bundle; sin requisito de offline no se justifica).

---

### Contraste de textos pequeños (pendiente de QA visual)

**Síntoma**: `ink-faint` (`#5F5975`) sobre `surface-raised` (`#F5F2FC`) a 11px podría no llegar a 4.5:1 (WCAG AA para texto pequeño).

**Causa**: los tonos del canvas están optimizados visualmente, no validados contra WCAG.

**Solución pendiente**: verificar con DevTools o una herramienta de contraste tras levantar la app. Si no llega a 4.5:1, se notifica al thinker para ajustar el token (no se cambia por cuenta propia).

**Descartado**: bajar el umbral a 3:1 (WCAG AA para texto grande) sin confirmar con producto.

---

## PR-12 — Fuga de sintaxis de tool call como texto

### `Effect.timeoutTo` no existe en 4.0.0-beta.83

**Síntoma**: el plan referenciaba `Effect.timeoutTo`; TypeScript no lo encontraba.

**Causa**: en v4 beta el API es `Effect.timeoutOrElse` (con `orElse: () => Effect<A2>`). No hay función `timeoutTo`.

**Solución**: `Effect.timeoutOrElse({ duration, orElse: () => Effect.succeed(fallbackString) })`.

**Descartado**: `Effect.timeout` (falla con `TimeoutException`, no devuelve un fallback).

---

### `Response.makePart` devuelve `Part` (decoded) pero `LanguageModel.make` espera `PartEncoded`

**Síntoma**: la función `generateText` en `LanguageModel.make` espera `Array<Response.PartEncoded>`, pero `makePart` devuelve tipos decoded (`TextPart`, `ToolCallPart`, etc.).

**Causa**: en v4 beta los tipos decoded y encoded son estructuralmente compatibles (el decoded añade `PartTypeId` simbólico que no bloquea la asignación estructural). El código original pasaba el typecheck sin cast.

**Solución**: en el nuevo código (donde el tipo se hace explícito a través de `ResponsePartsResult`), se usa `as unknown as Response.PartEncoded` para no perder tiempo en un problema de tipos no observable en runtime.

**Descartado**: cambiar la interfaz `ResponsePartsResult.parts` a `AnyPart[]` (más ruidoso en tipos downstream).

---

### `promptContents` necesita sincronía con `renderMessage` (deuda PR-12 Opción A)

**Síntoma**: las dos regex `TOOL_CALL_RE` / `TOOL_RESULT_RE` en `gemini.ts:promptContents` reconocen el formato que produce `renderMessage` en `session.ts`. Si uno cambia sin el otro, el historial deja de traducirse a partes nativas.

**Causa**: la Opción A del plan es un parche local. La solución correcta (Opción B) exige cambiar `AgentMessage` y el contrato NDJSON; se postergó al PR-05.

**Solución**: comentario en el código señalando la dependencia. El doer la ha marcado como deuda.

**Descartado**: implementar la Opción B en este PR (4 sitios afectados + cambio de contrato de streaming).

---

### `yield* Effect.fail(new TaggedError(...))` lint error TS29 en poppler

**Síntoma**: el compilador (regla TS29 de Effect) rechaza `yield* Effect.fail(new PdfServiceError(...))`.

**Causa**: `TaggedError` implementa la interfaz `Yieldable`, así que `yield* new PdfServiceError(...)` es la forma correcta en v4.

**Solución**: `return yield* new PdfServiceError({ reason: ... })`.

**Descartado**: `throw new PdfServiceError(...)` (no es una operación de Effect y rompe el tipo de retorno).
