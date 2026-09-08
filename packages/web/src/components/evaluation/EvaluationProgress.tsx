import type { AttemptEvaluationStage } from "@proxus/shared";
import type { EvaluationRunState } from "../../domain/artifacts/evaluation-atoms.ts";

const STAGE_LABEL: Record<AttemptEvaluationStage, string> = {
  evaluating_good: "Profe Bueno analizando…",
  evaluating_bad: "Profe Malo criticando…",
  deliberating: "Juez deliberando validaciones del PDF…"
};

const STAGE_ORDER: readonly AttemptEvaluationStage[] = ["evaluating_good", "evaluating_bad", "deliberating"];

export function EvaluationProgress({
  run,
  onCancel
}: {
  readonly run: Extract<EvaluationRunState, { readonly phase: "running" }>;
  readonly onCancel: () => void;
}) {
  return (
    <div aria-live="polite" aria-busy={true}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-mute" style={{ fontSize: 13 }}>
          {run.questionTotal > 0
            ? `Pregunta ${run.questionIndex + 1} de ${run.questionTotal}`
            : "Corrigiendo…"}
        </p>
        <button
          className="border border-line-strong bg-transparent text-ink-mute hover:bg-surface-muted"
          style={{
            borderRadius: 999,
            padding: "8px 20px",
            fontSize: 13,
            transitionDuration: "120ms",
            transitionTimingFunction: "var(--ease-dc)",
          }}
          type="button"
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
      <ul className="mt-3 grid gap-2">
        {STAGE_ORDER.map((stage) => {
          const active = run.activeStages.includes(stage);
          return (
            <li
              key={stage}
              className="flex items-center gap-2 text-ink-mute"
              style={{ fontSize: 13, opacity: active ? 1 : 0.5 }}
            >
              <span aria-hidden="true" className={active ? "animate-pulse" : undefined}>
                {active ? "◐" : "○"}
              </span>
              {STAGE_LABEL[stage]}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
