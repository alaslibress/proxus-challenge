# Reporte de testing — Fase 1 (automatizado)

> Cubre todo lo probado de forma automática en esta sesión, sobre el estado actual
> del repo (`main`, commit `efbe1a0`). **No incluye QA manual** (`pnpm run dev` +
> flujo de chat/quiz/PDF en navegador): esa parte la ejecuta el usuario directamente
> ahora que las dependencias están instaladas.

Fecha: 2026-09-08.

---

## 1. Entorno preparado

- **`.env` creado** en la raíz del repo (antes solo existía `.env.example`).
  Variables: `PORT`, `WEB_PORT`, `PROXUS_API_URL`, `GOOGLE_GENERATIVE_AI_API_KEY`,
  `GEMINI_MODEL=gemini-3.6-flash` (modelo actual del proyecto, ver
  [`funcionamiento-actual.md §6`](./funcionamiento-actual.md)). Está en `.gitignore`
  (líneas 25-26), no se commitea.
- **Poppler instalado** vía `winget install oschwartz10612.Poppler` (`pdfinfo`,
  `pdftoppm` y el resto de utilidades quedan en el `PATH` de usuario). Antes de esto,
  `PdfService` no podía arrancar: `packages/server/.data/` no existe en un checkout
  limpio y el binario tampoco estaba presente.
- **Gestor de paquetes**: `corepack pnpm` falla con `ERR_PNPM_BAD_PM_VERSION`
  (corepack resuelve a pnpm v12.3.4; el proyecto pinea `10.23.0` en
  `packageManager`, y `corepack use pnpm@10.23.0` no corrige el fallo en `run`).
  Workaround usado en todos los comandos: `npx --yes pnpm@10.23.0 <comando>`.

## 2. Checks automáticos

| Check | Comando | Resultado |
|---|---|---|
| Typecheck (4 paquetes) | `pnpm run typecheck` | ✅ PASS — `ai-google`, `shared`, `web`, `server` sin errores |
| Tests unitarios servidor | `pnpm --filter @proxus/server run test` | ✅ PASS — 27/27 (4 suites: `message.ts`, `session.ts`, `gemini.ts` thoughtSignature, `tutor-chat-service.ts` buildMaterialsContext) |
| Tests unitarios web | `pnpm --filter @proxus/web run test` | ✅ PASS — 7/7 (`stream.ts` `isAbortError`) |
| Build web | `pnpm --filter @proxus/web run build` | ✅ PASS — Tailwind + Vite compilan sin error. Warning no bloqueante: chunk `index-*.js` 868.94 kB (> límite recomendado de 500 kB), sin code-splitting |

## 3. Evals / smoke tests AI (con API key real)

### `pnpm --filter @proxus/server run eval:tutor:artifact-authoring`

Dataset de 3 casos, todos llaman a Gemini de verdad (no hay `LanguageModel` falso):

| Caso | Resultado |
|---|---|
| `creates-note` | ✅ PASS — 3/3 aserciones |
| `creates-quiz` | ✅ PASS — 3/3 aserciones |
| `creates-test` | ❌ FAIL — no se creó el artifact esperado |

Causa del fallo en `creates-test`: **HTTP 429 de la API de Gemini** (cuota excedida
tras las dos llamadas anteriores del mismo run), no un defecto de código. La
aserción `should-not-have-tool-failures` del caso sí pasó (no hubo tool result
fallido, el paso simplemente no llegó a ejecutarse por el error de cuota). El script
sale con código de error porque no soporta ejecutar un solo caso ni reintentos
(confirmado en [`funcionamiento-actual.md §8`](./funcionamiento-actual.md): "no
existe un `LanguageModel` falso", "no hay flag para ejecutar un solo caso").

### `pnpm --filter @proxus/server run agent:tutor "Crea un quiz corto..."`

Primer intento (antes de instalar Poppler): ❌ falló al arrancar con
`PdfServiceError: Missing required Poppler command "pdfinfo"`. Tras instalar
Poppler el binario queda disponible; **pendiente de re-ejecutar este smoke test**
(no se repitió en esta fase porque el objetivo era dejar el entorno listo para que
el usuario haga la QA manual, que ejercita la misma ruta con más contexto).

## 4. Limitaciones conocidas de esta fase

- Ningún flujo de UI (`pnpm run dev`, navegador) se ejecutó — es exactamente lo que
  queda para la fase manual del usuario.
- `packages/server/.data/materials/pdfs/` sigue vacío: no hay PDFs de prueba
  cargados. Para que la QA manual del flujo de materiales tenga sentido, hay que
  subir al menos un PDF desde la UI (el uploader ya está siempre visible, PR-13 +
  fix `95e1ef6`).
- El caso `creates-test` del eval no quedó verificado por el 429; re-ejecutar el
  eval en un momento con cuota libre lo confirmaría.
- No se ha tocado nada de la Decisión 1/2 del ADR (`is_correct`, `citas_pdf`,
  `generationConfig`/`responseSchema`): esa evaluación semántica sigue sin existir
  en el código (`gradeAttempt` sigue siendo comparación determinista de strings,
  ver [`funcionamiento-actual.md §5`](./funcionamiento-actual.md)). Esta fase de
  testing es sobre el código **tal y como está hoy**, no sobre el ADR.
