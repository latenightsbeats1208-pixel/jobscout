import Link from "next/link";
import { Download, FileText, Mail, MessageSquare } from "lucide-react";
import { listDocuments } from "@/lib/db/documents";
import { getDb } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import path from "node:path";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const docs = listDocuments();
  // Join with offre info for display
  const db = getDb();
  const offreMap = new Map<number, { title: string; company: string }>();
  for (const d of docs) {
    if (d.offre_id == null) continue;
    if (offreMap.has(d.offre_id)) continue;
    const o = db.prepare("SELECT title, company FROM offres WHERE id = ?").get(d.offre_id) as
      | { title: string; company: string }
      | undefined;
    if (o) offreMap.set(d.offre_id, o);
  }

  const grouped = {
    cv: docs.filter((d) => d.type === "cv"),
    lm: docs.filter((d) => d.type === "lm"),
    msg: docs.filter((d) => d.type === "msg"),
  };

  return (
    <>
      <PageHeader title="Documents" subtitle={`${docs.length} document${docs.length > 1 ? "s" : ""}`} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Section title="CV" icon={<FileText className="h-5 w-5" />} docs={grouped.cv} offreMap={offreMap} />
        <Section title="Lettres de motivation" icon={<Mail className="h-5 w-5" />} docs={grouped.lm} offreMap={offreMap} />
        <Section title="Messages V.I.E" icon={<MessageSquare className="h-5 w-5" />} docs={grouped.msg} offreMap={offreMap} />
      </div>
    </>
  );
}

function Section({
  title,
  icon,
  docs,
  offreMap,
}: {
  title: string;
  icon: React.ReactNode;
  docs: ReturnType<typeof listDocuments>;
  offreMap: Map<number, { title: string; company: string }>;
}) {
  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <div className="h-8 w-8 rounded-md bg-surface flex items-center justify-center text-textSecondary">
          {icon}
        </div>
        <h2 className="text-h3">{title}</h2>
        <span className="ml-auto text-small text-textSecondary">{docs.length}</span>
      </div>
      {docs.length === 0 ? (
        <p className="text-small text-textSecondary py-4">Aucun document.</p>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => {
            const o = d.offre_id ? offreMap.get(d.offre_id) : null;
            const filename = path.basename(d.file_path);
            return (
              <div key={d.id} className="flex items-center gap-3 p-3 rounded-md hover:bg-surface">
                <div className="flex-1 min-w-0">
                  {o ? (
                    <Link href={`/offres/${d.offre_id}`} className="block">
                      <p className="text-body font-medium truncate">{o.title}</p>
                      <p className="text-small text-textSecondary truncate">{o.company}</p>
                    </Link>
                  ) : (
                    <p className="text-body font-medium truncate">{filename}</p>
                  )}
                  <p className="text-caption text-textSecondary mt-0.5">
                    {d.generated_at.split(" ")[0]} · <Badge variant="default" className="ml-1">{d.format}</Badge>
                  </p>
                </div>
                <a
                  href={`/api/documents/${d.id}`}
                  className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-bg text-textSecondary"
                  title="Télécharger"
                >
                  <Download className="h-4 w-4" />
                </a>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
