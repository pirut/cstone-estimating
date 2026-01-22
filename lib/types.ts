export type UploadedFile = {
  name: string;
  url: string;
};

export type LibraryItem = {
  key: string;
  name: string;
  uploadedAt: number;
  url: string;
};

export type LibraryType = "workbook" | "template" | "template_config";

export type LibraryState = Record<
  LibraryType,
  { items: LibraryItem[]; loading: boolean; error: string | null }
>;

export type UploadState = {
  workbook?: UploadedFile;
  template?: UploadedFile;
  mapping?: UploadedFile;
  coords?: UploadedFile;
};

export type UploadEndpoint =
  | "workbook"
  | "template"
  | "mapping"
  | "coordinates"
  | "template_config";

export type TemplateConfig = {
  version: number;
  id: string;
  name: string;
  description?: string;
  templatePdf: { name: string; url: string };
  coords: Record<string, any>;
  mapping?: Record<string, any>;
  createdAt: string;
};
