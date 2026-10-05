/**
 * Static, environment-free product configuration for the ORVYN workspace.
 * Contains no React and no Next.js references so it can be imported anywhere.
 */

export const brand = {
  name: "ORVYN",
  tagline: "One intelligence. Every capability.",
  greeting: "How can I help?",
} as const;

export type ResponseMode = "auto" | "fast" | "compare" | "private";

export type ResponseModeOption = {
  id: ResponseMode;
  label: string;
  hint: string;
};

export const responseModes: Readonly<Record<ResponseMode, ResponseModeOption>> = {
  auto: { id: "auto", label: "Auto", hint: "ORVYN decides how much depth is needed." },
  fast: { id: "fast", label: "Fast", hint: "Prioritise quick, direct answers." },
  compare: { id: "compare", label: "Compare", hint: "Lay out alternatives side by side." },
  private: { id: "private", label: "Private", hint: "Keep this session on your machine." },
};

/** Display order for the segmented control and the mode menu. */
export const responseModeOrder: readonly ResponseMode[] = ["auto", "fast", "compare", "private"];

export const defaultResponseMode: ResponseMode = "auto";

export function getResponseMode(id: ResponseMode): ResponseModeOption {
  return responseModes[id];
}

export type SuggestionId = "think" | "build" | "explore";

export const welcomeSuggestions: ReadonlyArray<{
  id: SuggestionId;
  title: string;
  description: string;
  prompt: string;
}> = [
  {
    id: "think",
    title: "Think through",
    description: "Untangle a decision or a stuck problem.",
    prompt: "Help me think through a decision I'm weighing: ",
  },
  {
    id: "build",
    title: "Build something",
    description: "Shape an idea into a plan you can act on.",
    prompt: "Help me build something. I want to create ",
  },
  {
    id: "explore",
    title: "Explore an idea",
    description: "Open up a direction and follow it further.",
    prompt: "I want to explore the idea that ",
  },
];

export type WelcomeSuggestion = (typeof welcomeSuggestions)[number];

export type SidebarNavId = "universe" | "settings";

export const sidebarNav: ReadonlyArray<{ id: SidebarNavId; label: string }> = [
  { id: "universe", label: "Model Universe" },
  { id: "settings", label: "Settings" },
];

export const conversationsSection = {
  label: "Conversations",
} as const;

export const account = {
  name: "Account",
  status: "Not signed in",
} as const;

export const missionView = {
  label: "Mission View",
  familyLabel: "Family",
  description: "Switch between personal and shared workspaces.",
} as const;

export const conversationEmptyState = {
  title: "No conversations yet",
  description: "Start one and it will appear here.",
} as const;

/**
 * Token-usage copy.
 *
 * `unavailable` is a first-class state, not a fallback: ORVYN reports what a
 * provider returned and says so plainly when a provider returned nothing. The
 * pool wording deliberately describes ORVYN's own budget rather than implying
 * upstream capacity exists.
 */
export const usageCopy = {
  input: "input",
  output: "output",
  total: "total",
  unavailable: "usage unavailable",
  conversation: "This conversation",
  today: "Your today",
  pool: "ORVYN free pool",
  poolNote: "ORVYN's monthly target. Not guaranteed upstream capacity.",
  unavailablePool: "Free-pool usage unavailable",
} as const;
