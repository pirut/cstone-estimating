"use client";

import { generateReactHelpers, generateUploadDropzone } from "@uploadthing/react";
import type { UploadRouter } from "@/lib/uploadthing";

export const UploadDropzone = generateUploadDropzone<UploadRouter>();
export const { uploadFiles, useUploadThing } = generateReactHelpers<UploadRouter>();
