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
