import Link from "next/link";
import { Container, buttonVariants } from "@/components/ui";

export default function NotFound() {
  return (
    <Container className="flex flex-col items-start gap-4 py-24">
      <p className="font-mono text-sm text-ink-muted">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page does not exist</h1>
      <p className="max-w-xl text-sm text-ink-muted">
        The page you were looking for is not part of the ORVYN foundation.
      </p>
      <Link href="/" className={buttonVariants({ variant: "outline", size: "md" })}>
        Back to home
      </Link>
    </Container>
  );
}
