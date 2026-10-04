import { Badge, Card, CardContent, CardHeader, CardTitle, Container, buttonVariants } from "@/components/ui";
import { siteConfig } from "@/config/site";

const stack = [
  { name: "Next.js", detail: "16.3.8 — App Router, Turbopack" },
  { name: "React", detail: "19.2.8 — Server Components by default" },
  { name: "TypeScript", detail: "5.9.3 — strict + noUncheckedIndexedAccess" },
  { name: "Tailwind CSS", detail: "4.3.3 — CSS-first token theme" },
  { name: "ESLint", detail: "9.39.5 — flat config, next/core-web-vitals" },
] as const;

const conventions = [
  "`src/app` — routes, layouts, loading, error and not-found boundaries.",
  "`src/components/ui` — framework-agnostic, server-component-first primitives.",
  "`src/components/layout` — app chrome composed in the root layout.",
  "`src/config` — static, typed, environment-free configuration.",
  "`src/lib` — pure helpers with no React or Next.js coupling.",
  "No AI, database or auth code yet — the foundation is intentionally inert.",
] as const;

export default function HomePage() {
  return (
    <>
      <section className="border-b border-line py-20 sm:py-28">
        <Container className="flex flex-col items-start gap-6">
          <Badge variant="solid">Foundation v0.1.0</Badge>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {siteConfig.name}
          </h1>
          <p className="max-w-2xl text-lg text-ink-muted text-pretty">
            A production-ready skeleton: strict TypeScript, the App Router, a token-driven Tailwind
            theme and a small set of reusable primitives. Nothing else yet — no AI APIs, no
            database, no authentication, no routing logic.
          </p>
          <a
            href="#architecture"
            className={buttonVariants({ variant: "outline", size: "md" })}
          >
            View the structure
          </a>
        </Container>
      </section>

      <section id="architecture" className="py-16 sm:py-20">
        <Container className="grid gap-10 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <h2 className="text-2xl font-semibold tracking-tight">Stack</h2>
            <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface-raised">
              {stack.map((item) => (
                <li key={item.name} className="flex flex-col gap-1 p-4 sm:flex-row sm:gap-4">
                  <span className="w-40 shrink-0 font-medium">{item.name}</span>
                  <span className="text-sm text-ink-muted">{item.detail}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-6">
            <h2 className="text-2xl font-semibold tracking-tight">Conventions</h2>
            <Card>
              <CardHeader>
                <CardTitle>Where things live</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-ink-muted">
                  {conventions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </Container>
      </section>
    </>
  );
}
