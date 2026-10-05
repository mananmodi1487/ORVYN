"use client";

import { brand, welcomeSuggestions } from "@/config/workspace";
import { BrandMark } from "./icons";
import { SuggestionCard } from "./suggestion-card";

export type WelcomePanelProps = {
  onSelectPrompt: (prompt: string) => void;
};

export function WelcomePanel({ onSelectPrompt }: WelcomePanelProps) {
  return (
    <section
      aria-labelledby="orvyn-welcome-heading"
      className="flex min-h-full flex-col items-center justify-center gap-12 px-5 py-16 sm:py-24"
    >
      <div className="flex flex-col items-center gap-5 text-center">
        <BrandMark className="size-7 text-ink-subtle" />

        <div className="flex flex-col gap-2.5">
          <h1
            id="orvyn-welcome-heading"
            className="text-[26px] leading-tight font-medium tracking-[-0.02em] text-balance text-ink sm:text-[30px]"
          >
            {brand.greeting}
          </h1>
          <p className="text-[15px] leading-relaxed text-ink-muted">{brand.tagline}</p>
        </div>
      </div>

      <ul className="grid w-full max-w-3xl gap-2.5 sm:grid-cols-3">
        {welcomeSuggestions.map((suggestion) => (
          <li key={suggestion.id} className="flex">
            <SuggestionCard suggestion={suggestion} onSelect={onSelectPrompt} />
          </li>
        ))}
      </ul>
    </section>
  );
}