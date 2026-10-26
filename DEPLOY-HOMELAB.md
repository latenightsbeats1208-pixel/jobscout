# Running JobScout on a homelab (Docker + Traefik + Tailscale)

JobScout runs as one container that stays up permanently. It scans the job sites
every morning by itself, so new offers are already scored when you open it.

- **Access**: through Traefik, only from your Tailscale network, behind a password.
- **Data**: SQLite database and generated CVs and letters live in `./data` next to
  `docker-compose.yml`. Back up that folder.
- **Documents**: download them from the offer page in your browser. The
  "open folder" buttons of the desktop version are hidden.

## 1. Prerequisites on the homelab

- Docker with the Compose plugin.
- Traefik running in Docker, attached to a Docker network (named `traefik` below).
- A hostname that reaches Traefik over Tailscale. For example, the MagicDNS name
  of the homelab (`homelab.tail1234.ts.net`) or a subdomain you route to it.

## 2. Configure

```bash
git clone <this repository> jobscout && cd jobscout
cp .env.docker.example .env
nano .env
```

Fill in at least:

| Variable | Example | Role |
|---|---|---|
| `JOBSCOUT_HOST` | `jobscout.homelab.tail1234.ts.net` | Hostname you type in the browser. Traefik routes it and the app accepts it. |
| `JOBSCOUT_PASSWORD` | a long password | Login screen. Required. |
| `JOBSCOUT_DAILY_SCAN` | `06:30` | Automatic daily scan (`TZ` time zone). Leave empty to disable it. |
| `TRAEFIK_NETWORK` | `traefik` | Docker network shared with Traefik. |
| `TRAEFIK_ENTRYPOINT` | `web` or `websecure` | Traefik entrypoint (HTTP:80 or HTTPS:443). |

If you use `websecure` with a certificate resolver, add the matching label in
`docker-compose.yml`:
`traefik.http.routers.jobscout.tls.certresolver: <your resolver>`.
Tailscale can also issue certificates for `*.ts.net` names (`tailscale cert`).

## 3. Start

```bash
docker compose up -d --build
docker compose logs -f jobscout   # expect: [daily-scan] programmé chaque jour à 06:30
```

The first build takes a few minutes (dependencies, then Chromium for LinkedIn).
Open `http://<JOBSCOUT_HOST>` (or `https://`) from any device on your tailnet.

## 4. First use

1. Log in with `JOBSCOUT_PASSWORD`.
2. Onboarding: choose the AI provider and paste your key (see [GUIDE-IA.md](GUIDE-IA.md)),
   then upload your CV, check the extracted profile, and set preferences (target
   countries, sectors, contracts, sources).
3. Click **Lancer un scan** once. After that, the daily scan runs every morning.

### Which sources for which location

| Target | Sources to enable |
|---|---|
| France | France Travail (official API recommended: `FT_CLIENT_ID` / `FT_CLIENT_SECRET` from francetravail.io), HelloWork, Welcome to the Jungle |
| Switzerland (Geneva, Lausanne, Zurich) | LinkedIn, Talent.com, Welcome to the Jungle. France Travail only covers France. |

Read [CGU.md](CGU.md) (sections 5 and 6) before enabling the sites other than France Travail.

## Update

```bash
git pull && docker compose up -d --build
```

## Troubleshooting

- **403 "hôte non autorisé"**: the hostname in the browser is not the one in
  `JOBSCOUT_HOST`. To use several names, separate them with commas.
- **Scan stuck at the start behind Traefik**: the scan streams its progress.
  Make sure no compression middleware is applied to this router.
- **Lighter image without LinkedIn**: set `WITH_LINKEDIN=0` in `.env`, then rebuild.
