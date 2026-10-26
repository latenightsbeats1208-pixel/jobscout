"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Chemin de retour après connexion : uniquement un chemin interne (pas de redirection ouverte). */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Connexion impossible.");
        return;
      }
      // Navigation complète : le middleware relit le cookie tout neuf.
      window.location.assign(safeNext(params.get("next")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Lock className="h-5 w-5" />
        </div>
        <CardTitle>JobScout</CardTitle>
        <CardDescription>Entrez votre mot de passe pour continuer.</CardDescription>
      </CardHeader>
      <form onSubmit={submit} className="space-y-3">
        <Input
          type="password"
          autoComplete="current-password"
          autoFocus
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-small text-danger">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !password}>
          {busy ? "Connexion…" : "Se connecter"}
        </Button>
      </form>
    </Card>
  );
}
