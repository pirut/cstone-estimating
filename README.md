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
