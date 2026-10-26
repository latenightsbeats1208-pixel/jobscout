import { PageHeader } from "@/components/app/page-header";
import { getCvTemplate } from "@/lib/cvtemplate/store";
import { missingEnglish, templatePlaceholders } from "@/lib/cvtemplate/inspect";
import { TemplateEditor } from "./editor";

export const dynamic = "force-dynamic";

export default function CvTemplatePage() {
  const template = getCvTemplate();
  return (
    <>
      <PageHeader
        eyebrow="Vos documents"
        title="Modèle de CV"
        subtitle="Votre CV maître : clusters de postes, banque de puces et blocs de compétences. Pour chaque offre, JobScout choisit le cluster et les puces, sans rien réécrire."
      />
      <TemplateEditor
        initial={template}
        initialPlaceholders={template ? templatePlaceholders(template) : []}
        initialMissingEnglish={template ? missingEnglish(template) : []}
      />
    </>
  );
}
