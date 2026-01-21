"use client";

import { generateUploadDropzone } from "@uploadthing/react";
import type { UploadRouter } from "@/lib/uploadthing";

export const UploadDropzone = generateUploadDropzone<UploadRouter>();
