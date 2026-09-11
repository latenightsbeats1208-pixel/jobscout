import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const min = 60_000, hour = 60 * min, day = 24 * hour;
  if (diff < hour) return `il y a ${Math.max(1, Math.floor(diff / min))} min`;
  if (diff < day) return `il y a ${Math.floor(diff / hour)}h`;
  if (diff < 7 * day) return `il y a ${Math.floor(diff / day)} j`;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export function scoreColor(score: number): { bg: string; fg: string; label: string } {
  if (score >= 80) return { bg: "rgba(48,209,88,0.12)", fg: "#16a34a", label: "Excellent" };
  if (score >= 60) return { bg: "rgba(0,113,227,0.12)", fg: "#0071e3", label: "Bon" };
  if (score >= 40) return { bg: "rgba(255,159,10,0.12)", fg: "#c97400", label: "Moyen" };
  return { bg: "rgba(110,110,115,0.12)", fg: "#6e6e73", label: "Faible" };
}
