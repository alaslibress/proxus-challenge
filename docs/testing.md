# Testing y QA

## Checks automáticos

Desde la raíz:

```bash
pnpm run typecheck
pnpm run test
pnpm --filter @proxus/web run build
```

Para backend solamente:

```bash
pnpm --filter @proxus/server run typecheck
```

## Tests automáticos (sin API key, sin red)

`pnpm run test` desde la raíz es un alias de `pnpm -r test` y lanza las dos suites de
vitest (server y web). **No necesita `.env`, ni API key, ni conexión**: el `LanguageModel`
y el `MaterialRepository` son falsos.

```bash
pnpm run test                              # las dos suites
pnpm --filter @proxus/server run test      # sólo backend
pnpm --filter @proxus/web run test         # sólo frontend
pnpm --filter @proxus/server run test:watch
```

Resultado actual: **25 ficheros, 222 tests, todos en verde** (server 19/182, web 6/40).

Cubren el motor de evaluación y su degradación cuando un profe o el Juez caen, la
verificación literal de citas, el formato de la traza Markdown, el purgado de schemas para
Gemini, el lector NDJSON del navegador, el stream de evaluación y el estado del panel.

Ficheros clave por área — mirar primero si se toca lo que protegen:

- `packages/server/src/domain/agents/harness/__tests__/session-step-budget.test.ts`
  (**4 tests**). Con un `LanguageModel` falso que guioniza cuatro turnos que sólo llaman
  herramientas, agota el presupuesto de pasos y comprueba: que la respuesta **no** contiene
  el volcado crudo de la página (`--- <materialId> page 4 ---`, el formato exacto que emite
  `materials text`); que se gasta **exactamente un turno extra** con `toolChoice: "none"`;
  que si ese turno de cierre también falla sale un mensaje honesto y nunca el volcado; y
  que un turno que termina dentro del presupuesto no paga ese coste (2 llamadas, no 3).
- `packages/server/src/domain/artifacts/__tests__/artifact-schema.test.ts` (**5 tests**).
  Decodifica contra los schemas de `@proxus/shared`: `maxScore` de `short-answer` se
  rellena a **1** cuando falta y se respeta cuando viene; un `test` con `short-answer` sin
  `maxScore` decodifica; una pregunta cerrada **sin `explanation` se rechaza**; y un `test`
  con los tres tipos de pregunta, escrito tal y como lo documenta la skill
  `create-study-artifacts`, decodifica entero. Este último es el que ata la documentación
  del agente al schema: si se separan, se pone rojo.
- `packages/server/src/domain/evaluation/__tests__/prompts.test.ts` (**2 tests**, PR-16).
  Recorre los seis system-prompts (Good Teacher, Bad Teacher y Judge × 2 modos) y
  verifica que ninguno contiene "in English" y que todos incluyen la regla de idioma.
  Si alguien reintroduce el hardcode en inglés, se pone rojo.
- `packages/server/src/domain/evaluation/__tests__/schema-retrocompat.test.ts` (**3 tests**,
  PR-16). Decodifica `ShortAnswerCorrection` sin los campos nuevos `panel`, `goodTeacher` y
  `badTeacher`: garantiza que los intentos grabados antes de PR-16 siguen siendo legibles.
- `packages/web/src/domain/artifacts/__tests__/panel-status.test.ts` (**7 tests**, PR-16).
  Cubre los tres variantes de `PanelStatus` más el caso `undefined`, y los cuatro valores
  de `why` en modo `ran+ungrounded`. Si se añade un nuevo `why`, falla hasta que se añade
  su case en `panel-status.ts`.

Lo que **no** cubren: la calidad de los prompts. Ante una respuesta X del Juez garantizan
que el sistema hace Y; para saber si el Juez acierta hay que ejecutar la eval con LLM real
de la sección siguiente.

## Evals / smoke tests AI

Sólo **estas** requieren `.env` con `GOOGLE_GENERATIVE_AI_API_KEY` (y gastan cuota). Los
tests automáticos de arriba no.

```bash
pnpm --filter @proxus/server run eval:tutor:artifact-authoring
pnpm --filter @proxus/server run agent:tutor "Crea un quiz corto de una pregunta sobre variables cualitativas"

# el panel de evaluación de punta a punta, sin levantar la app:
#   panel:check <respuestaAlumno> <respuestaEsperada> <materialId> <página>
pnpm --filter @proxus/server run panel:check \
  "Un gráfico técnicamente impecable que cuenta la historia equivocada no sirve" \
  "Un gráfico técnicamente perfecto que cuenta la historia equivocada es tan inútil como uno bonito pero confuso" \
  guiaMuestraDeDatos 2

# salida estructurada nativa (generateObject + responseSchema) contra Gemini:
pnpm --filter @proxus/server run structured-output:check
```

