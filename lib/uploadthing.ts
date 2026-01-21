import { createUploadthing, type FileRouter } from "uploadthing/next";

const f = createUploadthing();

export const uploadRouter = {
  workbook: f({
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
      maxFileSize: "16MB",
      maxFileCount: 1,
    },
  }).onUploadComplete(() => {}),
  template: f({
    "application/pdf": {
      maxFileSize: "32MB",
      maxFileCount: 1,
    },
  }).onUploadComplete(() => {}),
  mapping: f({
    "application/json": {
      maxFileSize: "2MB",
      maxFileCount: 1,
    },
  }).onUploadComplete(() => {}),
  coordinates: f({
    "application/json": {
      maxFileSize: "2MB",
      maxFileCount: 1,
    },
  }).onUploadComplete(() => {}),
} satisfies FileRouter;

export type UploadRouter = typeof uploadRouter;
