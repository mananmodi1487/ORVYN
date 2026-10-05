<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ORVYN conventions

## Layout

```
src/
  app/            routes, root layout, loading / error / not-found boundaries, global CSS
  components/
    ui/           design-system primitives (Button, Badge, Card, Container, Kbd)
    workspace/    the product shell — stateful, owns sidebar / mode / draft
  config/         static, typed, environment-free configuration
  utils/supabase/ Supabase clients (browser / server), env access, updateSession
  lib/            pure helpers (`cn()`), framework-light hooks, and `lib/ai/` (see below)
  proxy.ts        Next.js 16 request entry — NOT middleware.ts
```

## AI provider layer (`src/lib/ai/`)

Server-only. It owns model discovery, health, eligibility, and routing for every
AI provider, so a new provider is an adapter plus a declaration — never a change
to routing logic.

- `types.ts` → `errors.ts` → `capabilities.ts` → `eligibility.ts` → `router.ts` →
  `gateway.ts`. Dependencies point one way; nothing imports `gateway.ts` except
  composition code.
- Credentials come from `OMNIROUTE_*` and `FREE_LLM_API_*`. Never prefix them
  with `NEXT_PUBLIC_`. `assertServerOnly()` is a runtime guard, not a build one —
  `server-only` is not installed.
- **A provider missing credentials is `configured: false`, never "down", and is
  never contacted.** `AiGateway.health()` and `catalog()` enforce this centrally;
  do not rely on a provider implementation to remember it.
- Model capabilities, pricing, and context limits come from operator
  `ModelDeclaration`s, never from parsing a model id. An undeclared model reports
  `availability: "unknown"`, `enabled: false`, and is ineligible. Do not guess.
- Eligibility fails closed: unknown availability and unpriced models are never
  routed to, and an unknown latency is not treated as fast.
- Routing is deterministic. Ties break on `provider` then `modelId`; if a new
  strategy is added it must be order-independent and independently tested.
- Errors are `AiProviderError` with a `code` from `AI_ERROR_CODES`. Callers branch
  on `code`, never on message text. Nothing else may cross the provider boundary.
- New providers: implement `AiProvider`, or reuse
  `createOpenAiCompatibleProvider` for OpenAI-shaped APIs, and register
  explicitly in `providers/index.ts`. Nothing self-registers on import.

### Model declarations (`src/lib/ai/declaration-*.ts`)

Declarations are the *only* way a discovered model becomes routable. A provider's
`/models` response carries no capabilities, price, or context limits, and those
must never be inferred from a model id.

- Source of truth is `ai.models.json` (`{"models": []}` by default — no model is
  routable until an operator opts it in) or `ORVYN_AI_DECLARATIONS_PATH` /
  `ORVYN_AI_DECLARATIONS_JSON`. Both are read server-side only.
- Declarations are **provider-qualified**: `provider` + `modelId` together. The
  same id on two providers is two declarations.
- `declaration-schema.ts` is the only gate between untrusted JSON and the typed
  `ModelDeclaration`. It is strict on purpose: unknown keys, wrong types,
  unrecognised enums, and contradictions are **errors**, never dropped. A
  silently-ignored `"inputModalites"` typo would leave a model looking
  text-capable when the operator said otherwise.
- **Fail closed.** An omitted field stays unknown; it is never filled with a
  plausible default. Undeclared model → `availability: "unknown"` → ineligible.
- `enabled: true` is rejected alongside `availability: "unavailable" | "retired"`;
  a model that cannot serve traffic must stay switched off.
- `priority` is a router **tiebreak only**, applied after the strategy score and
  before the `provider`/`modelId` tiebreak. It can never promote a model that
  eligibility rejected.
- Issue messages name fields and enums, never values, so an operator can log
  `summary` without leaking a nearby key.

## Supabase rules

- Never read the secret / service-role key in application code, and never give it
  a `NEXT_PUBLIC_` prefix; that inlines it into the browser bundle.
- Use `@/utils/supabase/client` in Client Components, `@/utils/supabase/server` in
  Server Components / Actions / Route Handlers. Never call the browser client
  during server rendering.
- Session refresh lives in `updateSession()` only. It is the sole layer that can
  write cookies *and* the cache-control headers Supabase sends alongside them.
- Keep `setAll` handling both parameters — dropping the `headers` argument
  type-checks but leaks session tokens through CDN caches.

## Rules

- Import across the app with the `@/*` alias; never deep relative traversal.
- Components are React Server Components by default. Add `"use client"` only when
  state, effects, refs or browser APIs are genuinely required. Everything in
  `components/workspace/` is a client component; `app/` and `components/ui/` are not.
- `components/ui/` must stay free of product knowledge and must not import `app/`
  or `components/workspace/`.
- `config/` must not import React or Next.js. Icons belong to the component layer.
- Style with Tailwind utilities and the semantic tokens in `src/app/globals.css`
  (`bg-canvas`, `text-ink`, `border-line`, `text-accent`, …). Do not hardcode colours.
- The palette is **dark-first** and dark-only; there is no `prefers-color-scheme`
  branch to keep in sync.
- Use `cn()` from `@/lib/utils` for any `className` callers can extend.
- Never simulate behaviour that does not exist yet. No mock AI replies, no fake
  conversation data, no placeholder accounts. Unwired actions state so in the UI.
- TypeScript is strict *and* `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` are on.
  Do not weaken them; fix the code instead.
- Never commit secrets. `.env.local` is gitignored, `.env.example` is tracked.

## Verify before you finish

```bash
npm run check     # lint + typecheck + unit tests + production build
```

Tests use Node's built-in runner through `tsx` (there is no test framework
dependency). `npm run test:ai` runs just the AI layer.

