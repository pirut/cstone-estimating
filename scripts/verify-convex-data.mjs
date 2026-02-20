#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key || process.env[key]) continue;
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (value.includes(" #")) {
      value = value.split(" #")[0].trim();
    }
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main() {
  loadEnvFromFile(path.join(process.cwd(), ".env.local"));

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const domain = (process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "").trim().toLowerCase();

  if (!convexUrl) {
    throw new Error("Missing NEXT_PUBLIC_CONVEX_URL.");
  }
  if (!domain) {
    throw new Error("Missing NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN.");
  }

  const client = new ConvexHttpClient(convexUrl);
  const teams = await client.query(api.app.teamGraphByDomain, { domain });

  const counts = {
    teams: teams.length,
    memberships: 0,
    projects: 0,
    estimates: 0,
    vendors: 0,
    unitTypes: 0,
    productFeatureOptions: 0,
  };

  for (const team of teams) {
    counts.memberships += Array.isArray(team.memberships) ? team.memberships.length : 0;
    counts.projects += Array.isArray(team.projects) ? team.projects.length : 0;
    counts.estimates += Array.isArray(team.estimates) ? team.estimates.length : 0;
    counts.vendors += Array.isArray(team.vendors) ? team.vendors.length : 0;
    counts.unitTypes += Array.isArray(team.unitTypes) ? team.unitTypes.length : 0;
    counts.productFeatureOptions += Array.isArray(team.productFeatureOptions)
      ? team.productFeatureOptions.length
      : 0;
  }

  console.log(JSON.stringify(counts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
