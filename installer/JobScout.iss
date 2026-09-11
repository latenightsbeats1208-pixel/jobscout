; ============================================================================
; JobScout — script Inno Setup 6
;
; Fichier en UTF-8 AVEC BOM (Inno Setup 6 Unicode) : les textes affichés à
; l'utilisateur ([CustomMessages]) portent leurs accents tels quels.
;
; Installation PAR UTILISATEUR (PrivilegesRequired=lowest) : aucune élévation
; administrateur, {autopf} se résout sur %LOCALAPPDATA%\Programs.
;
; Les données utilisateur vivent dans %LOCALAPPDATA%\JobScout, en dehors du
; répertoire d'installation : la désinstallation les PRÉSERVE par défaut.
;
; Compilé par installer/build.mjs, qui passe la version et le chemin de la
; charge utile en paramètres :
;   ISCC.exe /DMyAppVersion=3.3.0 /DPayloadDir=...\dist\JobScout JobScout.iss
;
; Variant de build (optionnel) : /DVariant=test produit « JobScout Test » —
; AppId distinct (coexiste avec le JobScout standard, désinstallation séparée),
; dossier d'installation, groupe, raccourcis, mutex, dossier de données
; (%LOCALAPPDATA%\JobScout Test) et nom de fichier de sortie distincts, plus
; une page d'information avant l'installation (/DInfoFile=...) et une
; installation par utilisateur IMPOSÉE (pas d'écran « pour tous les
; utilisateurs »). Sans /DVariant, le build standard est strictement inchangé.
; Voir installer/variant.mjs.
; ============================================================================

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#ifndef PayloadDir
  #define PayloadDir "dist\JobScout"
#endif
#ifndef OutDir
  #define OutDir "output"
#endif

#ifdef Variant
  #if Variant == "test"
    #define MyAppName "JobScout Test"
    #define MyAppIdGuid "{{A9C4E1B2-6D3F-4A57-8E21-5B7F0C9D3E64}"
    #define MyDataDirName "JobScout Test"
    #define MyMutexName "JobScoutTestLauncherSingleton"
    #define OutBase "JobScout_Test_Setup_v" + MyAppVersion
    ; Pas de AllowPrivilegesOverride ici : le variant de test n'émet PAS
    ; PrivilegesRequiredOverridesAllowed. L'assistant ne propose donc jamais
    ; « Installer pour tous les utilisateurs » — ce choix rendrait fausses deux
    ; affirmations de INFO-INSTALLATION.txt (dossier %LOCALAPPDATA%\Programs,
    ; « sans droit administrateur »). Installation par utilisateur imposée.
  #else
    #error "Variant inconnu : attendu test (ou rien pour le build standard)"
  #endif
#else
  #define MyAppName "JobScout"
  #define MyAppIdGuid "{{7E2C9A54-3B41-4F6D-9C77-1D0E8B5A2F31}"
  #define MyDataDirName "JobScout"
  #define MyMutexName "JobScoutLauncherSingleton"
  #define OutBase "JobScout_Setup_v" + MyAppVersion
  ; Build standard : comportement inchangé, l'écran « pour tous les
  ; utilisateurs / pour moi seulement » reste proposé.
  #define AllowPrivilegesOverride "dialog"
#endif
#define MyAppPublisher "JobScout"
#define MyAppExeName "JobScout.exe"

[Setup]
AppId={#MyAppIdGuid}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
VersionInfoVersion={#MyAppVersion}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
AllowNoIcons=yes
PrivilegesRequired=lowest
#ifdef AllowPrivilegesOverride
PrivilegesRequiredOverridesAllowed={#AllowPrivilegesOverride}
#endif
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutDir}
OutputBaseFilename={#OutBase}
SetupIconFile=assets\jobscout.ico
; Page d'information AVANT l'installation (variant de test) : texte généré par
; installer/install-info.mjs avec les tailles réellement mesurées du dist.
#ifdef InfoFile
InfoBeforeFile={#InfoFile}
#endif
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName} {#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Signature Authenticode : activée par build.mjs avec /DSignBuild=1 et
; /SJobScoutSign=... (la commande appelle installer/sign.mjs, qui lit le
; certificat dans l'environnement — jamais dans le dépôt). Inno signe alors
; l'installeur ET le désinstalleur.
#ifdef SignBuild
SignTool=JobScoutSign
SignedUninstaller=yes
#endif
; Le launcher pose ce mutex : Inno propose de fermer l'app avant de remplacer
; les fichiers, plutôt que d'échouer sur un node.exe encore en cours.
AppMutex=Local\{#MyMutexName}
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
; Invite de fin de désinstallation (voir CurUninstallStepChanged). Textes avec
; leurs accents — le fichier est en UTF-8 avec BOM. %1 = nom de l'application
; ({#MyAppName}, donc « JobScout Test » pour le variant de test).
french.RemoveDataAsk=Voulez-vous aussi supprimer vos données %1 ?
french.RemoveDataContent=Elles contiennent votre profil, vos offres et vos documents générés.
french.RemoveDataAdvice=Répondez Non pour les conserver (recommandé).
english.RemoveDataAsk=Do you also want to delete your %1 data?
english.RemoveDataContent=It contains your profile, your job offers and your generated documents.
english.RemoveDataAdvice=Answer No to keep it (recommended).

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\jobscout.ico"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\jobscout.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Uniquement les artefacts d'exécution écrits dans le répertoire d'installation.
Type: filesandordirs; Name: "{app}\app\.next\cache"
Type: dirifempty; Name: "{app}\app\data"
Type: dirifempty; Name: "{app}"

[Code]
function UserDataDir(): String;
begin
  Result := ExpandConstant('{localappdata}\{#MyDataDirName}');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Answer: Integer;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    if not DirExists(UserDataDir()) then
      Exit;
    // Par défaut on CONSERVE : en mode silencieux SuppressibleMsgBox renvoie
    // directement IDNO, donc aucune donnée n'est supprimée sans réponse humaine.
    // Textes accentués dans [CustomMessages] ; %1 reçoit le nom du variant.
    Answer := SuppressibleMsgBox(
      FmtMessage(CustomMessage('RemoveDataAsk'), ['{#MyAppName}']) + #13#10#13#10 +
      UserDataDir() + #13#10#13#10 +
      CustomMessage('RemoveDataContent') + #13#10 +
      CustomMessage('RemoveDataAdvice'),
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO);
    if Answer = IDYES then
      DelTree(UserDataDir(), True, True, True);
  end;
end;
