# Project Context & Agent Notes

## What this repo is
- Next.js app (app router) to generate Cornerstone proposal PDFs.
- Uploads handled via UploadThing; users upload workbook + template PDF, then the server stamps the PDF.

## Key flows
- UI: `app/page.tsx` uses UploadThing widgets and calls `/api/generate`.
- UploadThing route: `app/api/uploadthing/route.ts`.
- PDF generation: `app/api/generate/route.ts` (xlsx parsing + pdf-lib stamping).
- Coordinates + mappings: `config/coordinates.json`, `config/mapping.json`.
- Calibration helper: `scripts/calibrate.js` (run via `npm run calibrate`).
- Legacy Python/Flask implementation kept in `legacy/`.

## Environment
- UploadThing uses `UPLOADTHING_TOKEN` (set in `.env.local` and in Vercel env vars).
- Optional: `MAX_DOWNLOAD_MB` for server-side download limit.

## Deployment
- Vercel with Next.js builder; `vercel.json` present.
- Production alias: `https://cstone-estimating.vercel.app`.

## Agent workflow requirement
- Always commit and push after making changes.
- If changes are made, run relevant checks (at minimum `npm run build` for TS/Next).
