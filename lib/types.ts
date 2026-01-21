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

export type LibraryType = "workbook" | "template";

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
  | "coordinates";
