# Cornerstone Proposal Generator (Next.js)

A web-focused app that builds proposals from manual estimate data and generates Cornerstone proposal documents in PandaDoc.

## Setup

```bash
npm install
```

Create `.env.local` with your UploadThing token:

```
UPLOADTHING_TOKEN=...
```

InstantDB + Clerk (Microsoft-only) config:

```
# InstantDB app id (public)
NEXT_PUBLIC_INSTANTDB_APP_ID=...

# Clerk keys
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...

# InstantDB ↔ Clerk client name (from Instant auth settings)
NEXT_PUBLIC_CLERK_CLIENT_NAME=...

# Allowed email domain (e.g. cornerstonecompaniesfl.com)
NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN=cornerstonecompaniesfl.com
```

In Clerk, enable Microsoft as the only social provider and restrict sign-ins to
the allowed domain. In InstantDB, configure Clerk auth and set the client name
to match `NEXT_PUBLIC_CLERK_CLIENT_NAME`.

Clerk needs the email claim in its session token for InstantDB. In the Clerk
dashboard, update **Customize session token** to include:

```
{
  "email": "{{user.primary_email_address}}"
}
```

After setting env vars, initialize InstantDB and push schema/perms:

```bash
npx instant-cli init-without-files --title "Cornerstone Proposal Studio"
npx instant-cli push schema --yes
npx instant-cli push perms --yes
```

The init command prints an app id and admin token. Store the app id in
`NEXT_PUBLIC_INSTANTDB_APP_ID` and keep the admin token handy for future admin
scripts.

Optional limits and security:

```
MAX_DOWNLOAD_MB=50
DOWNLOAD_TIMEOUT_MS=15000
DOWNLOAD_ALLOWLIST=uploadthing.com,utfs.io,ufs.sh
DOWNLOAD_ALLOWLIST_SUFFIXES=uploadthing.com,utfs.io,ufs.sh
ALLOW_PRIVATE_DOWNLOADS=false
```

PandaDoc configuration (required for proposal generation):

```
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
```

Admin access is controlled by Clerk + InstantDB team roles. Only users with
`owner` or `admin` membership on the org team can access `/team-admin`.

## Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## Generate PandaDoc proposals

1) Build estimate variables in the app with the manual estimate builder.
2) Provide the signer email in the Generate step.
3) Click **Generate PandaDoc**.

## Legacy Python version

The prior Flask implementation is kept in `legacy/` for reference.
