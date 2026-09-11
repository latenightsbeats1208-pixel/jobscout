# ============================================================
# Install-DesktopShortcut.ps1
#
# Crée un raccourci "Job Scout.lnk" sur le Bureau qui lance
# Start-JobScout.ps1.
#
# À exécuter UNE FOIS :
#   clic droit sur ce fichier > "Exécuter avec PowerShell"
# ============================================================

$ErrorActionPreference = "Stop"

$ProjectDir   = Split-Path -Parent $PSScriptRoot
$LauncherPath = Join-Path $PSScriptRoot "Start-JobScout.ps1"
$DesktopPath  = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "Job Scout.lnk"

if (-not (Test-Path $LauncherPath)) {
    Write-Host "Erreur : $LauncherPath introuvable." -ForegroundColor Red
    exit 1
}

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath       = "powershell.exe"
$Shortcut.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$LauncherPath`""
$Shortcut.WorkingDirectory = $ProjectDir
$Shortcut.WindowStyle      = 7  # Minimized
$Shortcut.Description      = "Lance le serveur Job Scout et ouvre le site dans le navigateur"

# Icône — utilise PowerShell par défaut, propre
$Shortcut.IconLocation = "powershell.exe,0"

$Shortcut.Save()

Write-Host ""
Write-Host "Raccourci créé sur le Bureau : 'Job Scout.lnk'" -ForegroundColor Green
Write-Host "Double-cliquez dessus pour lancer Job Scout." -ForegroundColor Green
Write-Host ""
Read-Host "Appuyez sur Entrée pour fermer"
