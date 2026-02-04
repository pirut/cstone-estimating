import { init } from "@instantdb/react";
import schema from "@/instant.schema";

export const instantAppId = process.env.NEXT_PUBLIC_INSTANTDB_APP_ID ?? "";

export const db = init({ appId: instantAppId, schema });
