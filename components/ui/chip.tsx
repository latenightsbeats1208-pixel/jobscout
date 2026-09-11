"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export function Chip({
  active,
  onClick,
  onRemove,
  children,
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 h-8 text-small font-medium border transition-all",
        active
          ? "bg-accent border-accent text-white"
          : "bg-surface border-border text-text hover:bg-surfaceHover",
        className
      )}
    >
      {children}
      {onRemove && (
        <X
          className="h-3.5 w-3.5 -mr-1 opacity-70 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        />
      )}
    </button>
  );
}
