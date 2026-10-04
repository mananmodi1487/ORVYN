import { Container } from "@/components/ui";

export default function Loading() {
  return (
    <Container className="py-24">
      <div
        role="status"
        aria-live="polite"
        className="h-8 w-48 animate-pulse rounded-md bg-brand-muted"
      />
      <span className="sr-only">Loading…</span>
    </Container>
  );
}