`panel:check` es el **único** paso que mide si los prompts del panel son buenos: imprime
la crítica de Profe Bueno, la de Profe Malo y el JSON del Juez, y deja la traza en
`packages/server/.data/sessions/panel-check-<timestamp>.md`. El `materialId` es el nombre
del PDF sin `.pdf` dentro de `packages/server/.data/materials/pdfs/`, y la página debe
tener capa de texto.

### Resultados en vivo (8-sep-2026, `gemini-3.6-flash`)

Los tres scripts se ejecutaron contra el modelo real. Resultado:

- **`structured-output:check`**: verde. `generateObject` devolvió JSON válido contra
  `FinalFeedbackSchema`.
- **`eval:tutor:artifact-authoring`**: **3/3 casos, 9/9 criterios** (`creates-note`,
  `creates-quiz`, `creates-test`): tipo de artefacto correcto, número de preguntas
  correcto, artefacto mencionado en la respuesta y cero tool results fallidos. Primera
  evidencia con modelo real de que el arreglo de la fuga de tool calls (PR-12) aguanta.
- **`panel:check`**: dos pasadas de punta a punta, una por cada dirección de la regla, cada
  una con su traza en `packages/server/.data/sessions/`:
  - `panel-check-1788895344615.md` — respuesta correcta en abstracto (*"la media es 4"*)
    pero **no sostenida por la página inyectada**: `is_correct: false`, el Juez explica que
    esa página sólo trata visualización de datos y **la nota no sube**.
  - `panel-check-1788895812699.md` — respuesta anclada en el material (orden Matplotlib →
    Seaborn → Plotly): `is_correct: true`, cita `verified: true` con la frase literal
    *"Aprende primero Matplotlib (la base), luego Seaborn (el atajo elegante) y finalmente
    Plotly (la interactividad)."*, página 2 de `guiaMuestraDeDatos`; la traza cierra con
    `Nota determinista: 0` / `Nota final: 1` / `Nota modificada por el panel: sí (1 cita
    verificada)`.

  En las dos pasadas los dos profes discreparon y el Juez arbitró.

Antes, con la key agotada, se había comprobado la otra mitad: al caer las tres llamadas con
`429`, el motor devuelve `EvaluationUnavailable`, la traza recoge el motivo de cada fallo y
la nota se queda en la determinista. La ruta de degradación es real, no sólo de laboratorio.

### Cuota y modelo (leer antes de re-ejecutar)

