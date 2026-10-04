"use client";

import type { ComponentType } from "react";
import { Card } from "@/components/ui";
import type { SuggestionId, WelcomeSuggestion } from "@/config/workspace";
import { cn } from "@/lib/utils";
import { CompassIcon, LayersIcon, LightbulbIcon, type IconProps } from "./icons";

const suggestionIcons: Readonly<Record<SuggestionId, ComponentType<IconProps>>> = {
  think: LightbulbIcon,
  build: LayersIcon,
  explore: CompassIcon,
};

export type SuggestionCardProps = {
  suggestion: WelcomeSuggestion;
  onSelect: (prompt: string) => void;
};

export function SuggestionCard({ suggestion, onSelect }: SuggestionCardProps) {
  const Icon = suggestionIcons[suggestion.id];

  return (
    <Card className="w-full transition-colors duration-150 hover:border-line-strong has-[:focus-visible]:border-accent/50">
      <button
        type="button"
        onClick={() => onSelect(suggestion.prompt)}
        className={cn(
          "group flex w-full flex-col items-start gap-3 rounded-xl p-5 text-left",
          "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2",
          "focus-visible:outline-accent",
        )}
      >
        <span
          className={cn(
            "grid size-9 place-items-center rounded-lg border border-line text-accent",
            "transition-colors duration-150 group-hover:border-line-strong",
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-sm font-medium tracking-tight text-ink">{suggestion.title}</span>
          <span className="text-xs text-ink-subtle">{suggestion.description}</span>
        </span>
      </button>
    </Card>
  );
}