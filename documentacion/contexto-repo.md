# Contexto del repositorio

Mapa de arquitectura y comandos. Lectura obligatoria para el doer antes de implementar cualquier plan.

`proxus-challenge`: a fullstack + AI take-home template (Proxus Product Engineer challenge). An academic tutor agent that reads uploaded PDF materials via Gemini, authors study artifacts (`note`, `quiz`, `test`), and lets the user solve them in a React workspace with grading feedback. `CHALLENGE.md` states the evaluation criteria: the expected deliverable is a substantial product/architecture evolution, not cosmetic fixes. Docs in `docs/` (architecture, effect-primer, ai-agent, api, testing, data, development) are the canonical prose; repo docs are in Spanish.

## Commands

Node 20+, pnpm only (never Bun — no `Bun.serve`, `Bun.file`, `bun:*`). Setup: `pnpm install`, then `cp .env.example .env` and set `GOOGLE_GENERATIVE_AI_API_KEY`. Poppler (`pdfinfo`, `pdftoppm`) must be on PATH or the server refuses to start.

```bash
pnpm run dev                                  # server (:3000) + web (:5173) in parallel
pnpm --filter @proxus/server run dev          # backend only
pnpm --filter @proxus/web run dev             # frontend only (tailwind watch + vite)
pnpm run typecheck                            # tsc --noEmit across all packages  (the lint gate)
pnpm --filter @proxus/server run typecheck    # single package
pnpm --filter @proxus/web run build           # tailwind --minify + vite build -> packages/web/dist
pnpm --filter @proxus/server run agent:tutor "list my uploaded materials"   # tutor via CLI, no browser
pnpm --filter @proxus/server run eval:tutor:artifact-authoring             # AI eval suite (needs API key)
```

There is **no test runner** (no vitest/jest). "Tests" are: `typecheck` + web `build` + the hand-rolled eval script at `packages/server/src/domain/agents/academic-tutor/evals/artifact-authoring.eval.ts`, which runs its whole dataset and exits non-zero if any case fails. To run a *single* eval case you must filter `dataset.cases` in that file — there is no `--case` flag. Ad-hoc agent probing is done with `agent:tutor "<prompt>"` (`AGENT_SESSION_ID` env var selects/persists the session). Manual QA checklist lives in `docs/testing.md`.

Server entrypoints run TypeScript directly: `node --env-file=../../.env --import tsx <file>` — `.env` is read from the repo root, so package scripts always reference `../../.env`.

## Architecture

pnpm workspace, four packages, dependency direction `web -> shared <- server -> ai-google`:

- `packages/shared` — the contract layer. Effect `HttpApi` definition (`ProxusApi`, prefixed `/api`, groups tutor/materials/artifacts) plus `Schema` types for artifacts, materials and agent messages. Must not import server or web. Changing a schema here breaks both sides on purpose; fix outward from `shared`.
- `packages/server` — Node + Effect, layered `transport -> domain <- infra`. `transport/http/server.ts` is the composition root (routes, Scalar docs, layer wiring); `domain/` holds tutor/harness/materials/artifacts plus the `MaterialRepository` / `ArtifactRepository` / `PdfService` ports; `infra/` implements those ports over the filesystem, Poppler CLI and Gemini. Note `domain/agents/gemini.ts` is conceptually infra but lives in domain — a known layering wart.
- `packages/web` — React 19 + Vite + Tailwind v4, remote state via `@effect/atom-react` atoms over a typed `HttpApiClient` derived from `ProxusApi`.
- `packages/ai-google` — a vendored `@effect/ai-google` beta (Google client/model/tools for Effect AI). Currently declared as a server dependency but *not imported*; the live Gemini adapter is the hand-rolled `domain/agents/gemini.ts`.

Everything is Effect v4 **beta** (`effect@4.0.0-beta.83`, pinned identically in every package). Much of the API lives under `effect/unstable/*` (`effect/unstable/http`, `effect/unstable/httpapi`, `effect/unstable/ai`, `effect/unstable/reactivity/Atom`). Services are `Context.Service` + `Layer`; errors are `Data.TaggedError` unions handled with `Effect.catch`/tag matching; `@effect/language-service` is patched into tsc via the root `prepare` script. tsconfig is strict-plus (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `verbatimModuleSyntax`) and uses `rewriteRelativeImportExtensions`, so **relative imports must carry the `.ts` extension**.

### Agent harness

The tutor is not a bag of tools. `domain/agents/harness/harness.ts` exposes exactly two tools to the model: `load_skill` (fetches a named skill's full instruction text) and `cli` (executes a string against a hand-written CLI parser in `harness/cli.ts` with `--help`, subcommands and typed args). Skills (`academic-tutor/skills/*`) are prompt text listed by name+description in the system prompt and only expanded on demand; domain capabilities are exposed as CLI commands (`materials list|view`, `artifacts …`) built from `material-commands.ts` / `artifact-commands.ts`. `harness/session.ts` runs the bounded tool loop (`maxSteps`, default 8), emitting `AgentMessage`s that can be either collected (`run`) or streamed (`stream`). Adding a capability means adding a CLI command and/or a skill, not a new model tool.

Gemini access is a custom `LanguageModel` layer hitting `generativelanguage.googleapis.com/v1beta` with `fetch`. Two sharp edges: `streamText` is `Stream.empty` (streaming to the browser comes from the agent loop, not from token streaming), and `toolParameters` in `gemini.ts` hardcodes JSON schemas per tool name with a numeric `a`/`b` fallback — new tools need a case there.

### Request flow

Typed REST endpoints go through `HttpApiBuilder` + `handlers.ts`. Chat is the exception: `POST /api/tutor/chat/stream` is a manual `HttpRouter` route emitting **NDJSON** (`{type:"message"|"done"}`), consumed by an async generator in `web/src/domain/tutor/stream.ts`; `web/src/domain/tutor/invalidation.ts` re-fetches artifact/material atoms when tool results arrive. Docs at `/docs` (Scalar) and `/openapi.json`.

### Vite proxy gotcha

`vite.config.ts` sets `root: "src"`, so any directory named `src/api/` would be served as a static path and shadow the dev proxy — that is why the client lives in `packages/web/src/api-client/` and the proxy rule is the regex `"^/api(?:/|$)"` targeting `PROXUS_API_URL`. Do not create `packages/web/src/api/`. In the browser the API base URL is just `location.origin`, so all traffic relies on that proxy in dev.

### Persistence

Plain JSON/PDF files under `packages/server/.data/` (`materials/pdfs/`, `artifacts/`, `attempts/`, `agent-sessions/`), gitignored, no DB and none wanted (`CHALLENGE.md` explicitly rules out adding auth or a database as the headline improvement). PDFs are turned into page images by `PopplerPdfService` shelling out to `pdftoppm` so Gemini can read them as inline image parts.

## Conventions (from AGENTS.md)

- Keep HTTP contracts in `packages/shared`; avoid duplicating them.
- Prefer Effect platform services (`FileSystem`, `Path`, `ChildProcessSpawner`) at infra boundaries; native `fetch`/`WebSocket`/Node APIs are fine where appropriate.
- Server HTTP is composed with Effect HTTP API + `@effect/platform-node`.
- Tailwind v4 is wired as a Vite plugin (`@tailwindcss/vite`); edit `packages/web/src/styles.input.css`, which `main.tsx` imports directly. No generated CSS file, no separate watcher.
- Avoid introducing new frameworks without a strong reason; keep persistence local and simple.
- Fail fast at startup on missing config (API key, Poppler) is intentional behavior.