- El *free tier* de Gemini da **20 peticiones al día y por modelo** (`429
  RESOURCE_EXHAUSTED`, *"Quota exceeded for metric:
  generate_content_free_tier_requests, limit: 20"*). Los tres scripts juntos gastan ~19-20:
  **no caben dos rondas completas el mismo día.** Planifica cuál interesa repetir.
- `panel:check` gasta **5 llamadas donde bastarían 3**: repite a los dos profes fuera del
  motor sólo para poder imprimir sus críticas
  (`packages/server/src/domain/evaluation/panel.check.ts:46-64`), encima de las tres del
  motor.
- **No hay modelo de reserva** sobre el que repartir cuota. `gemini-3.6-flash` es el único
  modelo de texto disponible para esta key: `gemini-2.5-flash` devuelve **404 "no longer
  available to new users. Please update your code to use models/gemini-3.6-flash"**, y
  también dan 404 `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` y
  `flash-latest`. `.env.example` apunta ya a `gemini-3.6-flash`.
- `panel:check` **no está roto**: provee `NodeServices.layer` en su propio wiring
  (`panel.check.ts:91-101`, arreglado en `d11a248`). Si falla, es cuota, modelo o material.
- **Su traza ya no miente.** Calculaba `finalScore`/`scoreOverridden` a partir de
  `is_correct` a secas y anunciaba subidas de nota que el motor no aplica; ahora usa
  `panelRaisesScore` (`domain/evaluation/review.ts:72-76`), la misma función que aplica el
  motor. Si comparas trazas viejas de `panel-check-*.md`, ojo con esa diferencia.

## QA manual recomendado

1. Arranca app completa:

   ```bash
   pnpm run dev
   ```

2. Abre `http://localhost:5173`.
3. Comprueba que la sidebar lista materiales y artifacts.
4. Sube un PDF arrastrándolo al uploader del sidebar. Verifica:
   - barra de progreso,
   - el material aparece en la lista sin recargar,
   - subir el mismo fichero otra vez crea un segundo material (`nombre-2`), no lo pisa,
   - un fichero que no sea PDF se rechaza con mensaje propio, y la lista sigue funcionando.
5. Pide al tutor crear un quiz.
6. Selecciona el artifact creado.
7. Responde preguntas y envía intento.
8. Verifica:
   - score total,
   - corrección por pregunta,
   - opción `try again`,
   - layout sin workspace cuando no hay artifact seleccionado.
9. Haz una pregunta larga y pulsa `Stop` a mitad. Verifica:
   - los mensajes ya recibidos siguen en pantalla,
   - el textarea queda vacío, sin repoblar con el prompt,
   - aparece la marca `Stopped` y no hay error ni `Retry`,
   - en la consola del server, el `http.span` cierra en ese instante y no llegan más
     `agent.step` de ese turno.
10. Flujo de respuesta corta con panel (PR-07 + PR-14). **El panel ya no requiere PDF**;
    funciona en modo `ungrounded` para cualquier test, incluso sin material subido:
    - Pide al tutor un **test** con al menos dos preguntas de respuesta corta. Si tienes
      un PDF con capa de texto en `packages/server/.data/materials/pdfs/`, pide que
      el test salga de él (modo `grounded`); si no, cualquier test sirve (`ungrounded`).
    - Responde: una paráfrasis correcta, una equivocada y una en blanco. Envía.
    - Observa el panel de progreso: **Good Teacher** y **Bad Teacher** activos a la vez
      (etiquetas en inglés), luego **Judge deliberating**, y el contador *"Question N of Y"*
      avanzando. Sin barras de progreso ni porcentajes.
    - Mientras Good Teacher o Bad Teacher están activos, comprueba el **transcript en
      vivo**: un panel con scroll automático muestra primero el canal `thought` (en
      itálica) y después el canal `text` actualizándose carácter a carácter.
    - Pulsa **Cancel** en mitad de otro envío: el formulario vuelve a ser editable y no
      queda ningún estado colgado (ni `isSubmitting`, ni error fantasma).
    - Al terminar, revisa por cada `short-answer`: el feedback razonado del Juez, y sus
      citas.
    - Comprueba el **indicador del panel** (`PanelIndicator`) encima del feedback:
      - **`ran: true, grounded: true`** (PDF leído): etiqueta "Advanced reasoning ·
        grounded in the PDF".
      - **`ran: true, grounded: false`** (sin evidencia): etiqueta "Advanced reasoning ·
        no PDF evidence" con detalle del motivo (`no-source`, `no-pages`, etc.).
      - **`ran: false`** (motor caído): etiqueta "Advanced reasoning unavailable · automatic
        mark stands".
    - Si hay texto de algún profe, aparece el botón **"See the panel debate"**. Púlsalo y
      verifica que el modal muestra las secciones Good Teacher, Bad Teacher y Judge, con el
      texto o el motivo de fallo de cada uno, y las citas del Juez.
    - Comprueba las citas según el modo:
      - **grounded**: una cita `verified: true` sale con "Verified · … · p. N";
        una `verified: false` sale visualmente distinta con "Not verified against the PDF"
        y sin número de página. Si ninguna queda verificada, aparece "Advisory evaluation:
        no citation could be verified, so the automatic mark stands."
      - **ungrounded** (sin fuente): aparece el aviso "Advisory evaluation: no citation
        could be verified, so the automatic mark stands." junto con la nota de que el
        panel juzgó contra la respuesta esperada sin evidencia PDF.
    - Con `GEMINI_MODEL` apuntando a un modelo inexistente, repite el envío: debe salir
      la corrección determinista sin `review` y sin romper el layout.
    - Con el endpoint de streaming caído (o inaccesible), el envío debe seguir
      funcionando por la ruta tipada (`submitArtifactAttemptAction`), sin panel de
      progreso.
    - Multiple-choice y true-false deben verse y comportarse exactamente igual que
      siempre: no pasan por el panel.
    - Un artifact `test` creado antes de PR-04 (sin `source`, sin `review` posible) se
      corrige y se renderiza sin huecos ni errores.
    - **Caso quiz**: envía un intento de un quiz (solo multiple-choice/true-false). No
      debe aparecer ningún panel de progreso; la corrección es instantánea y determinista.
11. **Fuga del volcado de página al agotarse el presupuesto de pasos** (requiere API key).
    Es el bug que destapó esta QA: el harness guardaba el último tool result y, sin pasos,
    lo devolvía como si fuera la respuesta del tutor.
    - Pide algo que obligue a encadenar herramientas: *"créame un quiz de tres preguntas a
      partir de las páginas 1 a 4 de \<mi PDF\>"*.
    - En la respuesta del tutor **no** puede aparecer texto crudo del PDF ni la cabecera
      `--- <materialId> page N ---`. Si el turno se queda sin pasos, lo que debe salir es
      una respuesta redactada, o —si el turno de cierre falla— un mensaje explícito de que
      se quedó sin pasos.
    - En los logs del server, un turno agotado deja `agent.wrap_up` después del último
      `agent.step`. Ver ese log **no** es un fallo; ver el volcado en pantalla, sí.
    - `maxSteps` está en **8** en las dos puertas de entrada del tutor
      (`tutor-chat-service.ts` y `academic-tutor.ts`); si se baja, los flujos con
      materiales vuelven a no caber.
12. **Contrato de creación de artefactos** (requiere API key). El otro bug: el modelo
    adivinaba el schema y el `SchemaError` acababa en pantalla.
    - Pide un **test** con respuestas cortas: debe crearse a la primera, sin ningún error de
      validación visible para el alumno.
    - Pide un quiz de opción múltiple: cada pregunta debe traer su `explanation` (es lo que
      se le enseña al alumno tras corregir), y las opciones deben ser objetos
      `{"id","text"}`.
    - Pide una pregunta *"con varias respuestas correctas"*: no existe ese tipo. El tutor
      debe elegir —`short-answer` que pida la lista, o varias preguntas de una sola
      respuesta— y **decir cuál eligió**, no fabricar un formato inválido.
    - Si aun así falla la validación, el mensaje de error del CLI enumera los campos
      requeridos por tipo de pregunta (`artifact-commands.ts`); ese texto va dirigido al
      modelo, y es la pista de qué se le olvidó documentar.

## QA manual PR-15 — reintentos ante 503

El 503 no se puede pedir a voluntad a Google, así que se provoca localmente.

1. **Sin cambios (baseline).** Con `pnpm run dev` y API key válida: usa el chat y corrige
   un test con respuestas cortas. En el log del server **no** debe aparecer ninguna línea
   `gemini.retry`. Nada ha cambiado.

2. **API key inválida (4xx no se reintenta).** Cambia `GOOGLE_GENERATIVE_AI_API_KEY` por
   basura y reinicia. Manda un mensaje al tutor → el error aparece **inmediatamente**, sin
   esperar varios segundos, y **no** hay líneas `gemini.retry` en el log. Prueba que los
   4xx no se reintentan. Devuelve la key correcta y reinicia antes del paso siguiente.

3. **503 simulado (transitorio).** Levanta un servidor local de un fichero que devuelva
   `503` las dos primeras peticiones y luego haga de proxy (o que devuelva `503` siempre
   para ver las tres líneas). Apunta `geminiUrl`/`geminiStreamUrl` en `gemini.ts` a ese
   servidor. Manda un mensaje al tutor → en el log deben aparecer **hasta tres** líneas
   `gemini.retry` con `status: 503`, esperas crecientes. Si el proxy termina cediendo,
   el turno acaba con respuesta normal. **Revierte el cambio antes de commitear**;
   `git status` debe quedar limpio.

4. **Corte a mitad de stream.** Con el mismo servidor local, envía algunos eventos SSE y
   luego corta la conexión. En la UI: el texto del profe se queda a medias, **no vuelve
   a empezar desde el principio** y el panel termina igualmente con la nota determinista.
   En el log, el campo `method` debe decir `streamText` para los profes y `generateText`
   para el chat y el Juez.

Si no hay API key ni servidor local disponibles, indicar explícitamente en el cuerpo del
PR qué pasos se omitieron.

## Qué reportar en una entrega

- Checks ejecutados y resultado.
- Flujo manual probado.
- Limitaciones conocidas.
- Si no se pudo probar AI por falta de API key, indícalo explícitamente.
