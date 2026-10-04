import Link from "next/link";
import { Container, buttonVariants } from "@/components/ui";

export default function NotFound() {
  return (
    <Container className="flex min-h-dvh flex-col items-start justify-center gap-4 py-24">
      <p className="font-mono text-sm text-ink-subtle">404</p>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">This page does not exist</h1>
      <p className="max-w-xl text-sm text-ink-muted">
        The page you were looking for is not part of ORVYN yet.
      </p>
      <Link href="/" className={buttonVariants({ variant: "primary" })}>
        Back to workspace
      </Link>
    </Container>
  );
}