import { PageHeader } from "@/components/app/page-header";
import { AddCVFlow } from "./add-cv-flow";

export default function AddCVPage() {
  return (
    <>
      <PageHeader
        title="Ajouter un CV"
        subtitle="Les informations de ce CV s'ajouteront à votre profil sans effacer ce qui existe déjà."
      />
      <AddCVFlow />
    </>
  );
}
