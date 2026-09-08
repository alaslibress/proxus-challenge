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

## Qué reportar en una entrega

- Checks ejecutados y resultado.
- Flujo manual probado.
- Limitaciones conocidas.
- Si no se pudo probar AI por falta de API key, indícalo explícitamente.
