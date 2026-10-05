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
  lib/            pure helpers (`cn()`) and framework-light hooks
  proxy.ts        Next.js 16 request entry — NOT middleware.ts
```

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
npm run check     # lint + typecheck + production build
```

