# ============================================================
# Start-JobScout.ps1  —  LANCEUR DE DÉVELOPPEMENT UNIQUEMENT
#
# Lance `npm run dev` sur le projet source (port 3000) et ouvre le
# navigateur. Il lit et écrit la base de développement `data/jobscout.db`.
#
# Ce n'est PAS le lanceur de l'application distribuée : la version installée
# utilise JobScout.exe (installer/launcher/), qui embarque son propre Node,
# choisit un port libre et range les données dans %LOCALAPPDATA%\JobScout.
# ============================================================

$ErrorActionPreference = "SilentlyContinue"

$Url = "http://localhost:3000"
$ProjectDir = Split-Path -Parent $PSScriptRoot

function Test-ServerUp {
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -MaximumRedirection 0 -ErrorAction Stop
        return $true
    } catch {
        # 307 redirect counts as "up" (Next.js redirects / -> /onboarding or /dashboard)
        if ($_.Exception.Response.StatusCode.value__ -ge 200 -and $_.Exception.Response.StatusCode.value__ -lt 400) {
            return $true
        }
        return $false
    }
}

# Si le serveur tourne déjà, on ouvre juste le navigateur
if (Test-ServerUp) {
    Start-Process $Url
    exit 0
}

# Sinon on lance le serveur dans une nouvelle fenêtre (minimisée)
Set-Location -Path $ProjectDir

$serverCmd = "Set-Location -LiteralPath '$ProjectDir'; npm run dev"
Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoExit", "-NoProfile", "-Command", $serverCmd `
    -WindowStyle Minimized

# On attend que le serveur réponde (max 60 secondes)
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if (Test-ServerUp) {
        $ready = $true
        break
    }
}

if ($ready) {
    Start-Process $Url
} else {
    Write-Host "[Job Scout] Le serveur n'a pas répondu après 60 secondes."
    Write-Host "Vérifiez la fenêtre 'npm run dev' minimisée dans la barre des tâches."
    Read-Host "Appuyez sur Entrée pour fermer"
}
