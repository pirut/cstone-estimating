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

Optional limits:

```
MAX_DOWNLOAD_MB=50
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
