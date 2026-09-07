# Documentación

Referencia estable del proyecto: intención, decisiones y estado real del código. No
contiene planes de trabajo: esos viven en [`../planes/`](../planes/).

Los ADR están transcritos literales; cada uno lleva al final una sección **Notas del
thinker**, claramente separada, con los hechos del código que condicionan su
implementación.

- [`tech-spec.md`](./tech-spec.md) — la Tech Spec de "Mi profe favorito", transcrita
  literal. Documento de intención.
- [`adr-motor-evaluacion.md`](./adr-motor-evaluacion.md) — ADR-01: sustitución de la
  validación determinista, structured output y SSOT de schemas.
- [`adr-02-evaluacion-transporte-observabilidad.md`](./adr-02-evaluacion-transporte-observabilidad.md)
  — ADR-02: motor multi-agente aislado, endpoint NDJSON dedicado, estados discretos y
  trazabilidad nativa en Markdown.
- [`funcionamiento-actual.md`](./funcionamiento-actual.md) — cómo funciona el repo hoy,
  verificado en el código, y la tabla de lo que la spec da por hecho y no existe.
- [`contexto-repo.md`](./contexto-repo.md) — arquitectura, comandos y trampas conocidas.
  Lectura obligatoria antes de implementar cualquier plan.

Para implementar, el punto de entrada es [`../planes/GUIA-DOER.md`](../planes/GUIA-DOER.md).

La documentación original del template sigue en [`../docs/`](../docs/).
