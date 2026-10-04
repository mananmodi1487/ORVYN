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
      className="flex min-h-full flex-col items-center justify-center gap-9 px-4 py-14 text-center sm:py-20"
    >
      <BrandMark className="size-14 text-accent" />

      <div className="flex flex-col gap-3">
        <h1
          id="orvyn-welcome-heading"
          className="text-3xl font-semibold tracking-tight text-balance text-ink sm:text-4xl"
        >
          {brand.greeting}
        </h1>
        <p className="text-base text-ink-muted">{brand.tagline}</p>
      </div>

      <ul className="grid w-full max-w-3xl gap-3 sm:grid-cols-3">
        {welcomeSuggestions.map((suggestion) => (
          <li key={suggestion.id} className="flex">
            <SuggestionCard suggestion={suggestion} onSelect={onSelectPrompt} />
          </li>
        ))}
      </ul>
    </section>
  );
}