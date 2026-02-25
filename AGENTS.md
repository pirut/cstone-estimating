# Project Context & Agent Notes

## What this repo is

- Next.js app (app router) to generate Cornerstone proposal PDFs.
- Uploads handled via UploadThing; users upload workbook + template PDF, then the server stamps the PDF.

## Deployment

- Vercel with Next.js builder; `vercel.json` present.
- Production alias: `https://cstone-estimating.vercel.app`.
- Production Domain: `https://estimating.jrbussard.com`.

## Agent workflow requirement

- Always commit and push after making changes.
- If changes are made, run relevant checks (at minimum `npm run build` for TS/Next).
- Bump the app version in `package.json` after any code change so the UI reflects it (see `lib/version.ts`).
