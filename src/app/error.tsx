"use client";

import { Button, Container } from "@/components/ui";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Container className="flex min-h-dvh flex-col items-start justify-center gap-4 py-24">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Something went wrong</h1>
      <p className="max-w-xl text-sm text-ink-muted">
        ORVYN hit an unexpected error. Try again — if it persists, check the server logs.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-ink-subtle">digest: {error.digest}</p>
      ) : null}
      <Button variant="primary" onClick={reset}>
        Try again
      </Button>
    </Container>
  );
}