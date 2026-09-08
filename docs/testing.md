# Testing y QA

## Checks automáticos

Desde la raíz:

```bash
pnpm run typecheck
pnpm --filter @proxus/web run build
```

Para backend solamente:

```bash
pnpm --filter @proxus/server run typecheck
```

## Evals / smoke tests AI

Requieren `.env` con `GOOGLE_GENERATIVE_AI_API_KEY`.

```bash
pnpm --filter @proxus/server run eval:tutor:artifact-authoring
pnpm --filter @proxus/server run agent:tutor "Crea un quiz corto de una pregunta sobre variables cualitativas"
```

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
10. Flujo de respuesta corta con panel (PR-07, requiere un PDF con capa de texto en
    `packages/server/.data/materials/pdfs/`):
    - Pide al tutor un **test** con tres preguntas de respuesta corta de la misma página.
    - Responde: una paráfrasis correcta, una equivocada y una en blanco. Envía.
    - Observa el panel de progreso: **Profe Bueno** y **Profe Malo** activos a la vez,
      luego **Juez deliberando**, y el contador *"Pregunta N de M"* avanzando. Sin barras
      de progreso ni porcentajes.
    - Pulsa **Cancelar** en mitad de otro envío: el formulario vuelve a ser editable y no
      queda ningún estado colgado (ni `isSubmitting`, ni error fantasma).
    - Al terminar, revisa por cada `short-answer`: el feedback razonado del Juez, y sus
      citas.
    - Comprueba las citas:
      - una `verified: true` sale con su página, contrástala abriendo el PDF por esa
        página;
      - una `verified: false` sale visualmente distinta (color e icono distintos) con el
        texto *"Sin verificar en el PDF"* y **sin número de página**.
      - si ninguna cita quedó verificada, aparece el aviso *"Evaluación orientativa: no
        se pudo verificar ninguna cita, la nota es la automática."*.
    - Con `GEMINI_MODEL` apuntando a un modelo inexistente, repite el envío: debe salir
      la corrección determinista sin `review` y sin romper el layout.
    - Con el endpoint de streaming caído (o inaccesible), el envío debe seguir
      funcionando por la ruta tipada (`submitArtifactAttemptAction`), sin panel de
      progreso.
    - Multiple-choice y true-false deben verse y comportarse exactamente igual que
      siempre: no pasan por el panel.
    - Un artifact `test` creado antes de PR-04 (sin `source`, sin `review` posible) se
      corrige y se renderiza sin huecos ni errores.

## Qué reportar en una entrega

- Checks ejecutados y resultado.
- Flujo manual probado.
- Limitaciones conocidas.
- Si no se pudo probar AI por falta de API key, indícalo explícitamente.
