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
    <Card className="w-full transition-colors duration-150 hover:border-line-strong hover:bg-surface">
      <button
        type="button"
        onClick={() => onSelect(suggestion.prompt)}
        className={cn(
          "group flex w-full flex-col items-start gap-4 rounded-lg p-4 text-left",
          "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2",
          "focus-visible:outline-ink",
        )}
      >
        <Icon className="size-4 text-ink-subtle transition-colors duration-150 group-hover:text-ink" />
        <span className="flex flex-col gap-1">
          <span className="text-[13px] font-medium text-ink">{suggestion.title}</span>
          <span className="text-xs leading-relaxed text-ink-subtle">{suggestion.description}</span>
        </span>
      </button>
    </Card>
  );
}