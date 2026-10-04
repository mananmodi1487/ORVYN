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
    <Container className="flex flex-col items-start gap-4 py-24">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="max-w-xl text-sm text-ink-muted">
        The application hit an unexpected error. Try again — if it persists, check the server logs.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-ink-muted">digest: {error.digest}</p>
      ) : null}
      <Button onClick={reset}>Try again</Button>
    </Container>
  );
}
