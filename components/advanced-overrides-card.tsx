"use client";

import { useEffect, useState } from "react";
import { UploadDropzone } from "@/components/uploadthing";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { UploadEndpoint, UploadedFile } from "@/lib/types";

const compactAppearance = {
  container:
    "rounded-lg border border-dashed border-border/70 bg-background/70 px-4 py-6 transition hover:border-accent/60 hover:bg-muted/40",
  uploadIcon: "text-muted-foreground",
  label: "text-sm font-medium text-foreground",
  allowedContent: "text-xs text-muted-foreground",
  button:
    "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 data-[state=readying]:bg-muted data-[state=uploading]:bg-muted",
};

type OverrideTileProps = {
  title: string;
  description: string;
  endpoint: UploadEndpoint;
  selected?: UploadedFile;
  onUpload: (file: UploadedFile) => void;
  onError?: (message: string) => void;
};

function OverrideTile({
  title,
  description,
  endpoint,
  selected,
  onUpload,
  onError,
}: OverrideTileProps) {
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const stagedName = stagedFiles[0]?.name;
  const stagedCount = stagedFiles.length;
  const hasStaged = stagedCount > 0;

  useEffect(() => {
    if (selected?.name) {
      setStagedFiles([]);
    }
  }, [selected?.name]);

  const handleUploadComplete = (
    files?: { name: string; url: string; ufsUrl?: string }[]
  ) => {
    const uploaded = files?.[0];
    if (!uploaded) return;
    const url = uploaded.ufsUrl ?? uploaded.url;
    setStagedFiles([]);
    onUpload({ name: uploaded.name, url });
  };
  const dropzoneContent = {
    label: ({
      isDragActive,
      isUploading,
    }: {
      isDragActive: boolean;
      isUploading: boolean;
    }) => {
      if (isDragActive) {
        return "Drop JSON to upload";
      }
      if (isUploading && stagedName) {
        return `Uploading: ${stagedName}`;
      }
      if (stagedName) {
        return `Staged: ${stagedName}`;
      }
      if (selected?.name) {
        return `Selected: ${selected.name}`;
      }
      return "Upload JSON overrides";
    },
    allowedContent: ({
      isUploading,
      uploadProgress,
    }: {
      isUploading: boolean;
      uploadProgress: number;
    }) => {
      if (isUploading) {
        return `Uploading... (${Math.round(uploadProgress)}%)`;
      }
      if (hasStaged) {
        return "Click upload to start";
      }
      return "JSON only";
    },
    button: ({
      isUploading,
    }: {
      isUploading: boolean;
    }) => {
      if (isUploading) return "Uploading...";
      if (hasStaged) {
        return stagedCount > 1 ? `Upload ${stagedCount} files` : "Upload file";
      }
      if (selected?.name) return "Replace file";
      return "Select file";
    },
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-card/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Badge variant="muted" className="bg-muted/80">
          Optional
        </Badge>
      </div>
      {selected ? (
        <p className="text-xs text-muted-foreground">Selected: {selected.name}</p>
      ) : null}
      <UploadDropzone
        endpoint={endpoint}
        appearance={compactAppearance}
        content={dropzoneContent}
        onChange={setStagedFiles}
        onClientUploadComplete={handleUploadComplete}
        onUploadError={(err: Error) => {
          const message = err.message || "Upload failed.";
          onError?.(message);
        }}
      />
    </div>
  );
}

type AdvancedOverridesCardProps = {
  mapping?: UploadedFile;
  coords?: UploadedFile;
  onUploadMapping: (file: UploadedFile) => void;
  onUploadCoords: (file: UploadedFile) => void;
  onError?: (message: string) => void;
};

export function AdvancedOverridesCard({
  mapping,
  coords,
  onUploadMapping,
  onUploadCoords,
  onError,
}: AdvancedOverridesCardProps) {
  return (
    <Card className="border-border/60 bg-card/80 shadow-elevated">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <CardTitle className="text-2xl font-serif">
              Advanced Overrides
            </CardTitle>
            <CardDescription>
              Override default mapping and coordinates for calibration.
            </CardDescription>
          </div>
          <Badge variant="outline" className="bg-background/80">
            Optional
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <OverrideTile
          title="Mapping JSON"
          description="Custom cell mapping for non-standard workbooks."
          endpoint="mapping"
          selected={mapping}
          onUpload={onUploadMapping}
          onError={onError}
        />
        <OverrideTile
          title="Coordinates JSON"
          description="Override PDF coordinates for stamp calibration."
          endpoint="coordinates"
          selected={coords}
          onUpload={onUploadCoords}
          onError={onError}
        />
      </CardContent>
    </Card>
  );
}
