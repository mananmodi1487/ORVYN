<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ORVYN conventions

## Layout

```
src/
  app/            routes, layouts, loading / error / not-found boundaries, global CSS
  components/
    ui/           reusable primitives (Button, Badge, Card, Container) — no app knowledge
    layout/       app chrome (SiteHeader, SiteFooter) composed by the root layout
  config/         static, typed, environment-free configuration
  lib/            pure helpers; no React or Next.js coupling
```

## Rules

- Import across the app with the `@/*` alias; never deep relative traversal.
- Components are React Server Components by default. Add `"use client"` only when
  state, effects, refs or browser APIs are genuinely required.
- Style with Tailwind utilities and the semantic tokens in `src/app/globals.css`
  (`bg-surface`, `text-ink`, `border-line`, `bg-brand`, …). Do not hardcode colours.
- Use `cn()` from `@/lib/utils` for any `className` callers can extend.
- TypeScript is strict *and* `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` are on.
  Do not weaken them; fix the code instead.
- Never commit secrets. `.env.local` is gitignored, `.env.example` is tracked.

## Verify before you finish

```bash
npm run check     # lint + typecheck + production build
```

