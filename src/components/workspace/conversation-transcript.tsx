"use client";

import { useEffect, useRef } from "react";
import { responseCopy, usageCopy } from "@/config/workspace";
import type { ChatStreamError, ChatUsage } from "@/lib/ai/chat-protocol";
import type { ConversationTurn } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { AlertIcon } from "./icons";
import { CopyButton } from "./copy-button";
import { MessageMarkdown } from "./message-markdown";
import { UsageMeta } from "./usage-meta";

export type ConversationTranscriptProps = {
  readonly turns: readonly ConversationTurn[];
  readonly isStreaming: boolean;
  readonly error: ChatStreamError | null;
  /** Running total across every response that reported usage. */
  readonly conversationUsage: ChatUsage | null;
};

/**
 * Renders the conversation and keeps the newest turn in view.
 *
 * The scroll is driven from an effect rather than a ref callback so it runs once
 * per render with the current content, instead of firing during commit and
 * forcing a second layout pass.
 */
export function ConversationTranscript({
  turns,
  isStreaming,
  error,
  conversationUsage,
}: ConversationTranscriptProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  return (
    <section
      aria-label="Conversation"
      aria-busy={isStreaming}
      className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-8 sm:px-8 sm:py-12"
    >
      {turns.map((turn, index) => {
        const isLast = index === turns.length - 1;
        const pending = isLast && turn.role === "assistant" && turn.text === "";
        if (pending) return <PendingAnswer key={turn.id} />;

        return (
          <Turn
            key={turn.id}
            turn={turn}
            streaming={isLast && isStreaming}
          />
        );
      })}

      {error !== null ? <FailureNotice error={error} /> : null}

      {conversationUsage !== null ? (
        <footer className="border-t border-line pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] font-medium tracking-[0.08em] text-ink-subtle uppercase">
              {usageCopy.conversation}
            </p>
            <UsageMeta usage={conversationUsage} />
          </div>
        </footer>
      ) : null}

      <div ref={endRef} />
    </section>
  );
}

function Turn({
  turn,
  streaming,
}: {
  readonly turn: ConversationTurn;
  readonly streaming: boolean;
}) {
  const isUser = turn.role === "user";
  return (
    <article
      className={cn("flex flex-col", isUser ? "items-end" : "items-start")}
      aria-label={isUser ? "Your message" : "ORVYN reply"}
    >
      {isUser ? (
        <div className="max-w-[85%] rounded-xl bg-surface-raised px-4 py-2.5 text-[15px] leading-7 whitespace-pre-wrap break-words text-ink">
          {turn.text}
        </div>
      ) : (
        <>
          <div className="min-w-0 max-w-[85%] break-words text-[15px] leading-7 text-ink">
            <MessageMarkdown text={turn.text} streaming={streaming} />
          </div>
          {/* Provenance, the response's own copy action and
              cost sit below the answer, quiet by design: they
              are reference material, not part of the
              conversation. The provider and model are internal
              routing details, so only ORVYN is named here. The
              clipboard receives the Markdown source — the
              complete answer as written, with none of the
              metadata below it. */}
          {!streaming ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5">
              <p className="text-[11px] text-ink-subtle">ORVYN</p>
              <UsageMeta usage={turn.usage ?? null} />
              <CopyButton
                text={turn.text}
                label={responseCopy.copyResponse}
                copiedLabel={responseCopy.copied}
              />
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}

function PendingAnswer() {
  return (
    <div className="flex flex-col gap-2" aria-label="ORVYN is replying">
      <p className="text-[11px] tracking-wide text-ink-subtle">ORVYN</p>
      <div className="flex items-center gap-1.5 py-1">
        <span className="sr-only">ORVYN is replying</span>
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            aria-hidden="true"
            className="size-1 animate-pulse rounded-full bg-ink-subtle"
            style={{ animationDelay: `${dot * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function FailureNotice({ error }: { readonly error: ChatStreamError }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-danger/40 bg-danger/8 px-4 py-3 text-sm text-danger-ink"
    >
      <div className="flex items-start gap-2.5">
        <AlertIcon className="mt-0.5 size-3.5 shrink-0 text-danger" />
        <div className="min-w-0">
          <p className="text-danger">{error.message}</p>
          {error.detail !== null ? (
            <p className="mt-1 font-mono text-[11px] break-words text-danger/80">{error.detail}</p>
          ) : null}
          {error.retryable ? (
            <p className="mt-1 text-[11px] text-danger/80">You can try again.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}