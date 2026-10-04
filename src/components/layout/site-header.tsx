import Link from "next/link";
import { Badge, Container } from "@/components/ui";
import { siteConfig } from "@/config/site";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-line bg-surface/85 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md text-base font-semibold tracking-tight"
        >
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-md bg-brand text-sm font-bold text-brand-ink"
          >
            O
          </span>
          {siteConfig.name}
        </Link>

        <Badge variant="outline">Foundation</Badge>
      </Container>
    </header>
  );
}
