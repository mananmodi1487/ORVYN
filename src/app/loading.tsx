import { Container } from "@/components/ui";

export default function Loading() {
  return (
    <Container className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <div className="size-14 animate-pulse rounded-2xl bg-surface-raised" />
      <div className="h-8 w-56 animate-pulse rounded-md bg-surface-raised" />
      <span className="sr-only">Loading ORVYN…</span>
    </Container>
  );
}