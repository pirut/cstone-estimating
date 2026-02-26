# Cornerstone Proposal Generator (Next.js + Convex)

A web app that builds proposal payloads from manual estimate data and generates Cornerstone proposal documents in PandaDoc.

## Setup

```bash
npm install
```

Create `.env.local`:

```bash
# UploadThing
UPLOADTHING_TOKEN=...

# Convex (written automatically by `npx convex dev`)
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...

# Organization domain restrictions
NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN=cornerstonecompaniesfl.com
NEXT_PUBLIC_PRIMARY_OWNER_EMAIL=jr@cornerstonecompaniesfl.com
NEXT_PUBLIC_ORG_TEAM_NAME=CORNERSTONE
```

Optional download limits and allowlist:

```bash
MAX_DOWNLOAD_MB=50
DOWNLOAD_TIMEOUT_MS=15000
DOWNLOAD_ALLOWLIST=uploadthing.com,utfs.io,ufs.sh
DOWNLOAD_ALLOWLIST_SUFFIXES=uploadthing.com,utfs.io,ufs.sh
ALLOW_PRIVATE_DOWNLOADS=false
```

PandaDoc configuration (required for proposal generation):

```bash
PANDADOC_API_KEY=...
PANDADOC_TEMPLATE_UUID=...
PANDADOC_RECIPIENT_EMAIL=...
PANDADOC_RECIPIENT_ROLE=Client

# Optional overrides
PANDADOC_API_BASE_URL=https://api.pandadoc.com/public/v1
PANDADOC_APP_BASE_URL=https://app.pandadoc.com
PANDADOC_SESSION_LIFETIME_SECONDS=900
PANDADOC_READY_TIMEOUT_MS=45000
PANDADOC_READY_POLL_INTERVAL_MS=1200
PANDADOC_OWNER_MEMBERSHIP_ID=... # preferred, PandaDoc workspace membership_id for responsible owner
PANDADOC_OWNER_EMAIL=... # optional override for create requests (default is sales@cornerstonecompaniesfl.com)
```

## Convex local deployment

Initialize or reconnect the local deployment and generate Convex types:

```bash
npx convex dev --once
```

If this is the first run in a fresh checkout, configure once with:

```bash
npx convex dev --once --configure new --dev-deployment local --project cstone-estimating
```

## Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## Admin and mappings

- `/team-admin`: org/team management and catalog data (vendors, unit types, feature options).
- `/admin`: PandaDoc variable/field mapping presets.
- `/api/field-catalog?format=csv` (or `format=json`) exports source fields.

Admin access is controlled by Clerk sign-in and org role data stored in Convex (`owner`/`admin` behavior is enforced by app role checks).

## Legacy Python version

The prior Flask implementation is kept in `legacy/` for reference.
