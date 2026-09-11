"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, AlertCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const SAFE_TYPES = [".pdf", ".docx", ".doc", ".txt", ".png", ".jpg", ".jpeg"];

export function CVUploader({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (disabled) return;
    setError(null);
    setFilename(file.name);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("cv", file);
      const res = await fetch("/api/profile/extract", { method: "POST", body: fd });
      if (!res.ok) {
        // res.ok AVANT res.json() : un corps non-JSON (page HTML d'erreur) ne
        // doit pas masquer le vrai message derrière « Unexpected token ».
        const data = await res.json().catch(() => null);
        setError(data?.error || `Erreur lors de l'extraction (HTTP ${res.status}).`);
        setLoading(false);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!data?.profile) {
        setError("Réponse du serveur illisible — réessayez.");
        setLoading(false);
        return;
      }
      // Stash extracted profile in sessionStorage and navigate
      sessionStorage.setItem("jobscout:extracted-profile", JSON.stringify(data.profile));
      router.push("/onboarding/verify");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (disabled) return;
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        onClick={() => !loading && !disabled && inputRef.current?.click()}
        aria-disabled={disabled}
        className={cn(
          "border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center gap-3 transition-all",
          disabled
            ? "border-border bg-surface opacity-50 cursor-not-allowed"
            : loading
            ? "border-border bg-surface cursor-default"
            : dragOver
            ? "border-accent bg-accent/5 cursor-pointer"
            : "border-border bg-surface hover:bg-surfaceHover hover:border-textSecondary cursor-pointer"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={SAFE_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {loading ? (
          <>
            <Spinner size={28} />
            <p className="text-body text-text mt-2">Lecture de votre CV…</p>
            <p className="text-small text-textSecondary">{filename}</p>
          </>
        ) : filename && !error ? (
          <>
            <FileText className="h-8 w-8 text-accent" />
            <p className="text-body text-text">{filename}</p>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-textSecondary" />
            <p className="text-body text-text font-medium">Glissez votre CV ici</p>
            <p className="text-small text-textSecondary">ou cliquez pour sélectionner — PDF, DOCX, TXT, image</p>
            {disabled && (
              <p className="text-small text-textSecondary mt-1">
                Configurez d'abord la génération IA ci-dessus pour débloquer l'import.
              </p>
            )}
          </>
        )}
      </div>
      {error && (
        <div className="flex items-start gap-2 p-4 rounded-md bg-[rgba(255,59,48,0.08)] text-danger text-small">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
