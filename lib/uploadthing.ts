import { createUploadthing, type FileRouter, UTFiles } from "uploadthing/next";

const f = createUploadthing();

const makeCustomId = (prefix: string, name: string) => {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `${prefix}:${Date.now()}-${safeName}`;
};

export const uploadRouter = {
  workbook: f({
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
      maxFileSize: "16MB",
      maxFileCount: 1,
    },
  })
    .middleware(({ files }) => ({
      [UTFiles]: files.map((file) => ({
        ...file,
        customId: makeCustomId("workbook", file.name),
      })),
    }))
    .onUploadComplete(() => {}),
  template: f({
    "application/pdf": {
      maxFileSize: "32MB",
      maxFileCount: 1,
    },
  })
    .middleware(({ files }) => ({
      [UTFiles]: files.map((file) => ({
        ...file,
        customId: makeCustomId("template", file.name),
      })),
    }))
    .onUploadComplete(() => {}),
  mapping: f({
    "application/json": {
      maxFileSize: "2MB",
      maxFileCount: 1,
    },
  })
    .middleware(({ files }) => ({
      [UTFiles]: files.map((file) => ({
        ...file,
        customId: makeCustomId("mapping", file.name),
      })),
    }))
    .onUploadComplete(() => {}),
  coordinates: f({
    "application/json": {
      maxFileSize: "2MB",
      maxFileCount: 1,
    },
  })
    .middleware(({ files }) => ({
      [UTFiles]: files.map((file) => ({
        ...file,
        customId: makeCustomId("coordinates", file.name),
      })),
    }))
    .onUploadComplete(() => {}),
} satisfies FileRouter;

export type UploadRouter = typeof uploadRouter;
