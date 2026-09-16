import { Console, Effect, Layer, Stream } from "effect";
import { Model as AiModel } from "effect/unstable/ai";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { SessionRepository, AgentHarness, AgentSession } from "./harness/index.ts";
import { GeminiModel } from "./gemini.ts";
import { FileSessionRepository } from "../../infra/agents/file-session-repository.ts";
import { MaterialRepository } from "../materials/material.ts";
import { ArtifactRepository } from "../artifacts/artifact.ts";
import { FileMaterialRepository } from "../../infra/materials/file-material-repository.ts";
import { PopplerPdfService } from "../../infra/materials/poppler-pdf-service.ts";
import { FileArtifactRepository } from "../../infra/artifacts/file-artifact-repository.ts";
import { makeMaterialCommands } from "./academic-tutor/material-commands.ts";
import { makeArtifactCommands } from "./academic-tutor/artifact-commands.ts";
import { AcademicTutorSkills } from "./academic-tutor/skills/index.ts";

export const makeAcademicTutorHarness = (
  materialRepository: MaterialRepository,
  artifactRepository: ArtifactRepository,
  materialsContext: string,
  openExerciseContext: string = "No exercise is open on the student's screen."
) => AgentHarness.make({
  name: `You are an academic tutor agent.

You help students understand academic material, especially their uploaded PDF materials.
Be precise, pedagogical, and honest about what you can infer from the available materials.

## Answer directly, without any tool call, when

- The question can be answered from general academic knowledge: definitions, worked
  examples, explanations, study techniques.
- The user is greeting you, thanking you, or asking what you can do.
- No PDF materials are uploaded (see the inventory below) and the user is not asking you
  to create, list, or grade an artifact.
- The information you need is already in this conversation, including results of tool
  calls from earlier turns.
- The question is about the exercise shown below under "Exercise open on the student's
  screen" — its questions, the student's answers, their marks or why an answer was wrong.
  That block is complete and current for this turn.

Answering directly is the default. A tool call must earn its place.

## Use a tool only when

- \`cli({"input": "materials view <id> <pages>"})\`: the answer depends on what a specific
  PDF actually says, and the inventory below already tells you the id exists.
- \`cli({"input": "artifacts ..."})\`: the user asked you to create, list, show, submit or
  grade a note, quiz or test.
- \`load_skill\`: immediately before performing the workflow that skill describes. Never
  load a skill to decide whether to answer.

## Formatting

Write any mathematical expression in LaTeX between \`$…$\` (inline) or \`$$…$$\` (display). Never use \`\\( \\)\` or \`\\[ \\]\`.

## Hard rules

- Never call \`materials list\`. The inventory below is current for this turn.
- Never call \`artifacts list\`, \`artifacts show\`, \`artifacts attempts\` or \`artifacts grade\`
  for the exercise already shown below. It is the same data, and it costs the student seconds.
- Never chain a second tool call unless the first result told you something you still
  need.
- If a tool fails, say so plainly in one line and answer with what you know.
- Each tool call costs the student several seconds of waiting. Spend them deliberately.

## Uploaded materials

${materialsContext}

## Exercise open on the student's screen

${openExerciseContext}`,
  skills: AcademicTutorSkills,
  commands: [
    makeMaterialCommands(materialRepository),
    makeArtifactCommands(artifactRepository)
  ]
});

export const academicTutorAgent = Effect.gen(function* () {
  const provider = yield* AiModel.ProviderName;
  const modelName = yield* AiModel.ModelName;
  const sessionRepository = yield* SessionRepository;
  const materialRepository = yield* MaterialRepository;
  const artifactRepository = yield* ArtifactRepository;
  const task = process.argv.slice(2).join(" ").trim() || "List my uploaded materials.";
  const sessionId = process.env.AGENT_SESSION_ID ?? "academic-tutor-demo";
  const storedSession = yield* sessionRepository.getSession(sessionId).pipe(
    Effect.catchTag("SessionNotFound", () => sessionRepository.makeSession({ id: sessionId }))
  );

  const materials = yield* materialRepository.list().pipe(
    Effect.orElseSucceed(() => [] as const)
  );
  const materialsContext = materials.length === 0
    ? "No PDF materials have been uploaded yet."
    : materials.map((m) => `- ${m.id}: "${m.title}" (${m.pageCount} pages)`).join("\n");
  const harness = makeAcademicTutorHarness(materialRepository, artifactRepository, materialsContext);
  const session = AgentSession.make(harness);

  console.log(`Provider: ${provider}`);
  console.log(`Model: ${modelName}`);
  console.log(`Session: ${sessionId}`);
  console.log("Conversation messages:");

  const messages = yield* session.stream({
    input: task,
    messages: storedSession.messages,
    // Same budget as TutorChatServiceLive: 4 does not fit a materials-backed flow.
    maxSteps: 8
  }).pipe(
    Stream.provide(harness.layer),
    Stream.tap((message) => Effect.gen(function* () {
      yield* sessionRepository.appendMessages({
        sessionId,
        messages: [message]
      });
      yield* Console.log(JSON.stringify(message, null, 2));
    })),
    Stream.runCollect
  );

  let output = "";
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "assistant") {
      output = message.content;
      break;
    }
  }

  console.log(output);

  return output;
}).pipe(
  Effect.provide(Layer.mergeAll(
    GeminiModel,
    FileSessionRepository.layer(".data/agent-sessions").pipe(
      Layer.provide(NodeServices.layer)
    ),
    FileMaterialRepository.layer(".data/materials/pdfs").pipe(
      Layer.provide(PopplerPdfService.layer),
      Layer.provide(NodeServices.layer)
    ),
    FileArtifactRepository.layer(".data/artifacts").pipe(
      Layer.provide(NodeServices.layer)
    )
  ))
);

if (import.meta.main) {
  Effect.runPromise(academicTutorAgent);
}
