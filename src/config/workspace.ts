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

/**
 * The signed-out state.
 *
 * The signed-in account is read from the session, never from here — a static
 * config value would be a second, competing source of truth for who is using the
 * product.
 */
export const signedOutState = {
  title: "Sign in",
  description: "Sign in to start a conversation.",
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
 * The longest title a conversation may carry, whether the
 * automatic title or a user rename set it. The rename
 * endpoint validates against it, and the menu's invalid-title
 * wording derives from it, so the copy and the server's
 * validation can never disagree.
 */
export const MAX_CONVERSATION_TITLE_LENGTH = 120;

/**
 * Copy for a conversation's context menu — the sidebar's
 * per-conversation actions. Failure messages map from the
 * API's stable error codes, never from message text.
 */
export const conversationMenuCopy = {
  triggerLabel: "Conversation actions",
  rename: "Rename",
  delete: "Delete",
  renamePlaceholder: "Rename conversation",
  confirmDeleteTitle: "Delete this conversation?",
  confirmDeleteDescription:
    "Its messages are deleted with it. This cannot be undone.",
  confirmDelete: "Delete",
  cancel: "Cancel",
  invalidTitle: `Titles run 1 to ${MAX_CONVERSATION_TITLE_LENGTH} characters.`,
  unauthenticated: "Sign in to manage conversations.",
  notFound: "The conversation no longer exists.",
  renameFailed: "Could not rename the conversation.",
  deleteFailed: "Could not delete the conversation.",
  unexpected: "Something went wrong. Try again.",
} as const;

/**
 * Maps a conversation action's failure code — the stable
 * codes the API's error contract defines — to what the user
 * sees. Unknown codes fall back to a plain retry message
 * rather than echoing server prose.
 */
export function conversationActionErrorMessage(code: string): string {
  switch (code) {
    case "invalid_request":
    case "invalid_title":
      return conversationMenuCopy.invalidTitle;
    case "unauthenticated":
      return conversationMenuCopy.unauthenticated;
    case "not_found":
      return conversationMenuCopy.notFound;
    case "failed_to_update":
    case "failed_to_rename":
      return conversationMenuCopy.renameFailed;
    case "failed_to_delete":
      return conversationMenuCopy.deleteFailed;
    default:
      return conversationMenuCopy.unexpected;
  }
}

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

/**
 * Copy actions for responses and code blocks. The clipboard
 * holds the response's Markdown source — the complete answer
 * as the assistant wrote it, with no usage figures, provider
 * names or UI labels mixed in.
 */
export const responseCopy = {
  copyResponse: "Copy response",
  copied: "Copied",
  copyCode: "Copy",
  copiedCode: "Copied",
  codeFallbackLabel: "code",
} as const;
