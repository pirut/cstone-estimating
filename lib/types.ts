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

export type LibraryType =
  | "workbook"
  | "template"
  | "template_config"
  | "estimate";

export type LibraryState = Record<
  LibraryType,
  { items: LibraryItem[]; loading: boolean; error: string | null }
>;

export type UploadState = {
  workbook?: UploadedFile;
  template?: UploadedFile;
  mapping?: UploadedFile;
  coords?: UploadedFile;
  estimate?: UploadedFile;
};

export type UploadEndpoint =
  | "workbook"
  | "template"
  | "mapping"
  | "coordinates"
  | "template_config"
  | "estimate";

export type MasterTemplateInclusionMode =
  | "always"
  | "project_type"
  | "product_type"
  // Legacy modes (kept for backward compatibility)
  | "product"
  | "vendor"
  | "field";

export type MasterTemplateSectionKey =
  | "title"
  | "product"
  | "process"
  | "install_spec"
  | "terms"
  | "pricing"
  | "custom";

export type MasterTemplatePage = {
  id: string;
  title: string;
  order: number;
  coordsPageKey: string;
  sourcePdf?: { name: string; url: string };
  sourcePage?: number;
  inclusionMode: MasterTemplateInclusionMode;
  conditionField?: string;
  conditionValue?: string;
  vendorKey?: string;
  dataBindings?: string[];
  sectionKey?: MasterTemplateSectionKey;
  isFallback?: boolean;
  notes?: string;
};

export type MasterTemplateSelectionConfig = {
  projectTypeField?: string;
  productTypeField?: string;
  sectionOrder?: MasterTemplateSectionKey[];
};

export type MasterTemplateConfig = {
  version: number;
  selection?: MasterTemplateSelectionConfig;
  pages: MasterTemplatePage[];
};

export type TemplateConfig = {
  version: number;
  id: string;
  name: string;
  templateVersion?: number;
  description?: string;
  templatePdf?: { name: string; url: string };
  masterTemplate?: MasterTemplateConfig;
  coords: Record<string, any>;
  mapping?: Record<string, any>;
  createdAt: string;
};
