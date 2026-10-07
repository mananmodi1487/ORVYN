"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui";
import {
  conversationMenuCopy,
  MAX_CONVERSATION_TITLE_LENGTH,
} from "@/config/workspace";
import { cn } from "@/lib/utils";
import { MoreIcon } from "./icons";

const MENU_ITEM_SELECTOR = '[role="menuitem"]';

export type ConversationRowProps = {
  readonly id: string;
  readonly title: string;
  readonly active: boolean;
  readonly collapsed: boolean;
  readonly onSelect: (id: string) => void;
  /** Warms the conversation cache without navigating. */
  readonly onPrefetch?: ((id: string) => void) | undefined;
  /** Saves a new title; resolves with an error message, or `null` on success. */
  readonly onRename: (title: string) => Promise<string | null>;
  /** Deletes the conversation; resolves with an error message, or `null` on success. */
  readonly onDelete: () => Promise<string | null>;
};

/**
 * One conversation in the sidebar, with its context menu.
 *
 * The row is the conversation's select button plus a
 * trigger for a small menu — Rename and Delete. Rename
 * edits the title in place: Enter saves, Escape cancels,
 * and clicking away cancels too. Delete asks for
 * confirmation before the destructive call. Both actions
 * report failures inline, and nothing here reloads the
 * page: the sidebar state this row lives in is updated
 * by the caller on success, which unmounts the row.
 */
export function ConversationRow({
  id,
  title,
  active,
  collapsed,
  onSelect,
  onPrefetch,
  onRename,
  onDelete,
}: ConversationRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  /** Whether the previous render was an in-place rename. */
  const wasRenaming = useRef(false);

  const label = title || "New conversation";

  // Clicking anywhere outside the row closes the menu
  // and cancels an in-progress rename — the pointer's
  // equivalent of Escape.
  useEffect(() => {
    if (!menuOpen && !renaming) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setMenuOpen(false);
        setRenaming(false);
        setConfirmingDelete(false);
        setDraft(title);
        setError(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen, renaming, title]);

  // The menu takes focus as soon as it opens, and
  // Escape or the arrow keys move through it — the
  // same contract the composer's mode menu holds.
  useEffect(() => {
    if (!menuOpen || renaming || confirmingDelete) return;
    rootRef.current
      ?.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR)
      .item(0)
      ?.focus();
  }, [menuOpen, renaming, confirmingDelete]);

  // Confirmation starts with its safe action focused.
  useEffect(() => {
    if (!confirmingDelete) return;
    confirmRef.current
      ?.querySelectorAll<HTMLButtonElement>("button")
      .item(0)
      ?.focus();
  }, [confirmingDelete]);

  // Returning from an in-place rename puts focus
  // back on the trigger that opened it.
  useEffect(() => {
    if (wasRenaming.current && !renaming) {
      triggerRef.current?.focus();
    }
    wasRenaming.current = renaming;
  }, [renaming]);

  const closeAndRefocus = () => {
    setMenuOpen(false);
    setConfirmingDelete(false);
    setError(null);
    triggerRef.current?.focus();
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRefocus();
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    event.preventDefault();
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR) ?? [],
    );
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + offset + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const openRename = () => {
    setDraft(title);
    setError(null);
    setMenuOpen(false);
    setConfirmingDelete(false);
    setRenaming(true);
  };

  const saveRename = async () => {
    if (pending) return;
    setPending(true);
    const failure = await onRename(draft.trim());
    setPending(false);
    if (failure === null) {
      setRenaming(false);
      setError(null);
    } else {
      // Stay in place: the user can correct the title
      // and save again.
      setError(failure);
    }
  };

  const cancelRename = () => {
    setRenaming(false);
    setDraft(title);
    setError(null);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveRename();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  };

  const confirmDelete = async () => {
    if (pending) return;
    setPending(true);
    const failure = await onDelete();
    setPending(false);
    if (failure === null) {
      // The caller removes the conversation from the
      // list, which unmounts this row.
      setMenuOpen(false);
      setConfirmingDelete(false);
      setError(null);
    } else {
      setError(failure);
    }
  };

  return (
    <div ref={rootRef} className="group">
      {renaming ? (
        <div className="flex flex-col gap-1 py-0.5">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            maxLength={MAX_CONVERSATION_TITLE_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onInputKeyDown}
            disabled={pending}
            aria-label={conversationMenuCopy.renamePlaceholder}
            placeholder={conversationMenuCopy.renamePlaceholder}
            className="w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-[13px] text-ink outline-none transition-colors duration-150 focus:border-line-strong"
          />
          {error !== null ? (
            <p role="alert" className="px-2 text-[11px] text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div
          className={cn(
            "flex w-full items-center rounded-md transition-colors duration-150",
            active ? "bg-hover text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
            collapsed && "lg:justify-center",
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(id)}
            onMouseEnter={() => onPrefetch?.(id)}
            onFocus={() => onPrefetch?.(id)}
            className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[13px]"
            title={label}
          >
            {label}
          </button>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => {
              setMenuOpen((previous) => !previous);
              setConfirmingDelete(false);
              setError(null);
            }}
            onMouseEnter={() => onPrefetch?.(id)}
            onFocus={() => onPrefetch?.(id)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={conversationMenuCopy.triggerLabel}
            title={conversationMenuCopy.triggerLabel}
            className={cn(
              "shrink-0 px-1.5 py-1.5 text-ink-subtle opacity-0 transition-opacity duration-150",
              "focus-visible:opacity-100 group-hover:opacity-100 group-hover:text-ink",
              menuOpen && "opacity-100",
              collapsed && "lg:hidden",
            )}
          >
            <MoreIcon className="size-3.5" />
          </button>
        </div>
      )}

      {menuOpen && !renaming
        ? confirmingDelete
          ? (
            <div
              ref={confirmRef}
              role="group"
              aria-label={conversationMenuCopy.confirmDeleteTitle}
              onKeyDown={onPanelKeyDown}
              className="mt-0.5 flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-2.5 shadow-xl shadow-black/60"
            >
              <p className="text-[13px] font-medium text-ink">
                {conversationMenuCopy.confirmDeleteTitle}
              </p>
              <p className="text-[11px] leading-relaxed text-ink-subtle">
                {conversationMenuCopy.confirmDeleteDescription}
              </p>
              <div className="mt-1 flex justify-end gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={closeAndRefocus}
                  disabled={pending}
                >
                  {conversationMenuCopy.cancel}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void confirmDelete()}
                  disabled={pending}
                >
                  {conversationMenuCopy.confirmDelete}
                </Button>
              </div>
              {error !== null ? (
                <p role="alert" className="text-[11px] text-danger">
                  {error}
                </p>
              ) : null}
            </div>
          )
          : (
            <div
              role="menu"
              aria-label={conversationMenuCopy.triggerLabel}
              onKeyDown={onPanelKeyDown}
              className="mt-0.5 flex flex-col rounded-lg border border-line bg-surface-raised p-1 shadow-xl shadow-black/60"
            >
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={openRename}
                className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-[13px] text-ink transition-colors duration-150 hover:bg-hover"
              >
                {conversationMenuCopy.rename}
              </button>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  setConfirmingDelete(true);
                  setError(null);
                }}
                className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-[13px] text-ink transition-colors duration-150 hover:bg-hover"
              >
                {conversationMenuCopy.delete}
              </button>
            </div>
          )
        : null}
    </div>
  );
}
