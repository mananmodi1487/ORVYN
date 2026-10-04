# ORVYN

Production-ready **Next.js 16** application foundation — strict TypeScript, the App Router, a
token-driven Tailwind CSS v4 theme, ESLint 9 flat config and a small set of reusable primitives.

> **Status: foundation only.**
> This repository intentionally contains **no** AI integrations, database layer, authentication,
> mock AI behaviour or application routing logic. Those are layered on later, on top of this base.

---

## Requirements

| Tool     | Version                            |
| -------- | ---------------------------------- |
| Node.js  | `>= 20.9.0` (validated on 24.21.0) |
| npm      | `>= 10` (validated on 11.19.0)     |
| Git      | any                                |

Versions below were verified end to end on this machine:

| Package          | Version |
| ---------------- | ------- |
| next             | 16.3.8  |
| react / react-dom| 19.2.8  |
| typescript       | 5.9.3   |
| tailwindcss      | 4.3.3   |
| eslint           | 9.39.5  |

## Getting started

```bash
npm install     # install dependencies
npm run dev     # http://localhost:3000
```

## Scripts

| Script              | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `npm run dev`       | Start the Turbopack dev server                            |
| `npm run build`     | Production build (fails on lint or type errors)           |
| `npm start`         | Serve the production build                                |
| `npm run lint`      | ESLint (flat config, `next/core-web-vitals` + TypeScript) |
| `npm run lint:fix`  | ESLint with `--fix`                                       |
| `npm run typegen`   | Regenerate App Router route types                         |
| `npm run typecheck` | `next typegen` then `tsc --noEmit`                        |
| `npm run check`     | **Full gate:** lint → typecheck → production build        |
| `npm run clean`     | Delete the `.next` build cache                           |

`npm run check` is the single command CI should run. `typecheck` runs `next typegen` first so the
generated route types are present on a fresh clone, where `.next/` does not exist yet.

## Architecture

```
orvyn/
├── public/                  static assets
├── src/
│   ├── app/                 routes, layouts, boundaries, global CSS
│   │   ├── globals.css      Tailwind entry + design tokens
│   │   ├── layout.tsx       root layout: metadata, fonts, chrome
│   │   ├── page.tsx         the single route (/)
│   │   ├── loading.tsx      route loading boundary
│   │   ├── error.tsx        route error boundary (client)
│   │   ├── not-found.tsx    404 boundary
│   │   └── icon.svg         app icon → favicon
│   ├── components/
│   │   ├── layout/          SiteHeader, SiteFooter — app chrome
│   │   └── ui/              Button, Badge, Card, Container — no app knowledge
│   ├── config/              static, typed, environment-free config
│   └── lib/                 pure helpers (`cn()`)
├── .editorconfig            shared formatting rules
├── .env.example             tracked template; real secrets live in .env.local
├── .gitattributes           LF normalisation, binary asset guards
├── AGENTS.md                conventions for AI coding agents
├── eslint.config.mjs        ESLint 9 flat config
├── next.config.ts           typedRoutes, strict mode, no x-powered-by
├── postcss.config.mjs       @tailwindcss/postcss
└── tsconfig.json            strict TypeScript
```

### Layering rules

1. `app/` may import from `components/`, `config/` and `lib/`.
2. `components/ui/` must not import from `app/`, `components/layout/` or `config/site`.
3. `lib/` and `config/` must not import React or Next.js.
4. Cross-module imports use the `@/*` alias, never deep relative traversal.

## TypeScript

Strict mode plus these additional guarantees:

- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noImplicitOverride`, `noImplicitReturns`
- `noFallthroughCasesInSwitch`
- `noUnusedLocals`, `noUnusedParameters`
- `verbatimModuleSyntax` (type-only imports must use `import type`)
- `forceConsistentCasingInFileNames`

Do not relax these to make an error go away — fix the code.

## Styling

Tailwind CSS v4 uses a **CSS-first** theme: no `tailwind.config.js`. Semantic tokens live in
`src/app/globals.css` and map into Tailwind's namespace via `@theme inline`:

| Token         | Utility                  |
| ------------- | ------------------------ |
| `--surface`   | `bg-surface`             |
| `--ink`       | `text-ink`               |
| `--ink-muted` | `text-ink-muted`         |
| `--line`      | `border-line`            |
| `--brand`     | `bg-brand` / `text-brand` |
| `--danger`    | `bg-danger`              |

Dark mode follows the OS through `prefers-color-scheme`, so there is no JavaScript and no flash of
the wrong theme. Adding a manual toggle later only requires a `@custom-variant` line.

Any `className` a caller can extend is merged with `cn()` from `@/lib/utils` (clsx +
tailwind-merge), so callers can override variants safely.

## Environment variables

None are required to run, build, lint or typecheck. `.env.example` is tracked; `.env.local` and all
other `.env*` files are gitignored. Set `NEXT_PUBLIC_SITE_URL` to override the `metadataBase` used
for absolute URLs.

## Git

The tree is git-ready: `.gitignore`, `.gitattributes` (LF normalisation on Windows) and
`.editorconfig` are in place, and `package-lock.json` is committed for reproducible installs.

```bash
git init
git add .
git commit -m "chore: establish ORVYN project foundation"
```

## Dependency notes

Three decisions are deliberate. Each was tested, not assumed.

### 1. ESLint is pinned to 9.x

npm reports `eslint@9.39.5` as deprecated because it sits on the `maintenance` dist-tag — ESLint 10
is out. **Do not upgrade it.** `eslint-config-next@16.3.8` bundles `eslint-plugin-react`, which calls
`context.getFilename()`; ESLint 10 removed that API and linting crashes immediately:

```
TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function
```

`eslint-config-next` advertises `eslint: ">=9.0.0"`, but that range is too loose in practice. Revisit
once Next ships a release that supports ESLint 10.

### 2. `allowScripts` denies `unrs-resolver`

`unrs-resolver` (transitive, ESLint resolver) ships a `postinstall` script. ESLint works correctly
without it — it falls back to a pure-JS resolver — so the script is explicitly **denied** in
`package.json` rather than blindly approved. That keeps installs deterministic and avoids running an
install script that the project does not need.

### 3. The 5 high-severity advisories are dev-only

`npm audit --omit=dev` reports **0 vulnerabilities** — nothing advisory ships to production. The 5
high-severity findings come from `braces`, reached through ESLint's dependency graph. The only
offered remediation downgrades `eslint-config-next` to v14, a breaking change for a Next 16 app, so it
is intentionally **not** applied. Re-check when `braces` publishes a patched release.