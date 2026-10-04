import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names and resolve conflicting Tailwind utilities so
 * the last-specified value wins. Use this for every `className` that callers
 * are allowed to extend.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
