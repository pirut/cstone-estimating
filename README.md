# Cornerstone Proposal Generator (Next.js)

A web-focused app that uploads proposal inputs with UploadThing and generates a filled Cornerstone "New Construction Proposal" PDF.

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

# Allowed email domain (e.g. cornerstone.com)
NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN=cornerstone.com
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
DOWNLOAD_ALLOWLIST=uploadthing.com,utfs.io
DOWNLOAD_ALLOWLIST_SUFFIXES=uploadthing.com,utfs.io
ALLOW_PRIVATE_DOWNLOADS=false
ADMIN_TOKEN=your-secret

# For /admin, use Basic auth: any username + ADMIN_TOKEN as the password.
# For API calls, you can also send Authorization: Bearer $ADMIN_TOKEN.
```

## Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## Generate PDFs

1) Upload the workbook and template PDF using the UploadThing widgets.
2) Click **Generate Proposal PDF**.

## Calibration PDF (grid + markers)

```bash
npm run calibrate -- --template "/path/to/Cornerstone Proposal.pdf" --output calibration.pdf
```

Update `config/coordinates.json` with calibrated `x`/`y` values.

## Legacy Python version

The prior Flask implementation is kept in `legacy/` for reference.
