"use client";

import { UploadDropzone } from "@/components/uploadthing";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LibraryItem, UploadEndpoint, UploadedFile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CheckCircle2, RefreshCw, Trash2 } from "lucide-react";

type UploadCardProps = {
  title: string;
  description: string;
  endpoint: UploadEndpoint;
  selected?: UploadedFile;
  library?: { items: LibraryItem[]; loading: boolean; error: string | null };
  tag?: string;
  uploadLabel?: string;
  allowedContent?: string;
  onUpload: (file: UploadedFile) => void;
  onError?: (message: string) => void;
  onSelectLibrary?: (item: LibraryItem) => void;
  onRefreshLibrary?: () => void;
  onDeleteLibrary?: () => void;
};

const baseDropzoneAppearance = {
  container:
    "rounded-xl border border-dashed border-border/70 bg-background/80 px-6 py-8 transition hover:border-accent/70 hover:bg-muted/40",
  uploadIcon: "text-muted-foreground",
  label: "text-sm font-semibold text-foreground",
  allowedContent: "text-xs text-muted-foreground",
  button:
    "bg-foreground text-background shadow-sm hover:bg-foreground/90 data-[state=readying]:bg-muted data-[state=uploading]:bg-muted",
};

export function UploadCard({
  title,
  description,
  endpoint,
  selected,
  library,
  tag,
  uploadLabel,
  allowedContent,
  onUpload,
  onError,
  onSelectLibrary,
  onRefreshLibrary,
  onDeleteLibrary,
}: UploadCardProps) {
  const hasLibrary = Boolean(library);
  const label = uploadLabel ?? `Drag & drop or click to upload your ${title}`;
  const selectedLabel = selected ? `Selected: ${selected.name}` : label;
  const buttonLabel = selected ? "Replace file" : "Browse files";

  return (
    <Card className="relative overflow-hidden border-border/60 bg-card/80 shadow-elevated">
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-accent/10 to-transparent" />
      <CardHeader className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <CardTitle className="text-2xl font-serif">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {tag ? (
            <Badge variant="outline" className="bg-background/80">
              {tag}
            </Badge>
          ) : null}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          {selected ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-accent" />
              <span className="text-foreground">{selected.name}</span>
            </>
          ) : (
            <span>No file selected yet.</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="relative space-y-4">
        {hasLibrary ? (
          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload">Upload</TabsTrigger>
              <TabsTrigger value="library">Library</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="space-y-4">
              <UploadDropzone
                endpoint={endpoint}
                appearance={baseDropzoneAppearance}
                content={{
                  label: selectedLabel,
                  allowedContent: allowedContent ?? "Drag a file or browse",
                  button: buttonLabel,
                }}
                onClientUploadComplete={(files) => {
                  const uploaded = files?.[0];
                  if (!uploaded) return;
                  const url = uploaded.ufsUrl ?? uploaded.url;
                  onUpload({ name: uploaded.name, url });
                }}
                onUploadError={(err: Error) => {
                  const message = err.message || "Upload failed.";
                  onError?.(message);
                }}
              />
            </TabsContent>
            <TabsContent value="library" className="space-y-4">
              {library?.error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {library.error}
                </div>
              ) : null}
              {library?.loading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : library?.items.length ? (
                <ScrollArea className="h-52 rounded-lg border border-border/70 bg-background/70">
                  <div className="divide-y divide-border/60">
                    {library.items.map((item) => (
                      <div
                        key={item.key}
                        className="flex items-center justify-between gap-4 px-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {item.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(item.uploadedAt).toLocaleString()}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onSelectLibrary?.(item)}
                          disabled={!item.url}
                        >
                          Use
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <div className="text-sm text-muted-foreground">No files yet.</div>
              )}
              <Separator />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onRefreshLibrary}
                  disabled={library?.loading}
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={library?.loading}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete all
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete all uploads?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes every file in this library.
                        You cannot undo this action.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className={cn(
                          "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        )}
                        onClick={onDeleteLibrary}
                      >
                        Delete all
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <UploadDropzone
            endpoint={endpoint}
            appearance={baseDropzoneAppearance}
            content={{
              label: selectedLabel,
              allowedContent: allowedContent ?? "Drag a file or browse",
              button: buttonLabel,
            }}
            onClientUploadComplete={(files) => {
              const uploaded = files?.[0];
              if (!uploaded) return;
              const url = uploaded.ufsUrl ?? uploaded.url;
              onUpload({ name: uploaded.name, url });
            }}
            onUploadError={(err: Error) => {
              const message = err.message || "Upload failed.";
              onError?.(message);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
