"use client";

import { useEffect, useRef } from "react";
import { usageCopy } from "@/config/workspace";
import type { ChatStreamError, ChatStreamMeta, ChatUsage } from "@/lib/ai/chat-protocol";
import type { ConversationTurn } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { AlertIcon } from "./icons";
import { UsageMeta } from "./usage-meta";

export type ConversationTranscriptProps = {
  readonly turns: readonly ConversationTurn[];
  readonly isStreaming: boolean;
  readonly error: ChatStreamError | null;
  readonly activeModel: ChatStreamMeta | null;
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
  activeModel,
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
        if (pending) return <PendingAnswer key={turn.id} model={activeModel} />;

        return (
          <Turn
            key={turn.id}
            turn={turn}
            model={turn.role === "assistant" ? activeModel : null}
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
  model,
  streaming,
}: {
  readonly turn: ConversationTurn;
  readonly model: ChatStreamMeta | null;
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
          <div className="max-w-[85%] text-[15px] leading-7 whitespace-pre-wrap break-words text-ink">
            {turn.text}
            {streaming ? (
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-ink-subtle"
              />
            ) : null}
          </div>
          {/* Provenance and cost sit below the answer, quiet by design: they are
              reference material, not part of the conversation. */}
          {streaming || model === null ? null : (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5">
              <p className="text-[11px] text-ink-subtle">
                {model.displayName}
                <span aria-hidden="true"> · </span>
                <span className="text-ink-subtle/80">{model.provider}</span>
              </p>
              <UsageMeta usage={turn.usage ?? null} />
            </div>
          )}
        </>
      )}
    </article>
  );
}

function PendingAnswer({ model }: { readonly model: ChatStreamMeta | null }) {
  return (
    <div className="flex flex-col gap-2" aria-label="ORVYN is replying">
      {model !== null ? (
        <p className="text-[11px] tracking-wide text-ink-subtle">{model.displayName}</p>
      ) : null}
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