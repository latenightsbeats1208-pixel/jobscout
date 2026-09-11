// ============================================================================
// installer/launcher/build-launcher.mjs
//
// Compile JobScoutLauncher.cs en JobScout.exe avec le csc.exe du .NET
// Framework 4, présent d'origine sur tout Windows 10/11 : le launcher ne
// demande donc AUCUN runtime supplémentaire sur la machine de l'utilisateur.
//
// L'exécutable porte une RESSOURCE DE VERSION Win32 (FileVersion, ProductName,
// FileDescription, CompanyName) générée ici à partir de version.json et du
// variant, et compilée avec le launcher : sans elle JobScout.exe est anonyme
// dans SmartScreen et le Gestionnaire des tâches (FileVersion 0.0.0.0,
// ProductName vide).
// ============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { asVariant } from "../variant.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(path.dirname(HERE));
const SOURCE = path.join(HERE, "JobScoutLauncher.cs");

function findCsc() {
  const roots = [
    path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64"),
    path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework"),
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const versions = fs
      .readdirSync(root)
      .filter((d) => d.startsWith("v4."))
      .sort()
      .reverse();
    for (const v of versions) {
      const csc = path.join(root, v, "csc.exe");
      if (fs.existsSync(csc)) return csc;
    }
  }
  throw new Error(
    "csc.exe introuvable (.NET Framework 4). Installez « .NET Framework 4.x » " +
      "ou compilez le launcher sur une machine qui en dispose."
  );
}

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(PROJECT, "version.json"), "utf-8")).version;
}

/**
 * Source C# des attributs d'assembly → ressource de version Win32 de l'exe.
 * Correspondances établies par csc : AssemblyTitle → FileDescription,
 * AssemblyProduct → ProductName, AssemblyCompany → CompanyName,
 * AssemblyFileVersion → FileVersion, AssemblyInformationalVersion →
 * ProductVersion, AssemblyDescription → Comments.
 */
export function renderAssemblyInfo({ appName, version }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Version « ${version} » inattendue pour la ressource de version (X.Y.Z).`);
  }
  const numeric = `${version}.0`;
  // Les chaînes C# acceptent les mêmes séquences d'échappement que JSON.
  const q = (s) => JSON.stringify(String(s));
  return [
    "// Généré par installer/launcher/build-launcher.mjs à chaque build — ne pas éditer.",
    "using System.Reflection;",
    "",
    `[assembly: AssemblyTitle(${q(appName)})]`,
    `[assembly: AssemblyDescription(${q(`Lanceur de ${appName} : démarre le serveur local et ouvre le navigateur.`)})]`,
    `[assembly: AssemblyProduct(${q(appName)})]`,
    `[assembly: AssemblyCompany("JobScout")]`,
    `[assembly: AssemblyVersion(${q(numeric)})]`,
    `[assembly: AssemblyFileVersion(${q(numeric)})]`,
    `[assembly: AssemblyInformationalVersion(${q(version)})]`,
    "",
  ].join("\r\n");
}

/**
 * Propagation du variant de build au launcher : une CONSTANTE DE COMPILATION
 * (`/define:JOBSCOUT_VARIANT_TEST`), lue par `#if` dans JobScoutLauncher.cs.
 * Le nom affiché, le dossier de données (%LOCALAPPDATA%\JobScout Test) et le
 * mutex sont donc figés dans l'exécutable — pas de fichier de configuration
 * à côté de l'exe qu'un utilisateur pourrait déplacer ou éditer, et le
 * launcher du build standard (sans define) reste compilé à l'identique.
 *
 * Le nom du produit et la version (ressource de version) suivent le même
 * variant et version.json.
 */
export function buildLauncher({ outDir, icon, variant = "prod", version = readVersion() }) {
  const v = asVariant(variant);
  const variantId = v.id;
  const csc = findCsc();
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "JobScout.exe");

  // AssemblyInfo généré dans un dossier temporaire : il n'entre ni dans le
  // dépôt ni dans la charge utile (l'exe seul est produit dans outDir).
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-launcher-"));
  const assemblyInfo = path.join(scratch, "AssemblyInfo.cs");
  fs.writeFileSync(assemblyInfo, renderAssemblyInfo({ appName: v.appName, version }), "utf-8");

  const args = [
    "/nologo",
    "/target:winexe",
    "/platform:anycpu",
    "/optimize+",
    // Le source contient des accents : sans ceci csc lirait en codepage ANSI.
    "/codepage:65001",
    "/reference:System.dll",
    "/reference:System.Drawing.dll",
    "/reference:System.Windows.Forms.dll",
    `/out:${out}`,
  ];
  if (variantId !== "prod") args.push(`/define:JOBSCOUT_VARIANT_${variantId.toUpperCase()}`);
  if (icon && fs.existsSync(icon)) args.push(`/win32icon:${icon}`);
  args.push(SOURCE, assemblyInfo);

  try {
    execFileSync(csc, args, { stdio: "pipe" });
  } catch (e) {
    const output = [e.stdout, e.stderr]
      .filter(Boolean)
      .map((b) => b.toString())
      .join("\n");
    throw new Error(`Compilation du launcher échouée :\n${output}`);
  } finally {
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
  }
  return out;
}

const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const outDir = process.argv[2] || path.join(HERE, "out");
  const icon = path.join(path.dirname(HERE), "assets", "jobscout.ico");
  const { resolveVariant } = await import("../variant.mjs");
  const exe = buildLauncher({ outDir, icon, variant: resolveVariant() });
  console.log(`[launcher] ${exe} (${(fs.statSync(exe).size / 1024).toFixed(0)} Ko)`);
}
