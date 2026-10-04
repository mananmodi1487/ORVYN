import { Container } from "@/components/ui";
import { siteConfig } from "@/config/site";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-line py-10">
      <Container className="flex flex-col gap-2 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          &copy; {year} {siteConfig.name}. All rights reserved.
        </p>
        <p className="font-mono text-xs">Next.js App Router &middot; strict TypeScript</p>
      </Container>
    </footer>
  );
}
