"use client";

import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import mappingDefault from "@/config/mapping.json";
import coordinatesDefault from "@/config/coordinates.json";
import { InstantAuthSync } from "@/components/instant-auth-sync";
import { UploadDropzone } from "@/components/uploadthing";
import { PdfCalibrationViewer } from "@/components/pdf-calibration-viewer";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  MasterTemplateConfig,
  MasterTemplateInclusionMode,
  MasterTemplatePage,
  MasterTemplateSectionKey,
  UploadedFile,
} from "@/lib/types";
import { db, instantAppId } from "@/lib/instant";
import {
  SignInButton,
  clerkEnabled,
  useOptionalAuth,
  useOptionalUser,
} from "@/lib/clerk";
import { cn } from "@/lib/utils";
import { formatPreviewValue } from "@/lib/formatting";
import {
  getSortedPageKeys,
  parsePageKey,
  toPageKey,
} from "@/lib/coordinates";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  FileDown,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

type AdminLibraryType =
  | "workbook"
  | "template"
  | "mapping"
  | "coordinates"
  | "template_config";

type LibraryItem = {
  key: string;
  name: string;
  uploadedAt: number;
  url: string;
};

type LibraryState = {
  items: LibraryItem[];
  loading: boolean;
  error: string | null;
};

type MappingField = {
  sheet?: string;
  cell?: string;
  format?: string;
};

type MappingConfig = {
  missing_value?: string;
  prepared_by_map?: Record<string, string>;
  fields: Record<string, MappingField>;
};

type CoordField = {
  x?: number;
  y?: number;
  size?: number;
  align?: string;
  max_width?: number;
  min_size?: number;
  font?: string;
  color?: string;
  opacity?: number;
};

type CoordsConfig = Record<string, any>;
type CellPreviewMap = Record<string, unknown>;
type MasterTemplatePageDraft = MasterTemplatePage;
type MasterTemplateSelectionDraft = {
  projectTypeField: string;
  productTypeField: string;
  projectTypes: string[];
  sectionOrder: MasterTemplateSectionKey[];
};

const LIBRARY_CONFIG: Record<
  AdminLibraryType,
  { label: string; description: string; endpoint: AdminLibraryType }
> = {
  workbook: {
    label: "Workbooks",
    description: "Uploaded Excel workbooks (.xlsx).",
    endpoint: "workbook",
  },
  template: {
    label: "Templates",
    description: "Uploaded proposal templates (.pdf).",
    endpoint: "template",
  },
  mapping: {
    label: "Mapping JSON",
    description: "Excel cell mapping overrides.",
    endpoint: "mapping",
  },
  coordinates: {
    label: "Coordinates JSON",
    description: "PDF coordinates overrides.",
    endpoint: "coordinates",
  },
  template_config: {
    label: "Template Library",
    description: "Saved proposal templates with PDF + coordinates.",
    endpoint: "template_config",
  },
};

const adminDropzoneAppearance = {
  container:
    "rounded-xl border border-dashed border-border/70 bg-background/80 px-4 py-6 transition hover:border-accent/60 hover:bg-muted/40",
  uploadIcon: "text-muted-foreground",
  label: "text-sm font-semibold text-foreground",
  allowedContent: "text-xs text-muted-foreground",
  button:
    "bg-foreground text-background shadow-sm hover:bg-foreground/90 data-[state=readying]:bg-muted data-[state=uploading]:bg-muted",
};

const DEFAULT_MASTER_TEMPLATE_SECTION_ORDER: MasterTemplateSectionKey[] = [
  "title",
  "product",
  "process",
  "install_spec",
  "terms",
  "pricing",
];
const DEFAULT_PROJECT_TYPE_FIELD = "project_type";
const DEFAULT_PRODUCT_TYPE_FIELD = "product_type";
const DEFAULT_MASTER_TEMPLATE_PROJECT_TYPES = [
  "New Construction",
  "Replacement",
  "Remodel",
];
const MASTER_TEMPLATE_TEMPLATE_MIME = "application/x-master-template-pdf";
const CALIBRATION_FIELD_MIME = "application/x-calibration-field";

export default function AdminPage() {
  const [isEmbedded, setIsEmbedded] = useState(false);
  const { isLoaded: authLoaded, isSignedIn } = useOptionalAuth();
  const { user } = useOptionalUser();
  const { isLoading: instantLoading, user: instantUser, error: instantAuthError } =
    db.useAuth();
  const [instantSetupError, setInstantSetupError] = useState<string | null>(null);
  const workbookWorkerRef = useRef<Worker | null>(null);
  const [libraries, setLibraries] = useState<
    Record<AdminLibraryType, LibraryState>
  >({
    workbook: { items: [], loading: false, error: null },
    template: { items: [], loading: false, error: null },
    mapping: { items: [], loading: false, error: null },
    coordinates: { items: [], loading: false, error: null },
    template_config: { items: [], loading: false, error: null },
  });
  const [workbookFile, setWorkbookFile] = useState<UploadedFile | null>(null);
  const [templateFile, setTemplateFile] = useState<UploadedFile | null>(null);
  const [masterTemplatePages, setMasterTemplatePages] = useState<
    MasterTemplatePageDraft[]
  >([]);
  const [masterTemplateSelection, setMasterTemplateSelection] =
    useState<MasterTemplateSelectionDraft>({
      projectTypeField: DEFAULT_PROJECT_TYPE_FIELD,
      productTypeField: DEFAULT_PRODUCT_TYPE_FIELD,
      projectTypes: DEFAULT_MASTER_TEMPLATE_PROJECT_TYPES,
      sectionOrder: DEFAULT_MASTER_TEMPLATE_SECTION_ORDER,
    });
  const [selectedMasterPageId, setSelectedMasterPageId] = useState<string | null>(
    null
  );
  const [templateDropSectionKey, setTemplateDropSectionKey] =
    useState<MasterTemplateSectionKey | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [cellPreviews, setCellPreviews] = useState<CellPreviewMap>({});
  const [workbookLoading, setWorkbookLoading] = useState(false);
  const [workbookError, setWorkbookError] = useState<string | null>(null);
  const [workbookLoaded, setWorkbookLoaded] = useState(false);
  const [workbookWorkerReady, setWorkbookWorkerReady] = useState(false);
  const [previewPage, setPreviewPage] = useState("page_1");
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridSize, setGridSize] = useState(10);
  const [nudgeStep, setNudgeStep] = useState(1);
  const [templatePageCount, setTemplatePageCount] = useState(0);
  const [pageNumberToAdd, setPageNumberToAdd] = useState("");
  const [fieldToAdd, setFieldToAdd] = useState("");
  const [customFieldToAdd, setCustomFieldToAdd] = useState("");
  const [fieldSearch, setFieldSearch] = useState("");
  const [bindingSearch, setBindingSearch] = useState("");
  const [coordsEditorError, setCoordsEditorError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateVersion, setTemplateVersion] = useState(1);
  const [templateDescription, setTemplateDescription] = useState("");
  const [editingTemplateKey, setEditingTemplateKey] = useState<string | null>(
    null
  );
  const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateSaveStatus, setTemplateSaveStatus] = useState<string | null>(
    null
  );
  const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [mappingConfig, setMappingConfig] = useState<MappingConfig>(() =>
    cloneJson(mappingDefault as MappingConfig)
  );
  const [coordsConfig, setCoordsConfig] = useState<CoordsConfig>(() =>
    cloneJson(coordinatesDefault as CoordsConfig)
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const activeTemplateConfigItem = useMemo(
    () => getMostRecentLibraryItem(libraries.template_config.items),
    [libraries.template_config.items]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const embeddedParam = new URLSearchParams(window.location.search).get(
      "embedded"
    );
    setIsEmbedded(embeddedParam === "1");
  }, []);

  const emailAddress = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? "";
  const emailDomain = emailAddress.split("@")[1] ?? "";
  const primaryOwnerEmail = (
    process.env.NEXT_PUBLIC_PRIMARY_OWNER_EMAIL ??
    "jr@cornerstonecompaniesfl.com"
  )
    .trim()
    .toLowerCase();
  const isPrimaryOwner = Boolean(
    emailAddress && emailAddress === primaryOwnerEmail
  );
  const allowedDomain = (
    process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "cornerstonecompaniesfl.com"
  )
    .trim()
    .toLowerCase();
  const preferredOrgTeamName = (
    process.env.NEXT_PUBLIC_ORG_TEAM_NAME ?? "CORNERSTONE"
  ).trim();
  const normalizedOrgTeamName = preferredOrgTeamName.toLowerCase();
  const teamDomain = (allowedDomain || emailDomain || "").trim();
  const teamLookupDomain = teamDomain || "__none__";

  const teamQuery = instantAppId
    ? {
        teams: {
          $: {
            where: { domain: teamLookupDomain },
            order: { createdAt: "desc" as const },
          },
          memberships: { user: {} },
          vendors: {},
        },
      }
    : { teams: { $: { where: { domain: "__none__" } } } };
  const { data: teamData } = db.useQuery(teamQuery);
  const teams = teamData?.teams ?? [];
  const orgTeam = useMemo(() => {
    if (!teams.length) return null;
    const rootTeams = teams.filter((team) => !team.parentTeamId);
    const candidates = rootTeams.length ? rootTeams : teams;
    const namedTeam = normalizedOrgTeamName
      ? candidates.find(
          (team) =>
            team.name?.trim().toLowerCase() === normalizedOrgTeamName
        )
      : null;
    if (namedTeam) return namedTeam;
    const primary = candidates.find((team) => team.isPrimary);
    if (primary) return primary;
    return candidates.reduce((oldest, team) => {
      if (!oldest) return team;
      const oldestTime = oldest.createdAt ?? 0;
      const teamTime = team.createdAt ?? 0;
      return teamTime < oldestTime ? team : oldest;
    }, null as (typeof teams)[number] | null);
  }, [teams, normalizedOrgTeamName]);
  const orgMembership = orgTeam?.memberships?.find(
    (membership) => membership.user?.id === instantUser?.id
  );
  const orgRole = String(orgMembership?.role ?? "")
    .trim()
    .toLowerCase();
  const isOrgOwner = Boolean(
    isPrimaryOwner ||
      (orgTeam?.ownerId && orgTeam.ownerId === instantUser?.id) ||
      orgRole === "owner"
  );
  const hasTeamAdminAccess = Boolean(isOrgOwner || orgRole === "admin");
  const vendorRuleOptions = useMemo(() => {
    const source = orgTeam?.vendors ?? [];
    return source
      .filter((vendor) => vendor?.isActive !== false && vendor?.name)
      .map((vendor, index) => ({
        id:
          typeof vendor.id === "string" && vendor.id.trim()
            ? vendor.id
            : `${vendor.name}-${index + 1}`,
        name: String(vendor.name),
        sortOrder: typeof vendor.sortOrder === "number" ? vendor.sortOrder : index,
      }))
      .sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }
        return left.name.localeCompare(right.name);
      });
  }, [orgTeam?.vendors]);

  const progressSteps = useMemo(
    () => [
      { label: "Downloading workbook", value: 0.2 },
      { label: "Downloading template", value: 0.4 },
      { label: "Reading Excel data", value: 0.58 },
      { label: "Stamping PDF pages", value: 0.78 },
      { label: "Finalizing download", value: 0.9 },
    ],
    []
  );

  useEffect(() => {
    if (!isGenerating) {
      setProgress(0);
      setProgressLabel(null);
      return;
    }

    let stepIndex = 0;
    setProgress(progressSteps[0].value);
    setProgressLabel(progressSteps[0].label);

    const interval = window.setInterval(() => {
      stepIndex += 1;
      if (stepIndex >= progressSteps.length) {
        window.clearInterval(interval);
        return;
      }
      setProgress(progressSteps[stepIndex].value);
      setProgressLabel(progressSteps[stepIndex].label);
    }, 900);

    return () => window.clearInterval(interval);
  }, [isGenerating, progressSteps]);

  const fontOptions = useMemo(() => {
    const customFonts = Object.keys(coordsConfig.fonts ?? {});
    return [...new Set(["WorkSans", "Helvetica", ...customFonts])];
  }, [coordsConfig.fonts]);

  useEffect(() => {
    if (!hasTeamAdminAccess) return;
    if (typeof window === "undefined") return;
    try {
      const worker = new Worker(
        new URL("../../lib/workbook-worker.ts", import.meta.url),
        { type: "module" }
      );
      workbookWorkerRef.current = worker;
      setWorkbookWorkerReady(true);

      worker.onmessage = (event) => {
        const data = event.data;
        if (data?.type === "loaded") {
          setSheetNames(Array.isArray(data.sheetNames) ? data.sheetNames : []);
          setWorkbookLoaded(true);
          setWorkbookLoading(false);
          setWorkbookError(null);
          return;
        }
        if (data?.type === "cells") {
          const results = Array.isArray(data.results) ? data.results : [];
          const nextMap: CellPreviewMap = {};
          results.forEach((result: { key?: string; value?: unknown }) => {
            if (!result?.key) return;
            nextMap[result.key] = result.value ?? null;
          });
          setCellPreviews(nextMap);
          return;
        }
        if (data?.type === "error") {
          setWorkbookError(data.error ?? "Failed to parse workbook.");
          setWorkbookLoaded(false);
          setWorkbookLoading(false);
        }
      };

      worker.onerror = () => {
        setWorkbookError("Failed to parse workbook.");
        setWorkbookLoaded(false);
        setWorkbookLoading(false);
      };

      return () => {
        worker.terminate();
        workbookWorkerRef.current = null;
        setWorkbookWorkerReady(false);
      };
    } catch (error) {
      console.error(error);
      setWorkbookError("Workbook reader failed to start.");
      setWorkbookWorkerReady(false);
    }
  }, [hasTeamAdminAccess]);

  useEffect(() => {
    const controller = new AbortController();
    if (!workbookFile?.url || !workbookWorkerRef.current || !workbookWorkerReady) {
      setSheetNames([]);
      setCellPreviews({});
      setWorkbookLoaded(false);
      setWorkbookLoading(false);
      setWorkbookError(null);
      workbookWorkerRef.current?.postMessage({ type: "clear" });
      return () => controller.abort();
    }

    const loadWorkbook = async () => {
      setWorkbookLoading(true);
      setWorkbookError(null);
      setWorkbookLoaded(false);
      setSheetNames([]);
      setCellPreviews({});
      try {
        const response = await fetch(workbookFile.url, {
          signal: controller.signal,
        });
        const buffer = await response.arrayBuffer();
        workbookWorkerRef.current?.postMessage(
          { type: "load", data: buffer },
          [buffer]
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setWorkbookError("Failed to download workbook.");
        setWorkbookLoading(false);
      }
    };

    void loadWorkbook();
    return () => controller.abort();
  }, [workbookFile?.url, workbookWorkerReady]);

  useEffect(() => {
    if (!workbookWorkerRef.current || !workbookLoaded) return;
    const requests = Object.entries(mappingConfig.fields).map(
      ([fieldName, field]) => ({
        key: fieldName,
        sheet: field.sheet,
        cell: field.cell,
      })
    );
    workbookWorkerRef.current.postMessage({ type: "getCells", requests });
  }, [mappingConfig, workbookLoaded]);

  useEffect(() => {
    if (!templateFile?.name || templateName.trim()) return;
    const baseName = templateFile.name.replace(/\.[^.]+$/, "");
    setTemplateName(baseName);
  }, [templateFile?.name, templateName]);

  useEffect(() => {
    if (!templateFile?.url) {
      setTemplatePageCount(0);
    }
  }, [templateFile?.url]);

  useEffect(() => {
    if (!editingTemplateKey) {
      setTemplateVersion(1);
    }
  }, [editingTemplateKey, templateFile?.url]);

  const previewLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    const preparedByMap = mappingConfig.prepared_by_map ?? {};
    const missingValue = String(mappingConfig.missing_value ?? "");
    const coordsPageKey =
      masterTemplatePages.find((page) => page.id === selectedMasterPageId)
        ?.coordsPageKey ?? previewPage;
    const fields =
      (coordsConfig[coordsPageKey] as Record<string, CoordField>) ?? {};
    Object.keys(fields).forEach((fieldName) => {
      let raw = cellPreviews[fieldName];
      let format = mappingConfig.fields?.[fieldName]?.format;
      if (raw === undefined && fieldName === "plan_set_date_line") {
        raw = cellPreviews.plan_set_date;
        format = mappingConfig.fields?.plan_set_date?.format ?? "date_plan";
      }
      const formatted = formatPreviewValue(
        raw,
        format,
        preparedByMap,
        missingValue
      );
      map[fieldName] = formatted ?? missingValue;
    });
    return map;
  }, [
    coordsConfig,
    cellPreviews,
    mappingConfig,
    masterTemplatePages,
    selectedMasterPageId,
    previewPage,
  ]);

  useEffect(() => {
    if (!hasTeamAdminAccess) return;
    (Object.keys(LIBRARY_CONFIG) as AdminLibraryType[]).forEach((type) => {
      void loadLibrary(type);
    });
  }, [hasTeamAdminAccess]);

  const handleGenerate = async () => {
    setCalibrationError(null);
    const masterTemplate = buildMasterTemplateConfig(
      masterTemplatePages,
      masterTemplateSelection
    );
    const hasMasterPages = masterTemplate.pages.length > 0;
    if (!workbookFile) {
      setCalibrationError("Upload the workbook before generating.");
      return;
    }
    if (!templateFile && !hasMasterPages) {
      setCalibrationError("Select a template PDF or configure master template pages.");
      return;
    }

    setIsGenerating(true);
    setProgress(0.1);
    setProgressLabel("Starting generation");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workbookUrl: workbookFile.url,
          templatePdfUrl: templateFile?.url,
          masterTemplate: hasMasterPages ? masterTemplate : undefined,
          mappingOverride: mappingConfig,
          coordsOverride: coordsConfig,
        }),
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        let message = "Failed to generate PDF.";
        if (contentType.includes("application/json")) {
          const data = await response.json();
          message = data?.error || message;
        } else {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "Cornerstone Proposal - Filled.pdf";
      link.click();
      window.URL.revokeObjectURL(url);
      setProgress(1);
      setProgressLabel("Download ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setCalibrationError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveTemplate = async () => {
    setTemplateSaveError(null);
    setTemplateSaveStatus(null);
    setTemplateLoadError(null);
    if (!templateName.trim()) {
      setTemplateSaveError("Template name is required.");
      return;
    }
    const masterTemplate = buildMasterTemplateConfig(
      masterTemplatePages,
      masterTemplateSelection
    );
    const hasMasterPages = masterTemplate.pages.length > 0;
    const hasTemplatePdf = Boolean(templateFile?.url);
    if (!hasTemplatePdf && !hasMasterPages) {
      setTemplateSaveError(
        "Select a template PDF or create at least one master template page."
      );
      return;
    }
    if (
      hasMasterPages &&
      !hasTemplatePdf &&
      masterTemplate.pages.some((page) => !page.sourcePdf?.url)
    ) {
      setTemplateSaveError(
        "Each master page needs a source PDF when no base template PDF is selected."
      );
      return;
    }
    const nextTemplateVersion = editingTemplateKey
      ? Math.max(templateVersion + 1, 2)
      : 1;

    setTemplateSaving(true);
    try {
      const response = await fetch("/api/template-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName.trim(),
          templateVersion: nextTemplateVersion,
          description: templateDescription.trim() || undefined,
          templatePdf: hasTemplatePdf ? templateFile : undefined,
          masterTemplate: hasMasterPages ? masterTemplate : undefined,
          coords: coordsConfig,
          mapping: mappingConfig,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = data?.error || "Failed to save template.";
        throw new Error(message);
      }
      const data = await response.json();
      const savedKey = data?.item?.key as string | undefined;
      if (savedKey) {
        setEditingTemplateKey(savedKey);
        const oldTemplateKeys = libraries.template_config.items
          .map((item) => item.key)
          .filter((key) => key !== savedKey);
        for (const key of oldTemplateKeys) {
          await deleteItem("template_config", key);
        }
      }
      setTemplateVersion(nextTemplateVersion);
      setTemplateSaveStatus(
        editingTemplateKey
          ? `Template updated to v${nextTemplateVersion}.`
          : "Template saved as v1."
      );
      setTemplateDescription("");
      void loadLibrary("template_config");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setTemplateSaveError(message);
    } finally {
      setTemplateSaving(false);
    }
  };

  const handleLoadTemplateConfig = useCallback(async (item: LibraryItem) => {
    setTemplateLoadError(null);
    setTemplateSaveStatus(null);
    setTemplateLoading(true);
    try {
      const response = await fetch(item.url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load template configuration.");
      }
      const data = (await response.json()) as {
        name?: string;
        templateVersion?: number;
        description?: string;
        templatePdf?: { name?: string; url?: string };
        masterTemplate?: MasterTemplateConfig;
        coords?: Record<string, any>;
        mapping?: Record<string, any>;
      };
      if (
        !data?.coords ||
        (!data?.templatePdf?.url && !data?.masterTemplate?.pages?.length)
      ) {
        throw new Error("Template configuration is incomplete.");
      }
      setTemplateName(data.name ?? "");
      setTemplateVersion(
        Number.isFinite(Number(data.templateVersion)) &&
          Number(data.templateVersion) > 0
          ? Math.trunc(Number(data.templateVersion))
          : 1
      );
      setTemplateDescription(data.description ?? "");
      setTemplateFile(
        data.templatePdf?.url
          ? {
              name: data.templatePdf.name ?? "template.pdf",
              url: data.templatePdf.url,
            }
          : null
      );
      if (data.coords) {
        setCoordsConfig(data.coords);
      }
      if (data.mapping) {
        setMappingConfig(data.mapping as MappingConfig);
      }
      const loadedMasterPages = normalizeLoadedMasterTemplatePages(
        data.masterTemplate,
        data.coords,
        data.templatePdf?.url
          ? {
              name: data.templatePdf?.name ?? "template.pdf",
              url: data.templatePdf.url,
            }
          : null
      );
      const loadedSelection = normalizeLoadedMasterTemplateSelection(
        data.masterTemplate
      );
      setMasterTemplatePages(loadedMasterPages);
      setMasterTemplateSelection(loadedSelection);
      setSelectedMasterPageId(loadedMasterPages[0]?.id ?? null);
      setEditingTemplateKey(item.key);
      setTemplateSaveStatus("Template loaded for editing.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setTemplateLoadError(message);
    } finally {
      setTemplateLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeTemplateConfigItem) return;
    if (templateLoading || templateSaving) return;
    if (editingTemplateKey === activeTemplateConfigItem.key) return;
    void handleLoadTemplateConfig(activeTemplateConfigItem);
  }, [
    activeTemplateConfigItem,
    editingTemplateKey,
    handleLoadTemplateConfig,
    templateLoading,
    templateSaving,
  ]);

  const handleCalibrationPdf = async () => {
    setCalibrationError(null);
    if (!templateFile) {
      setCalibrationError("Upload the template PDF to generate calibration.");
      return;
    }

    try {
      const response = await fetch("/api/calibrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templatePdfUrl: templateFile.url,
          coordsOverride: coordsConfig,
          gridSize: 50,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = data?.error || "Failed to create calibration PDF.";
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "Cornerstone Calibration.pdf";
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setCalibrationError(message);
    }
  };

  const handleDownloadJson = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const updateMappingField = (
    field: string,
    updates: Partial<MappingField>
  ) => {
    setMappingConfig((prev) => ({
      ...prev,
      fields: {
        ...prev.fields,
        [field]: {
          ...prev.fields[field],
          ...updates,
        },
      },
    }));
  };

  const updateCoordField = (
    pageKey: string,
    field: string,
    updates: Partial<CoordField>
  ) => {
    setCoordsConfig((prev) => ({
      ...prev,
      [pageKey]: {
        ...(prev[pageKey] ?? {}),
        [field]: {
          ...(prev[pageKey] as Record<string, CoordField>)[field],
          ...updates,
        },
      },
    }));
  };

  const nudgeSelectedField = (dx: number, dy: number) => {
    if (!selectedField) return;
    const coordsPageKey =
      masterTemplatePages.find((page) => page.id === selectedMasterPageId)
        ?.coordsPageKey ?? previewPage;
    const fields = coordsConfig[coordsPageKey] as
      | Record<string, CoordField>
      | undefined;
    const current = fields?.[selectedField];
    if (!current) return;
    const nextX = (current.x ?? 0) + dx;
    const nextY = (current.y ?? 0) + dy;
    updateCoordField(coordsPageKey, selectedField, { x: nextX, y: nextY });
  };

  const snapSelectedField = () => {
    if (!selectedField || gridSize <= 0) return;
    const coordsPageKey =
      masterTemplatePages.find((page) => page.id === selectedMasterPageId)
        ?.coordsPageKey ?? previewPage;
    const fields = coordsConfig[coordsPageKey] as
      | Record<string, CoordField>
      | undefined;
    const current = fields?.[selectedField];
    if (!current) return;
    const nextX = snapToGridValue(current.x ?? 0, gridSize);
    const nextY = snapToGridValue(current.y ?? 0, gridSize);
    updateCoordField(coordsPageKey, selectedField, { x: nextX, y: nextY });
  };

  const configuredPageKeys = useMemo(
    () => getSortedPageKeys(coordsConfig),
    [coordsConfig]
  );
  const templatePageKeys = useMemo(() => {
    if (!templatePageCount || templatePageCount < 1) return [];
    return Array.from({ length: templatePageCount }, (_, index) =>
      toPageKey(index + 1)
    );
  }, [templatePageCount]);
  const pageKeys = useMemo(() => {
    const merged = new Set<string>([
      ...configuredPageKeys,
      ...templatePageKeys,
    ]);
    return Array.from(merged).sort((left, right) => {
      const leftPage = parsePageKey(left) ?? 0;
      const rightPage = parsePageKey(right) ?? 0;
      return leftPage - rightPage;
    });
  }, [configuredPageKeys, templatePageKeys]);
  const masterTemplateProjectTypeOptions = useMemo(
    () =>
      normalizeMasterTemplateProjectTypes(
        masterTemplateSelection.projectTypes,
        []
      ),
    [masterTemplateSelection.projectTypes]
  );
  const activeMasterPage = useMemo(
    () =>
      masterTemplatePages.find((page) => page.id === selectedMasterPageId) ?? null,
    [masterTemplatePages, selectedMasterPageId]
  );
  const activeProjectTypeRuleValue = String(
    activeMasterPage?.conditionValue ?? ""
  ).trim();
  const activeProjectTypeRuleHasLegacyValue =
    Boolean(activeProjectTypeRuleValue) &&
    !masterTemplateProjectTypeOptions.includes(activeProjectTypeRuleValue);
  const activeCoordsPageKey = activeMasterPage?.coordsPageKey ?? previewPage;
  const previewDocumentUrl = activeMasterPage?.sourcePdf?.url ?? templateFile?.url;
  const previewDocumentPageKey = toPageKey(
    activeMasterPage?.sourcePage ?? parsePageKey(previewPage) ?? 1
  );
  const previewPageFields = useMemo(
    () =>
      ((coordsConfig[activeCoordsPageKey] as
        | Record<string, CoordField>
        | undefined) ??
      {}) as Record<string, CoordField>,
    [coordsConfig, activeCoordsPageKey]
  );
  const selectedFieldSpec = selectedField
    ? previewPageFields[selectedField]
    : undefined;
  const availableStampFields = useMemo(() => {
    const result: string[] = [];
    const seen = new Set<string>();

    const addField = (fieldName: string) => {
      const normalized = String(fieldName ?? "").trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      result.push(normalized);
    };

    Object.keys(mappingConfig.fields ?? {}).forEach(addField);
    addField("plan_set_date_line");
    pageKeys.forEach((pageKey) => {
      const fields =
        (coordsConfig[pageKey] as Record<string, CoordField> | undefined) ?? {};
      Object.keys(fields).forEach(addField);
    });
    return result;
  }, [coordsConfig, mappingConfig.fields, pageKeys]);
  const filteredFieldCatalog = useMemo(() => {
    const query = fieldSearch.trim().toLowerCase();
    if (!query) return availableStampFields;
    return availableStampFields.filter((fieldName) =>
      fieldName.toLowerCase().includes(query)
    );
  }, [availableStampFields, fieldSearch]);
  const filteredBindingCatalog = useMemo(() => {
    const query = bindingSearch.trim().toLowerCase();
    if (!query) return availableStampFields;
    return availableStampFields.filter((fieldName) =>
      fieldName.toLowerCase().includes(query)
    );
  }, [availableStampFields, bindingSearch]);
  const masterTemplatePagesBySection = useMemo(() => {
    const orderedSections = [
      ...masterTemplateSelection.sectionOrder,
      "custom" as const,
    ];
    const seen = new Set<MasterTemplateSectionKey>();
    return orderedSections
      .filter((section) => {
        if (seen.has(section)) return false;
        seen.add(section);
        return true;
      })
      .map((sectionKey) => ({
        sectionKey,
        pages: masterTemplatePages
          .filter((page) => (page.sectionKey ?? "custom") === sectionKey)
          .slice()
          .sort((left, right) => left.order - right.order),
      }));
  }, [masterTemplatePages, masterTemplateSelection.sectionOrder]);
  const draggableTemplatePdfs = useMemo(() => {
    const seen = new Set<string>();
    const result: UploadedFile[] = [];
    const add = (file: UploadedFile | null | undefined) => {
      if (!file?.url) return;
      if (seen.has(file.url)) return;
      seen.add(file.url);
      result.push(file);
    };
    add(templateFile);
    libraries.template.items.forEach((item) => {
      add({ name: item.name, url: item.url });
    });
    return result;
  }, [libraries.template.items, templateFile]);

  const addPage = (pageNumber: number) => {
    const pageKey = toPageKey(pageNumber);
    setCoordsConfig((prev) => {
      if (prev[pageKey]) return prev;
      return {
        ...prev,
        [pageKey]: {},
      };
    });
    setPreviewPage(pageKey);
    setCoordsEditorError(null);
  };

  const updateMasterTemplatePage = (
    pageId: string,
    updates: Partial<MasterTemplatePageDraft>
  ) => {
    const nextCoordsPageKey =
      typeof updates.coordsPageKey === "string"
        ? updates.coordsPageKey.trim()
        : "";
    if (nextCoordsPageKey && parsePageKey(nextCoordsPageKey)) {
      setCoordsConfig((prev) => {
        if (prev[nextCoordsPageKey]) return prev;
        return {
          ...prev,
          [nextCoordsPageKey]: {},
        };
      });
    }
    setMasterTemplatePages((prev) =>
      prev.map((page) => {
        if (page.id !== pageId) return page;
        return { ...page, ...updates };
      })
    );
  };

  const addMasterTemplatePage = (options?: {
    sectionKey?: MasterTemplateSectionKey;
    sourcePdf?: UploadedFile;
  }) => {
    const highestPage = pageKeys.reduce((max, pageKey) => {
      const pageNumber = parsePageKey(pageKey) ?? 0;
      return Math.max(max, pageNumber);
    }, 0);
    const nextPageNumber = highestPage + 1;
    const nextCoordsPageKey = toPageKey(nextPageNumber);
    const nextSection =
      options?.sectionKey ??
      masterTemplateSelection.sectionOrder[masterTemplatePages.length] ??
      "custom";
    const sourcePdf = options?.sourcePdf ?? templateFile ?? undefined;
    const nextInclusionMode: MasterTemplateInclusionMode =
      nextSection === "product"
        ? "product_type"
        : nextSection === "custom"
          ? "always"
          : "project_type";
    addPage(nextPageNumber);
    const nextPage: MasterTemplatePageDraft = {
      id: makeId(),
      title: sourcePdf?.name || `Page ${nextPageNumber}`,
      order: masterTemplatePages.length + 1,
      coordsPageKey: nextCoordsPageKey,
      sourcePdf,
      sourcePage: 1,
      sectionKey: nextSection,
      inclusionMode: nextInclusionMode,
      isFallback: false,
      dataBindings: [],
    };
    setMasterTemplatePages((prev) => [...prev, nextPage]);
    setSelectedMasterPageId(nextPage.id);
  };

  const removeMasterTemplatePage = (pageId: string) => {
    setMasterTemplatePages((prev) => {
      const next = prev
        .filter((page) => page.id !== pageId)
        .map((page, index) => ({ ...page, order: index + 1 }));
      return next;
    });
    setSelectedMasterPageId((prev) => (prev === pageId ? null : prev));
  };

  const moveMasterTemplatePage = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setMasterTemplatePages((prev) => {
      const sourceIndex = prev.findIndex((page) => page.id === sourceId);
      const targetIndex = prev.findIndex((page) => page.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return prev;
      const next = prev.slice();
      const [moved] = next.splice(sourceIndex, 1);
      if (!moved) return prev;
      next.splice(targetIndex, 0, moved);
      return next.map((page, index) => ({ ...page, order: index + 1 }));
    });
  };

  const moveMasterTemplatePageInSection = (
    sectionKey: MasterTemplateSectionKey,
    pageId: string,
    direction: "up" | "down"
  ) => {
    const pagesInSection = masterTemplatePages
      .filter((page) => (page.sectionKey ?? "custom") === sectionKey)
      .slice()
      .sort((left, right) => left.order - right.order);
    const index = pagesInSection.findIndex((page) => page.id === pageId);
    if (index < 0) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= pagesInSection.length) return;
    const targetPage = pagesInSection[targetIndex];
    if (!targetPage) return;
    moveMasterTemplatePage(pageId, targetPage.id);
  };

  const moveMasterTemplateSection = (
    section: MasterTemplateSectionKey,
    direction: "up" | "down"
  ) => {
    setMasterTemplateSelection((prev) => {
      const sourceIndex = prev.sectionOrder.findIndex((entry) => entry === section);
      if (sourceIndex < 0) return prev;
      const targetIndex = direction === "up" ? sourceIndex - 1 : sourceIndex + 1;
      if (targetIndex < 0 || targetIndex >= prev.sectionOrder.length) {
        return prev;
      }
      const nextOrder = prev.sectionOrder.slice();
      const [moved] = nextOrder.splice(sourceIndex, 1);
      if (!moved) return prev;
      nextOrder.splice(targetIndex, 0, moved);
      return {
        ...prev,
        sectionOrder: nextOrder,
      };
    });
  };

  const updateMasterTemplateProjectType = (index: number, nextValue: string) => {
    setMasterTemplateSelection((prev) => {
      if (index < 0 || index >= prev.projectTypes.length) return prev;
      const nextProjectTypes = prev.projectTypes.slice();
      nextProjectTypes[index] = nextValue;
      return {
        ...prev,
        projectTypes: nextProjectTypes,
      };
    });
  };

  const addMasterTemplateProjectType = () => {
    setMasterTemplateSelection((prev) => ({
      ...prev,
      projectTypes: [...prev.projectTypes, ""],
    }));
  };

  const removeMasterTemplateProjectType = (index: number) => {
    setMasterTemplateSelection((prev) => {
      if (prev.projectTypes.length <= 1) return prev;
      if (index < 0 || index >= prev.projectTypes.length) return prev;
      const nextProjectTypes = prev.projectTypes.filter(
        (_, entryIndex) => entryIndex !== index
      );
      return {
        ...prev,
        projectTypes: nextProjectTypes,
      };
    });
  };

  const handleTemplateDragStart = (
    event: DragEvent<HTMLElement>,
    sourcePdf: UploadedFile
  ) => {
    event.dataTransfer.setData(
      MASTER_TEMPLATE_TEMPLATE_MIME,
      JSON.stringify(sourcePdf)
    );
    event.dataTransfer.setData("text/plain", sourcePdf.name);
    event.dataTransfer.effectAllowed = "copy";
  };

  const handleTemplateDropToSection = (
    event: DragEvent<HTMLElement>,
    sectionKey: MasterTemplateSectionKey
  ) => {
    event.preventDefault();
    setTemplateDropSectionKey(null);
    const payload = event.dataTransfer.getData(MASTER_TEMPLATE_TEMPLATE_MIME);
    if (!payload) return;
    try {
      const parsed = JSON.parse(payload) as { name?: unknown; url?: unknown };
      const name = String(parsed?.name ?? "").trim();
      const url = String(parsed?.url ?? "").trim();
      if (!name || !url) return;
      addMasterTemplatePage({
        sectionKey,
        sourcePdf: { name, url },
      });
    } catch {
      // Ignore invalid drag payloads.
    }
  };

  const handleCalibrationFieldDragStart = (
    event: DragEvent<HTMLElement>,
    fieldName: string
  ) => {
    event.dataTransfer.setData(CALIBRATION_FIELD_MIME, fieldName);
    event.dataTransfer.setData("text/plain", fieldName);
    event.dataTransfer.effectAllowed = "copy";
  };

  const toggleActiveMasterPageBinding = (fieldName: string) => {
    if (!activeMasterPage) return;
    const binding = String(fieldName ?? "").trim();
    if (!binding) return;
    const currentBindings = Array.isArray(activeMasterPage.dataBindings)
      ? activeMasterPage.dataBindings
      : [];
    const nextBindings = currentBindings.includes(binding)
      ? currentBindings.filter((entry) => entry !== binding)
      : [...currentBindings, binding];
    updateMasterTemplatePage(activeMasterPage.id, {
      dataBindings: nextBindings,
    });
  };

  const placeBindingOnActiveMasterPage = (
    fieldName: string,
    placement?: { x: number; y: number }
  ) => {
    if (!activeMasterPage) return;
    const binding = String(fieldName ?? "").trim();
    if (!binding) return;
    const currentBindings = Array.isArray(activeMasterPage.dataBindings)
      ? activeMasterPage.dataBindings
      : [];
    if (!currentBindings.includes(binding)) {
      updateMasterTemplatePage(activeMasterPage.id, {
        dataBindings: [...currentBindings, binding],
      });
    }
    addFieldToCurrentPage(binding, placement);
  };

  const addFieldToCurrentPage = (
    fieldName: string,
    placement?: { x: number; y: number }
  ) => {
    const nextField = String(fieldName ?? "").trim();
    if (!nextField) {
      setCoordsEditorError("Enter or select a field key to add.");
      return;
    }
    if (!parsePageKey(activeCoordsPageKey)) {
      setCoordsEditorError("Select a valid page before adding fields.");
      return;
    }
    setCoordsConfig((prev) => {
      const page =
        (prev[activeCoordsPageKey] as Record<string, CoordField> | undefined) ??
        {};
      if (page[nextField]) {
        if (!placement) return prev;
        return {
          ...prev,
          [activeCoordsPageKey]: {
            ...page,
            [nextField]: {
              ...page[nextField],
              x: placement.x,
              y: placement.y,
            },
          },
        };
      }
      return {
        ...prev,
        [activeCoordsPageKey]: {
          ...page,
          [nextField]: {
            x: placement?.x ?? 36,
            y: placement?.y ?? 36,
            size: 10,
            align: "left",
            font: "WorkSans",
            color: "#111111",
          },
        },
      };
    });
    setSelectedField(nextField);
    setFieldToAdd(nextField);
    setCustomFieldToAdd("");
    setCoordsEditorError(null);
  };

  const removeSelectedField = () => {
    if (!selectedField) return;
    setCoordsConfig((prev) => {
      const page =
        (prev[activeCoordsPageKey] as Record<string, CoordField> | undefined) ??
        {};
      if (!page[selectedField]) return prev;
      const nextPage = { ...page };
      delete nextPage[selectedField];
      return {
        ...prev,
        [activeCoordsPageKey]: nextPage,
      };
    });
    setSelectedField(null);
    setCoordsEditorError(null);
  };

  const removeCurrentPage = () => {
    if (!parsePageKey(activeCoordsPageKey)) return;
    setCoordsConfig((prev) => {
      if (!prev[activeCoordsPageKey]) return prev;
      const next = { ...prev };
      delete next[activeCoordsPageKey];
      return next;
    });
    setCoordsEditorError(null);
  };

  const addAllTemplatePages = () => {
    if (!templatePageCount || templatePageCount < 1) {
      setCoordsEditorError(
        "Load a template PDF preview first so page count can be detected."
      );
      return;
    }
    setCoordsConfig((prev) => {
      const next = { ...prev };
      for (let page = 1; page <= templatePageCount; page += 1) {
        const pageKey = toPageKey(page);
        if (!next[pageKey]) {
          next[pageKey] = {};
        }
      }
      return next;
    });
    setCoordsEditorError(null);
  };

  useEffect(() => {
    if (pageKeys.length === 0) {
      setSelectedField(null);
      return;
    }
    if (!pageKeys.includes(previewPage)) {
      setPreviewPage(pageKeys[0]);
    }
  }, [pageKeys, previewPage]);

  useEffect(() => {
    if (!masterTemplatePages.length) {
      setSelectedMasterPageId(null);
      return;
    }
    if (
      !selectedMasterPageId ||
      !masterTemplatePages.some((page) => page.id === selectedMasterPageId)
    ) {
      setSelectedMasterPageId(masterTemplatePages[0].id);
    }
  }, [masterTemplatePages, selectedMasterPageId]);

  useEffect(() => {
    if (!activeMasterPage?.coordsPageKey) return;
    if (!pageKeys.includes(activeMasterPage.coordsPageKey)) return;
    if (previewPage !== activeMasterPage.coordsPageKey) {
      setPreviewPage(activeMasterPage.coordsPageKey);
    }
  }, [activeMasterPage?.coordsPageKey, previewPage, pageKeys]);

  useEffect(() => {
    const fieldNames = Object.keys(previewPageFields);
    if (fieldNames.length === 0) {
      setSelectedField(null);
      return;
    }
    if (!selectedField || !fieldNames.includes(selectedField)) {
      setSelectedField(fieldNames[0]);
    }
  }, [previewPageFields, selectedField]);

  useEffect(() => {
    if (!availableStampFields.length) {
      setFieldToAdd("");
      return;
    }
    if (!fieldToAdd || !availableStampFields.includes(fieldToAdd)) {
      setFieldToAdd(availableStampFields[0]);
    }
  }, [availableStampFields, fieldToAdd]);

  const handlePdfDocumentInfo = useCallback(
    (info: { pageCount: number }) => {
      const nextCount = Number(info.pageCount ?? 0);
      setTemplatePageCount(nextCount > 0 ? nextCount : 0);
    },
    []
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedField || isTypingTarget(event.target)) return;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        nudgeSelectedField(0, nudgeStep);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        nudgeSelectedField(0, -nudgeStep);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        nudgeSelectedField(-nudgeStep, 0);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        nudgeSelectedField(nudgeStep, 0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedField,
    nudgeStep,
    previewPage,
    coordsConfig,
    snapToGrid,
    gridSize,
    selectedMasterPageId,
    masterTemplatePages,
  ]);

  const renderAccessGate = () => {
    if (!clerkEnabled) {
      return (
        <Card className="border-border/60 bg-card/80 shadow-elevated">
          <CardHeader>
            <CardTitle className="text-2xl font-serif">
              Clerk not configured
            </CardTitle>
            <CardDescription>
              Configure Clerk to protect admin access by team role.
            </CardDescription>
          </CardHeader>
        </Card>
      );
    }

    if (!authLoaded || !isSignedIn) {
      return (
        <Card className="border-border/60 bg-card/80 shadow-elevated">
          <CardHeader>
            <CardTitle className="text-2xl font-serif">
              Sign in required
            </CardTitle>
            <CardDescription>
              Only team owners and admins can access the admin portal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignInButton mode="modal">
              <Button variant="accent" size="sm">
                Sign in with Microsoft
              </Button>
            </SignInButton>
          </CardContent>
        </Card>
      );
    }

    if (instantLoading || !instantUser) {
      return (
        <Card className="border-border/60 bg-card/80 shadow-elevated">
          <CardHeader>
            <CardTitle className="text-2xl font-serif">
              Connecting workspace
            </CardTitle>
            <CardDescription>
              Verifying your team role in InstantDB...
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading access...
          </CardContent>
        </Card>
      );
    }

    if (!hasTeamAdminAccess) {
      return (
        <Card className="border-border/60 bg-card/80 shadow-elevated">
          <CardHeader>
            <CardTitle className="text-2xl font-serif">
              Admin access only
            </CardTitle>
            <CardDescription>
              Ask an organization owner to grant owner/admin team access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              Signed in as {user?.primaryEmailAddress?.emailAddress}
            </div>
          </CardContent>
        </Card>
      );
    }

    return null;
  };

  const accessGate = renderAccessGate();
  const totalLibraryFiles = useMemo(
    () =>
      (Object.keys(libraries) as AdminLibraryType[]).reduce(
        (total, type) => total + libraries[type].items.length,
        0
      ),
    [libraries]
  );

  if (accessGate) {
    return (
      <main className="relative min-h-screen overflow-hidden">
        <InstantAuthSync onAuthError={setInstantSetupError} />
        <div className="container relative py-12 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2">
              <Badge variant="outline" className="bg-background/80">
                Admin Portal
              </Badge>
              <h1 className="text-4xl font-serif">Calibration & File Manager</h1>
            </div>
            {!isEmbedded ? (
              <Button asChild variant="outline">
                <Link href="/team-admin">
                  <ArrowLeft className="h-4 w-4" />
                  Team admin & estimates
                </Link>
              </Button>
            ) : null}
          </div>

          {instantSetupError ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
              Instant auth issue: {instantSetupError}
            </div>
          ) : null}
          {instantAuthError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {instantAuthError.message}
            </div>
          ) : null}
          {accessGate}
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <InstantAuthSync onAuthError={setInstantSetupError} />
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/2 h-80 w-[560px] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute top-20 right-4 h-64 w-64 rounded-full bg-foreground/10 blur-3xl" />
        <div className="absolute -bottom-20 left-10 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />
      </div>
      <div className="container relative py-10">
        <div className="rounded-3xl border border-border/60 bg-card/80 p-6 shadow-elevated">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <Badge variant="outline" className="bg-background/80">
                Admin Portal
              </Badge>
              <h1 className="text-4xl font-serif">Operations & Calibration Studio</h1>
              <p className="text-muted-foreground">
                Manage libraries, calibrate templates, and ship reusable proposal
                configurations.
              </p>
            </div>
            {!isEmbedded ? (
              <Button asChild variant="outline">
                <Link href="/team-admin">
                  <ArrowLeft className="h-4 w-4" />
                  Team admin & estimates
                </Link>
              </Button>
            ) : null}
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Files in library
              </p>
              <p className="mt-1 text-xl font-semibold text-foreground">
                {totalLibraryFiles}
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Saved templates
              </p>
              <p className="mt-1 text-xl font-semibold text-foreground">
                {libraries.template_config.items.length}
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Active role
              </p>
              <p className="mt-1 text-xl font-semibold text-foreground">
                {orgRole === "owner"
                  ? "Owner"
                  : orgRole === "admin"
                    ? "Admin"
                    : "Member"}
              </p>
            </div>
          </div>
        </div>

        {instantSetupError ? (
          <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            Instant auth issue: {instantSetupError}
          </div>
        ) : null}
        {instantAuthError ? (
          <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {instantAuthError.message}
          </div>
        ) : null}

        <Tabs defaultValue="files" className="mt-8">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="files">File Manager</TabsTrigger>
            <TabsTrigger value="calibration">Calibration</TabsTrigger>
          </TabsList>

          <TabsContent value="files" className="mt-6 space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              {(Object.keys(LIBRARY_CONFIG) as AdminLibraryType[]).map(
                (type) => (
                  <LibraryCard
                    key={type}
                    config={LIBRARY_CONFIG[type]}
                    state={libraries[type]}
                    onRefresh={() => loadLibrary(type)}
                    onDeleteAll={() => deleteAll(type)}
                    onDeleteItem={(key) => deleteItem(type, key)}
                  />
                )
              )}
            </div>
          </TabsContent>

          <TabsContent value="calibration" className="mt-6 space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <UploadPickerCard
                title="Workbook"
                description="Upload the Excel workbook to inspect cell values."
                endpoint="workbook"
                selected={workbookFile}
                onUpload={setWorkbookFile}
                onLibraryRefresh={() => loadLibrary("workbook")}
                libraryItems={libraries.workbook.items}
                onSelectLibraryItem={setWorkbookFile}
              />
              <UploadPickerCard
                title="Template PDF"
                description="Upload the PDF template for calibration."
                endpoint="template"
                selected={templateFile}
                onUpload={setTemplateFile}
                onLibraryRefresh={() => loadLibrary("template")}
                libraryItems={libraries.template.items}
                onSelectLibraryItem={setTemplateFile}
              />
            </div>

            <Card className="border-border/60 bg-card/80 shadow-elevated">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">
                  Template Builder
                </CardTitle>
                <CardDescription>
                  Save your master template stack with coordinates, rules, and
                  data mapping as a reusable template.
                </CardDescription>
                <div className="pt-1">
                  <Badge variant="outline" className="bg-background/80">
                    Version v{templateVersion}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs text-muted-foreground">
                      Active template
                    </label>
                    {activeTemplateConfigItem ? (
                      <div className="rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {activeTemplateConfigItem.name}
                        </span>{" "}
                        · Updated{" "}
                        {new Date(activeTemplateConfigItem.uploadedAt).toLocaleString()}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        No template saved yet. Save once to set the active team
                        template.
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      Template name
                    </label>
                    <Input
                      value={templateName}
                      onChange={(event) => setTemplateName(event.target.value)}
                      placeholder="Cornerstone Proposal"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      Description
                    </label>
                    <Input
                      value={templateDescription}
                      onChange={(event) =>
                        setTemplateDescription(event.target.value)
                      }
                      placeholder="Optional internal note"
                    />
                  </div>
                </div>
                {templateLoadError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {templateLoadError}
                  </div>
                ) : null}
                {templateSaveError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {templateSaveError}
                  </div>
                ) : null}
                {templateSaveStatus ? (
                  <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    {templateSaveStatus}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    Base PDF: {templateFile?.name ?? "none selected"}
                  </span>
                  <span>•</span>
                  <span>Template version: v{templateVersion}</span>
                  <span>•</span>
                  <span>{masterTemplatePages.length} master page(s)</span>
                  <span>•</span>
                  <span>{configuredPageKeys.length} configured page(s)</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button variant="accent" onClick={handleSaveTemplate} disabled={templateSaving}>
                    {templateSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileDown className="h-4 w-4" />
                    )}
                    {templateSaving
                      ? "Saving..."
                      : editingTemplateKey
                        ? "Update team template"
                        : "Save team template"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/80 shadow-elevated">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">
                  Master Template Studio
                </CardTitle>
                <CardDescription>
                  Manage section order, project/product-based page routing, and
                  field linking in one place.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="bg-background/80">
                      {masterTemplatePages.length} page
                      {masterTemplatePages.length === 1 ? "" : "s"}
                    </Badge>
                    <Badge variant="outline" className="bg-background/80">
                      {
                        masterTemplatePages.filter(
                          (page) => page.isFallback
                        ).length
                      }{" "}
                      fallback
                    </Badge>
                    <Badge variant="outline" className="bg-background/80">
                      {
                        new Set(
                          masterTemplatePages
                            .map((page) => page.sectionKey)
                            .filter(Boolean)
                        ).size
                      }{" "}
                      sections
                    </Badge>
                  </div>
                </div>
                <div className="grid gap-4 rounded-xl border border-border/60 bg-background/70 p-4 lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="space-y-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Project type routing
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                          Project types table
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={addMasterTemplateProjectType}
                        >
                          <Plus className="h-4 w-4" />
                          Add project type
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {masterTemplateSelection.projectTypes.map(
                          (projectType, index) => (
                            <div
                              key={`project-type-${index}`}
                              className="flex items-center gap-2"
                            >
                              <Input
                                value={projectType}
                                onChange={(event) =>
                                  updateMasterTemplateProjectType(
                                    index,
                                    event.target.value
                                  )
                                }
                                placeholder={`Project type ${index + 1}`}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  removeMasterTemplateProjectType(index)
                                }
                                disabled={
                                  masterTemplateSelection.projectTypes.length <= 1
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Project type rules use this table as dropdown options.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Section order (output pages)
                    </p>
                    <div className="space-y-2">
                      {masterTemplateSelection.sectionOrder.map((section, index) => (
                        <div
                          key={section}
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-2"
                        >
                          <span className="text-xs font-medium text-foreground">
                            {index + 1}. {formatMasterTemplateSectionLabel(section)}
                          </span>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                moveMasterTemplateSection(section, "up")
                              }
                              disabled={index === 0}
                            >
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                moveMasterTemplateSection(section, "down")
                              }
                              disabled={
                                index ===
                                masterTemplateSelection.sectionOrder.length - 1
                              }
                            >
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 xl:grid-cols-[0.65fr_1.35fr]">
                  <div className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-3">
                    <div className="space-y-2 rounded-lg border border-border/60 bg-background/80 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                        Template PDFs
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Drag a template PDF into a section to create an option.
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {draggableTemplatePdfs.length ? (
                          draggableTemplatePdfs.map((file) => (
                            <button
                              key={file.url}
                              type="button"
                              draggable
                              onDragStart={(event) =>
                                handleTemplateDragStart(event, file)
                              }
                              className="rounded-md border border-border/60 bg-background px-2 py-2 text-left text-xs text-foreground hover:border-accent/50"
                            >
                              <span className="line-clamp-2">{file.name}</span>
                            </button>
                          ))
                        ) : (
                          <div className="rounded-md border border-dashed border-border/60 px-2 py-2 text-xs text-muted-foreground sm:col-span-2">
                            Upload template PDFs above, then drag them into sections.
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Section options
                    </p>
                    <ScrollArea className="h-[620px] rounded-lg border border-border/60 bg-background/80">
                      <div className="space-y-3 p-2">
                        {masterTemplatePagesBySection.map((sectionGroup) => (
                          <div
                            key={sectionGroup.sectionKey}
                            className={cn(
                              "space-y-2 rounded-lg border border-border/60 bg-background p-2 transition",
                              templateDropSectionKey === sectionGroup.sectionKey &&
                                "border-accent/70 bg-accent/10"
                            )}
                            onDragOver={(event) => {
                              event.preventDefault();
                              setTemplateDropSectionKey(sectionGroup.sectionKey);
                            }}
                            onDragLeave={() => {
                              setTemplateDropSectionKey((current) =>
                                current === sectionGroup.sectionKey ? null : current
                              );
                            }}
                            onDrop={(event) =>
                              handleTemplateDropToSection(
                                event,
                                sectionGroup.sectionKey
                              )
                            }
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="text-xs font-semibold text-foreground">
                                  {formatMasterTemplateSectionLabel(
                                    sectionGroup.sectionKey
                                  )}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {sectionGroup.pages.length} option
                                  {sectionGroup.pages.length === 1 ? "" : "s"}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  Drop a template PDF here.
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  addMasterTemplatePage({
                                    sectionKey: sectionGroup.sectionKey,
                                  })
                                }
                              >
                                <Plus className="h-4 w-4" />
                                Add option
                              </Button>
                            </div>
                            {sectionGroup.pages.length ? (
                              <div className="space-y-1">
                                {sectionGroup.pages.map((page, index) => (
                                  <div
                                    key={page.id}
                                    className={cn(
                                      "cursor-pointer rounded-md border px-2 py-2 transition",
                                      selectedMasterPageId === page.id
                                        ? "border-accent/70 bg-accent/10"
                                        : "border-border/60 bg-background hover:border-accent/40"
                                    )}
                                    onClick={() => setSelectedMasterPageId(page.id)}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="space-y-0.5">
                                        <p className="text-xs font-semibold text-foreground">
                                          {page.title || "Untitled option"}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground">
                                          {formatMasterTemplateRuleSummary(page)}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground">
                                          {page.sourcePdf?.name ?? "No PDF"} · page{" "}
                                          {page.sourcePage} · {page.coordsPageKey}
                                          {page.isFallback ? " · fallback" : ""}
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            moveMasterTemplatePageInSection(
                                              sectionGroup.sectionKey,
                                              page.id,
                                              "up"
                                            );
                                          }}
                                          disabled={index === 0}
                                        >
                                          <ArrowUp className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            moveMasterTemplatePageInSection(
                                              sectionGroup.sectionKey,
                                              page.id,
                                              "down"
                                            );
                                          }}
                                          disabled={
                                            index === sectionGroup.pages.length - 1
                                          }
                                        >
                                          <ArrowDown className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            removeMasterTemplatePage(page.id);
                                          }}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded-md border border-dashed border-border/60 px-2 py-2 text-[11px] text-muted-foreground">
                                No options yet for this section.
                              </div>
                            )}
                          </div>
                        ))}
                        {!masterTemplatePages.length ? (
                          <div className="px-3 py-4 text-xs text-muted-foreground">
                            Add options under each section. Each option can target a
                            different project or product type.
                          </div>
                        ) : null}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-4">
                    {activeMasterPage ? (
                      <>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-xs text-muted-foreground">
                              Page title
                            </label>
                            <Input
                              value={activeMasterPage.title}
                              onChange={(event) =>
                                updateMasterTemplatePage(activeMasterPage.id, {
                                  title: event.target.value,
                                })
                              }
                              placeholder="Vendor cover sheet"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs text-muted-foreground">
                              Coordinates page key
                            </label>
                            <Input
                              value={activeMasterPage.coordsPageKey}
                              onChange={(event) =>
                                updateMasterTemplatePage(activeMasterPage.id, {
                                  coordsPageKey: event.target.value.trim(),
                                })
                              }
                              placeholder="page_1"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs text-muted-foreground">
                              Source PDF page
                            </label>
                            <NumberField
                              label=""
                              value={activeMasterPage.sourcePage}
                              onChange={(value) =>
                                updateMasterTemplatePage(activeMasterPage.id, {
                                  sourcePage: Math.max(1, Math.trunc(value || 1)),
                                })
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs text-muted-foreground">
                              Section role
                            </label>
                            <Select
                              value={activeMasterPage.sectionKey ?? "custom"}
                              onValueChange={(value) =>
                                updateMasterTemplatePage(activeMasterPage.id, {
                                  sectionKey: value as MasterTemplateSectionKey,
                                  inclusionMode:
                                    value === "product"
                                      ? "product_type"
                                      : value === "custom"
                                        ? activeMasterPage.inclusionMode
                                        : "project_type",
                                })
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select section" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="title">Title page</SelectItem>
                                <SelectItem value="product">Product page</SelectItem>
                                <SelectItem value="process">Process page</SelectItem>
                                <SelectItem value="install_spec">
                                  Install specification
                                </SelectItem>
                                <SelectItem value="terms">
                                  Terms and conditions
                                </SelectItem>
                                <SelectItem value="pricing">Pricing page</SelectItem>
                                <SelectItem value="custom">Custom / extra</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs text-muted-foreground">
                              Match rule
                            </label>
                            <Select
                              value={activeMasterPage.inclusionMode}
                              onValueChange={(value) =>
                                updateMasterTemplatePage(activeMasterPage.id, {
                                  inclusionMode:
                                    value as MasterTemplateInclusionMode,
                                })
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select mode" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="always">Always include</SelectItem>
                                <SelectItem value="project_type">
                                  Match project type
                                </SelectItem>
                                <SelectItem value="product_type">
                                  Match product type
                                </SelectItem>
                                <SelectItem value="field">
                                  Match any field
                                </SelectItem>
                                <SelectItem value="vendor">
                                  Legacy: vendor contains
                                </SelectItem>
                                <SelectItem value="product">
                                  Legacy: product contains
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <label className="text-xs text-muted-foreground">
                              Source PDF file
                            </label>
                            <Select
                              value={
                                activeMasterPage.sourcePdf?.url
                                  ? activeMasterPage.sourcePdf.url
                                  : "__none__"
                              }
                              onValueChange={(value) => {
                                if (value === "__none__") {
                                  updateMasterTemplatePage(activeMasterPage.id, {
                                    sourcePdf: undefined,
                                  });
                                  return;
                                }
                                const selectedPdf = libraries.template.items.find(
                                  (item) => item.url === value
                                );
                                if (!selectedPdf) return;
                                updateMasterTemplatePage(activeMasterPage.id, {
                                  title: selectedPdf.name,
                                  sourcePdf: {
                                    name: selectedPdf.name,
                                    url: selectedPdf.url,
                                  },
                                });
                              }}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select source PDF" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">
                                  No source selected
                                </SelectItem>
                                {templateFile?.url &&
                                !libraries.template.items.some(
                                  (item) => item.url === templateFile.url
                                ) ? (
                                  <SelectItem value={templateFile.url}>
                                    {templateFile.name} (selected template)
                                  </SelectItem>
                                ) : null}
                                {libraries.template.items.map((item) => (
                                  <SelectItem key={item.key} value={item.url}>
                                    {item.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {activeMasterPage.inclusionMode !== "always" ? (
                            <div className="space-y-2">
                              <label className="text-xs text-muted-foreground">
                                Match value
                              </label>
                              {activeMasterPage.inclusionMode ===
                              "project_type" ? (
                                <Select
                                  value={
                                    activeProjectTypeRuleValue || "__any_project_type__"
                                  }
                                  onValueChange={(value) =>
                                    updateMasterTemplatePage(activeMasterPage.id, {
                                      conditionValue:
                                        value === "__any_project_type__"
                                          ? ""
                                          : value,
                                    })
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select project type" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__any_project_type__">
                                      Any project type
                                    </SelectItem>
                                    {masterTemplateProjectTypeOptions.map((option) => (
                                      <SelectItem key={option} value={option}>
                                        {option}
                                      </SelectItem>
                                    ))}
                                    {activeProjectTypeRuleHasLegacyValue ? (
                                      <SelectItem value={activeProjectTypeRuleValue}>
                                        {activeProjectTypeRuleValue} (legacy)
                                      </SelectItem>
                                    ) : null}
                                  </SelectContent>
                                </Select>
                              ) : activeMasterPage.inclusionMode === "vendor" &&
                              vendorRuleOptions.length ? (
                                <Select
                                  value={activeMasterPage.conditionValue ?? "__none__"}
                                  onValueChange={(value) => {
                                    if (value === "__none__") {
                                      updateMasterTemplatePage(activeMasterPage.id, {
                                        conditionValue: "",
                                        vendorKey: "",
                                      });
                                      return;
                                    }
                                    const vendor = vendorRuleOptions.find(
                                      (entry) => entry.id === value
                                    );
                                    if (!vendor) return;
                                    updateMasterTemplatePage(activeMasterPage.id, {
                                      conditionValue: vendor.name,
                                      vendorKey: vendor.id,
                                    });
                                  }}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select vendor" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">Select vendor</SelectItem>
                                    {vendorRuleOptions.map((vendor) => (
                                      <SelectItem key={vendor.id} value={vendor.id}>
                                        {vendor.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Input
                                  value={activeMasterPage.conditionValue ?? ""}
                                  onChange={(event) =>
                                    updateMasterTemplatePage(activeMasterPage.id, {
                                      conditionValue: event.target.value,
                                    })
                                  }
                                  placeholder={
                                    activeMasterPage.inclusionMode === "product_type"
                                        ? "WinDoor, Marvin, Simonton"
                                        : "Match value"
                                  }
                                />
                              )}
                            </div>
                          ) : null}
                          {activeMasterPage.inclusionMode === "field" ? (
                            <div className="space-y-2">
                              <label className="text-xs text-muted-foreground">
                                Condition field
                              </label>
                              <Input
                                value={activeMasterPage.conditionField ?? ""}
                                onChange={(event) =>
                                  updateMasterTemplatePage(activeMasterPage.id, {
                                    conditionField: event.target.value,
                                  })
                                }
                                placeholder="Field key (ex: project_type)"
                              />
                            </div>
                          ) : null}
                          {activeMasterPage.inclusionMode === "vendor" ? (
                            <div className="space-y-2">
                              <label className="text-xs text-muted-foreground">
                                Vendor key (optional)
                              </label>
                              <Input
                                value={activeMasterPage.vendorKey ?? ""}
                                onChange={(event) =>
                                  updateMasterTemplatePage(activeMasterPage.id, {
                                    vendorKey: event.target.value,
                                  })
                                }
                                placeholder="Vendor code"
                              />
                            </div>
                          ) : null}
                          <div className="space-y-2">
                            <label className="text-xs text-muted-foreground">
                              Section fallback
                            </label>
                            <label className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs text-foreground">
                              <Checkbox
                                checked={activeMasterPage.isFallback === true}
                                onCheckedChange={(checked) =>
                                  updateMasterTemplatePage(activeMasterPage.id, {
                                    isFallback: checked === true,
                                  })
                                }
                              />
                              Use when no rule-matched page is found in this section
                            </label>
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <label className="text-xs text-muted-foreground">
                              Data bindings
                            </label>
                            <Input
                              uiSize="xs"
                              placeholder="Search data bindings"
                              value={bindingSearch}
                              onChange={(event) => setBindingSearch(event.target.value)}
                            />
                            <ScrollArea className="h-40 rounded-lg border border-border/60 bg-background/80">
                              <div className="space-y-1 p-2">
                                {filteredBindingCatalog.map((fieldName) => {
                                  const isBound = Boolean(
                                    activeMasterPage.dataBindings?.includes(fieldName)
                                  );
                                  const isPlaced = Boolean(previewPageFields[fieldName]);
                                  return (
                                    <button
                                      key={fieldName}
                                      type="button"
                                      draggable
                                      onDragStart={(event) =>
                                        handleCalibrationFieldDragStart(
                                          event,
                                          fieldName
                                        )
                                      }
                                      onDoubleClick={() =>
                                        placeBindingOnActiveMasterPage(fieldName)
                                      }
                                      onClick={() => {
                                        setSelectedField(fieldName);
                                        toggleActiveMasterPageBinding(fieldName);
                                      }}
                                      className={cn(
                                        "flex w-full items-center justify-between rounded-md border px-2 py-1 text-left text-xs transition",
                                        isBound
                                          ? "border-accent/70 bg-accent/10 text-foreground"
                                          : "border-border/60 bg-background hover:border-accent/40"
                                      )}
                                    >
                                      <span className="truncate">{fieldName}</span>
                                      <span className="text-[10px] text-muted-foreground">
                                        {isPlaced ? "placed" : "drag"}
                                      </span>
                                    </button>
                                  );
                                })}
                                {!filteredBindingCatalog.length ? (
                                  <p className="px-1 py-2 text-xs text-muted-foreground">
                                    No matching bindings.
                                  </p>
                                ) : null}
                              </div>
                            </ScrollArea>
                            <p className="text-[11px] text-muted-foreground">
                              Click to toggle a binding. Drag onto the PDF to place
                              coordinates.
                            </p>
                            {(activeMasterPage.dataBindings ?? []).length ? (
                              <div className="flex flex-wrap gap-2">
                                {(activeMasterPage.dataBindings ?? []).map(
                                  (binding) => (
                                    <button
                                      key={binding}
                                      type="button"
                                      onClick={() =>
                                        toggleActiveMasterPageBinding(binding)
                                      }
                                      className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] text-foreground hover:border-accent/40"
                                    >
                                      {binding} ×
                                    </button>
                                  )
                                )}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <PdfCalibrationViewer
                          pdfUrl={previewDocumentUrl}
                          pageKey={previewDocumentPageKey}
                          fields={previewPageFields}
                          selectedField={selectedField}
                          onSelectField={setSelectedField}
                          onChangeCoord={(field, x, y) =>
                            updateCoordField(activeCoordsPageKey, field, { x, y })
                          }
                          onDropField={(field, x, y) =>
                            placeBindingOnActiveMasterPage(field, { x, y })
                          }
                          onDocumentInfo={handlePdfDocumentInfo}
                          showGrid={showGrid}
                          snapToGrid={snapToGrid}
                          gridSize={gridSize}
                          labelMap={previewLabelMap}
                          className="min-h-[720px]"
                        />
                      </>
                    ) : (
                      <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
                        Select a page from the stack to configure source PDF,
                        rules, and coordinates.
                      </div>
                    )}
                  </div>
                </div>
                <Tabs defaultValue="master_flow" className="space-y-3">
                  <TabsList className="grid w-full max-w-sm grid-cols-2">
                    <TabsTrigger value="master_flow">Master flow</TabsTrigger>
                    <TabsTrigger value="advanced_setup">Advanced setup</TabsTrigger>
                  </TabsList>
                  <TabsContent value="master_flow" className="mt-0">
                    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                      Advanced coordinate and mapping controls are in
                      <span className="font-medium text-foreground">
                        {" "}
                        Advanced setup
                      </span>
                      . The default master flow is optimized for section-based
                      template selection.
                    </div>
                  </TabsContent>
                  <TabsContent value="advanced_setup" className="mt-0 space-y-3">
                    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      Legacy calibration and mapping tools.
                    </div>
                    <div className="grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
                  <div className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Placement tools
                    </p>
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <Input
                        uiSize="xs"
                        type="number"
                        min={1}
                        placeholder="Page number"
                        value={pageNumberToAdd}
                        onChange={(event) => setPageNumberToAdd(event.target.value)}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const pageNumber = Number(pageNumberToAdd);
                          if (!Number.isInteger(pageNumber) || pageNumber < 1) {
                            setCoordsEditorError(
                              "Enter a valid page number (1 or greater)."
                            );
                            return;
                          }
                          addPage(pageNumber);
                          setPageNumberToAdd("");
                        }}
                      >
                        Add page
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={addAllTemplatePages}
                        disabled={!templatePageCount}
                      >
                        Add all template pages
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={removeCurrentPage}
                        disabled={!parsePageKey(activeCoordsPageKey)}
                      >
                        Remove current page
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">Preview page</label>
                      <Select
                        value={pageKeys.includes(previewPage) ? previewPage : "__none__"}
                        onValueChange={(value) => {
                          if (value === "__none__") return;
                          setSelectedMasterPageId(null);
                          setPreviewPage(value);
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select page" />
                        </SelectTrigger>
                        <SelectContent>
                          {pageKeys.length ? (
                            pageKeys.map((pageKey) => (
                              <SelectItem key={pageKey} value={pageKey}>
                                {pageKey.replace("_", " ").toUpperCase()}
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="__none__">No pages configured</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">
                        Linked fields on this page
                      </label>
                      <Select
                        value={selectedField ?? "__none__"}
                        onValueChange={(value) =>
                          setSelectedField(value === "__none__" ? null : value)
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select linked field" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Select linked field</SelectItem>
                          {Object.keys(previewPageFields).map((fieldName) => (
                            <SelectItem key={fieldName} value={fieldName}>
                              {formatFieldLabel(fieldName)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={removeSelectedField}
                        disabled={!selectedField}
                      >
                        Remove selected field
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">
                        Estimate fields (drag onto template)
                      </label>
                      <Input
                        uiSize="xs"
                        placeholder="Search fields"
                        value={fieldSearch}
                        onChange={(event) => setFieldSearch(event.target.value)}
                      />
                      <ScrollArea className="h-48 rounded-lg border border-border/60 bg-background/80">
                        <div className="space-y-1 p-2">
                          {filteredFieldCatalog.map((fieldName) => {
                            const isPlaced = Boolean(previewPageFields[fieldName]);
                            return (
                              <button
                                key={fieldName}
                                type="button"
                                draggable
                                onDragStart={(event) =>
                                  handleCalibrationFieldDragStart(event, fieldName)
                                }
                                onDoubleClick={() => addFieldToCurrentPage(fieldName)}
                                onClick={() => setSelectedField(fieldName)}
                                className={cn(
                                  "flex w-full items-center justify-between rounded-md border px-2 py-1 text-left text-xs transition",
                                  isPlaced
                                    ? "border-accent/60 bg-accent/10 text-foreground"
                                    : "border-border/60 bg-background hover:border-accent/40"
                                )}
                              >
                                <span className="truncate">{fieldName}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {isPlaced ? "linked" : "drag"}
                                </span>
                              </button>
                            );
                          })}
                          {!filteredFieldCatalog.length ? (
                            <p className="px-1 py-2 text-xs text-muted-foreground">
                              No matching fields.
                            </p>
                          ) : null}
                        </div>
                      </ScrollArea>
                    </div>
                    <div className="grid gap-2 text-xs text-muted-foreground">
                      <label className="flex items-center gap-2 text-foreground">
                        <Checkbox
                          checked={showGrid}
                          onCheckedChange={(checked) => setShowGrid(checked === true)}
                        />
                        Show grid
                      </label>
                      <label className="flex items-center gap-2 text-foreground">
                        <Checkbox
                          checked={snapToGrid}
                          onCheckedChange={(checked) => setSnapToGrid(checked === true)}
                        />
                        Snap to grid
                      </label>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <NumberField
                        label="Grid size (pt)"
                        value={gridSize}
                        onChange={(value) =>
                          setGridSize(Number.isFinite(value) ? Math.max(value, 0) : 0)
                        }
                      />
                      <NumberField
                        label="Nudge (pt)"
                        value={nudgeStep}
                        onChange={(value) =>
                          setNudgeStep(Number.isFinite(value) ? Math.max(value, 0) : 0)
                        }
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => nudgeSelectedField(-nudgeStep, 0)}
                        disabled={!selectedField}
                        aria-label="Nudge left"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => nudgeSelectedField(0, nudgeStep)}
                        disabled={!selectedField}
                        aria-label="Nudge up"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => nudgeSelectedField(0, -nudgeStep)}
                        disabled={!selectedField}
                        aria-label="Nudge down"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => nudgeSelectedField(nudgeStep, 0)}
                        disabled={!selectedField}
                        aria-label="Nudge right"
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={snapSelectedField}
                        disabled={!selectedField || gridSize <= 0}
                      >
                        Snap
                      </Button>
                    </div>
                    {coordsEditorError ? (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {coordsEditorError}
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-4">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setMappingConfig(cloneJson(mappingDefault as MappingConfig))
                        }
                      >
                        Reset mapping
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          handleDownloadJson(mappingConfig, "mapping.override.json")
                        }
                      >
                        Download mapping
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setCoordsConfig(cloneJson(coordinatesDefault as CoordsConfig))
                        }
                      >
                        Reset coordinates
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          handleDownloadJson(coordsConfig, "coordinates.override.json")
                        }
                      >
                        Download coordinates
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleCalibrationPdf}>
                        Download calibration PDF
                      </Button>
                    </div>
                    {workbookError ? (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {workbookError}
                      </div>
                    ) : workbookLoading ? (
                      <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        Reading workbook...
                      </div>
                    ) : workbookLoaded ? (
                      <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        Workbook loaded with {sheetNames.length} sheet
                        {sheetNames.length === 1 ? "" : "s"}.
                      </div>
                    ) : null}
                    <ScrollArea className="h-[360px] rounded-lg border border-border/60 bg-background/80">
                      <div className="space-y-2 p-2">
                        {Object.entries(mappingConfig.fields).map(([fieldName, field]) => (
                          <div
                            key={fieldName}
                            className="grid gap-2 rounded-lg border border-border/60 bg-background p-2 md:grid-cols-[1.1fr_1fr_0.8fr]"
                          >
                            <div>
                              <p className="text-xs font-semibold text-foreground">
                                {formatFieldLabel(fieldName)}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {field.format ?? "text"}
                              </p>
                            </div>
                            <Select
                              value={field.sheet || "__none__"}
                              onValueChange={(value) =>
                                updateMappingField(fieldName, {
                                  sheet: value === "__none__" ? "" : value,
                                })
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Sheet" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Select sheet</SelectItem>
                                {sheetNames.map((sheet) => (
                                  <SelectItem key={sheet} value={sheet}>
                                    {sheet}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <div className="space-y-1">
                              <Input
                                uiSize="xs"
                                value={field.cell ?? ""}
                                onChange={(event) =>
                                  updateMappingField(fieldName, {
                                    cell: event.target.value.toUpperCase(),
                                  })
                                }
                                placeholder="C1"
                              />
                              <p className="text-[11px] text-muted-foreground">
                                {getCellPreview(
                                  cellPreviews,
                                  fieldName,
                                  workbookLoading,
                                  workbookError
                                )}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                    {selectedField && selectedFieldSpec ? (
                      <div className="grid gap-2 rounded-lg border border-border/60 bg-background p-3 md:grid-cols-2">
                        <p className="text-xs font-semibold text-foreground md:col-span-2">
                          Selected field: {formatFieldLabel(selectedField)}
                        </p>
                        <NumberField
                          label="X"
                          value={selectedFieldSpec.x}
                          onChange={(value) =>
                            updateCoordField(activeCoordsPageKey, selectedField, {
                              x: value,
                            })
                          }
                        />
                        <NumberField
                          label="Y"
                          value={selectedFieldSpec.y}
                          onChange={(value) =>
                            updateCoordField(activeCoordsPageKey, selectedField, {
                              y: value,
                            })
                          }
                        />
                        <NumberField
                          label="Size"
                          value={selectedFieldSpec.size}
                          onChange={(value) =>
                            updateCoordField(activeCoordsPageKey, selectedField, {
                              size: value,
                            })
                          }
                        />
                        <Input
                          uiSize="xs"
                          value={selectedFieldSpec.color ?? "#111111"}
                          onChange={(event) =>
                            updateCoordField(activeCoordsPageKey, selectedField, {
                              color: event.target.value,
                            })
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/80 shadow-elevated">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">
                  Test Generation
                </CardTitle>
                <CardDescription>
                  Generate a proposal with the current mapping and coordinates.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {calibrationError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {calibrationError}
                  </div>
                ) : null}
                {isGenerating ? (
                  <div className="space-y-2 rounded-lg border border-border/60 bg-muted/40 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                      {progressLabel ?? "Working..."}
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-border/60">
                      <div
                        className="h-full rounded-full bg-accent transition-all duration-500"
                        style={{ width: `${Math.min(progress * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="accent"
                    onClick={handleGenerate}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowDownToLine className="h-4 w-4" />
                    )}
                    {isGenerating ? "Generating..." : "Generate with overrides"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setWorkbookFile(null);
                      setTemplateFile(null);
                    }}
                    disabled={isGenerating}
                  >
                    Clear uploads
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );

  async function loadLibrary(type: AdminLibraryType) {
    setLibraries((prev) => ({
      ...prev,
      [type]: { ...prev[type], loading: true, error: null },
    }));
    try {
      const response = await fetch(`/api/library?type=${type}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = data?.error || "Failed to load library.";
        throw new Error(message);
      }
      const data = await response.json();
      setLibraries((prev) => ({
        ...prev,
        [type]: {
          ...prev[type],
          items: Array.isArray(data.items) ? data.items : [],
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setLibraries((prev) => ({
        ...prev,
        [type]: { ...prev[type], error: message },
      }));
    } finally {
      setLibraries((prev) => ({
        ...prev,
        [type]: { ...prev[type], loading: false },
      }));
    }
  }

  async function deleteAll(type: AdminLibraryType) {
    setLibraries((prev) => ({
      ...prev,
      [type]: { ...prev[type], loading: true, error: null },
    }));
    try {
      const response = await fetch(`/api/library?type=${type}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = data?.error || "Failed to delete files.";
        throw new Error(message);
      }
      setLibraries((prev) => ({
        ...prev,
        [type]: { ...prev[type], items: [] },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setLibraries((prev) => ({
        ...prev,
        [type]: { ...prev[type], error: message },
      }));
    } finally {
      setLibraries((prev) => ({
        ...prev,
        [type]: { ...prev[type], loading: false },
      }));
    }
  }

  async function deleteItem(type: AdminLibraryType, key: string) {
    setLibraries((prev) => ({
      ...prev,
      [type]: { ...prev[type], loading: true, error: null },
    }));
    try {
      const response = await fetch(
        `/api/library?type=${type}&key=${encodeURIComponent(key)}`,
        {
          method: "DELETE",
        }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = data?.error || "Failed to delete file.";
        throw new Error(message);
      }
      setLibraries((prev) => ({
        ...prev,
        [type]: {
          ...prev[type],
          items: prev[type].items.filter((item) => item.key !== key),
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setLibraries((prev) => ({
        ...prev,
        [type]: { ...prev[type], error: message },
      }));
    } finally {
      setLibraries((prev) => ({
        ...prev,
        [type]: { ...prev[type], loading: false },
      }));
    }
  }
}

function LibraryCard({
  config,
  state,
  onRefresh,
  onDeleteAll,
  onDeleteItem,
}: {
  config: { label: string; description: string; endpoint: AdminLibraryType };
  state: LibraryState;
  onRefresh: () => void;
  onDeleteAll: () => void;
  onDeleteItem: (key: string) => void;
}) {
  return (
    <Card className="border-border/60 bg-card/80 shadow-elevated">
      <CardHeader>
        <CardTitle className="text-xl font-serif">{config.label}</CardTitle>
        <CardDescription>{config.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <UploadDropzone
          endpoint={config.endpoint}
          appearance={adminDropzoneAppearance}
          config={{ mode: "auto" }}
          content={{
            label: `Upload ${config.label.toLowerCase()}`,
            allowedContent: "Drop file or browse",
            button: "Upload",
          }}
          onClientUploadComplete={() => {
            onRefresh();
          }}
          onUploadError={(error: Error) => {
            console.error(error);
          }}
        />
        {state.error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.error}
          </div>
        ) : null}
        {state.loading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : state.items.length ? (
          <ScrollArea className="h-56 rounded-lg border border-border/70 bg-background/70">
            <div className="divide-y divide-border/60">
              {state.items.map((item) => (
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
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this file?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently deletes the selected upload.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => onDeleteItem(item.key)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="text-sm text-muted-foreground">No files yet.</div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Trash2 className="h-4 w-4" />
                Delete all
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all uploads?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes every file in this library.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={onDeleteAll}
                >
                  Delete all
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

function UploadPickerCard({
  title,
  description,
  endpoint,
  selected,
  onUpload,
  onLibraryRefresh,
  libraryItems,
  onSelectLibraryItem,
}: {
  title: string;
  description: string;
  endpoint: AdminLibraryType;
  selected: UploadedFile | null;
  onUpload: (file: UploadedFile | null) => void;
  onLibraryRefresh: () => void;
  libraryItems: LibraryItem[];
  onSelectLibraryItem: (file: UploadedFile) => void;
}) {
  return (
    <Card className="border-border/60 bg-card/80 shadow-elevated">
      <CardHeader>
        <CardTitle className="text-xl font-serif">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <UploadDropzone
          endpoint={endpoint}
          appearance={adminDropzoneAppearance}
          config={{ mode: "auto" }}
          content={{
            label: selected ? `Selected: ${selected.name}` : `Upload ${title}`,
            allowedContent: "Drop file or browse",
            button: "Upload",
          }}
          onClientUploadComplete={(files) => {
            const uploaded = files?.[0];
            if (!uploaded) return;
            const url = uploaded.ufsUrl ?? uploaded.url;
            onUpload({ name: uploaded.name, url });
            onLibraryRefresh();
          }}
          onUploadError={(error: Error) => {
            console.error(error);
          }}
        />
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Library</span>
            <button
              type="button"
              className="text-foreground underline-offset-4 hover:underline"
              onClick={onLibraryRefresh}
            >
              Refresh
            </button>
          </div>
          {libraryItems.length ? (
            <ScrollArea className="h-40 rounded-lg border border-border/70 bg-background/70">
              <div className="divide-y divide-border/60">
                {libraryItems.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        {item.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(item.uploadedAt).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onSelectLibraryItem({ name: item.name, url: item.url })
                      }
                    >
                      Use
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="text-xs text-muted-foreground">No files yet.</div>
          )}
        </div>
        {selected ? (
          <div className="text-xs text-muted-foreground">
            Using: <span className="text-foreground">{selected.name}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input
        uiSize="xs"
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function formatFieldLabel(fieldName: string) {
  return fieldName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getCellPreview(
  previews: CellPreviewMap,
  fieldName: string,
  isLoading: boolean,
  error: string | null
) {
  if (error) return error;
  if (isLoading) return "Loading workbook...";
  if (!fieldName) return "No preview available";
  const value = previews[fieldName];
  if (value === undefined) return "No preview available";
  if (value === null) return "No value";
  if (value instanceof Date) return value.toLocaleDateString();
  return String(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function snapToGridValue(value: number, gridSize: number) {
  if (!gridSize || gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeInclusionMode(value: unknown): MasterTemplateInclusionMode {
  const normalized = String(value ?? "always").trim().toLowerCase();
  if (normalized === "project_type") return "project_type";
  if (normalized === "product_type") return "product_type";
  if (normalized === "product") return "product";
  if (normalized === "vendor") return "vendor";
  if (normalized === "field") return "field";
  return "always";
}

function normalizeMasterTemplateSection(
  value: unknown,
  fallbackIndex?: number
): MasterTemplateSectionKey {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "title") return "title";
  if (normalized === "product") return "product";
  if (normalized === "process") return "process";
  if (normalized === "install_spec") return "install_spec";
  if (normalized === "terms") return "terms";
  if (normalized === "pricing") return "pricing";
  if (normalized === "custom") return "custom";
  if (
    typeof fallbackIndex === "number" &&
    fallbackIndex >= 0 &&
    fallbackIndex < DEFAULT_MASTER_TEMPLATE_SECTION_ORDER.length
  ) {
    return DEFAULT_MASTER_TEMPLATE_SECTION_ORDER[fallbackIndex];
  }
  return "custom";
}

function normalizeMasterTemplateSectionOrder(
  value: unknown
): MasterTemplateSectionKey[] {
  const source = Array.isArray(value)
    ? value
    : DEFAULT_MASTER_TEMPLATE_SECTION_ORDER;
  const seen = new Set<MasterTemplateSectionKey>();
  const normalized: MasterTemplateSectionKey[] = [];
  source.forEach((entry) => {
    const section = normalizeMasterTemplateSection(entry);
    if (section === "custom" || seen.has(section)) return;
    seen.add(section);
    normalized.push(section);
  });
  DEFAULT_MASTER_TEMPLATE_SECTION_ORDER.forEach((section) => {
    if (seen.has(section)) return;
    seen.add(section);
    normalized.push(section);
  });
  return normalized;
}

function normalizeMasterTemplateProjectTypes(
  value: unknown,
  fallback: string[] = DEFAULT_MASTER_TEMPLATE_PROJECT_TYPES
) {
  const source = Array.isArray(value) ? value : fallback;
  const seen = new Set<string>();
  const normalized: string[] = [];
  source.forEach((entry) => {
    const projectType = String(entry ?? "").trim();
    if (!projectType || seen.has(projectType)) return;
    seen.add(projectType);
    normalized.push(projectType);
  });
  if (normalized.length) return normalized;
  return fallback.slice();
}

function buildMasterTemplateConfig(
  pages: MasterTemplatePageDraft[],
  selection: MasterTemplateSelectionDraft
): MasterTemplateConfig {
  const normalizedPages = pages
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((page, index) => ({
      id: page.id || makeId(),
      title: page.title?.trim() || `Page ${index + 1}`,
      order: index + 1,
      coordsPageKey: page.coordsPageKey?.trim() || toPageKey(index + 1),
      sourcePdf: page.sourcePdf?.url
        ? {
            name: page.sourcePdf.name || "template.pdf",
            url: page.sourcePdf.url,
          }
        : undefined,
      sourcePage:
        Number.isFinite(page.sourcePage) && Number(page.sourcePage) > 0
          ? Math.trunc(Number(page.sourcePage))
          : 1,
      inclusionMode: normalizeInclusionMode(page.inclusionMode),
      conditionField: String(page.conditionField ?? "").trim() || undefined,
      conditionValue: String(page.conditionValue ?? "").trim() || undefined,
      vendorKey: String(page.vendorKey ?? "").trim() || undefined,
      sectionKey: normalizeMasterTemplateSection(page.sectionKey, index),
      isFallback: page.isFallback === true,
      dataBindings: Array.isArray(page.dataBindings)
        ? page.dataBindings
            .map((binding) => String(binding ?? "").trim())
            .filter(Boolean)
        : [],
      notes: String(page.notes ?? "").trim() || undefined,
    }));
  return {
    version: 2,
    selection: {
      projectTypeField: DEFAULT_PROJECT_TYPE_FIELD,
      productTypeField: DEFAULT_PRODUCT_TYPE_FIELD,
      projectTypes: normalizeMasterTemplateProjectTypes(selection.projectTypes),
      sectionOrder: normalizeMasterTemplateSectionOrder(selection.sectionOrder),
    },
    pages: normalizedPages,
  };
}

function normalizeLoadedMasterTemplatePages(
  masterTemplate: MasterTemplateConfig | undefined,
  coords: Record<string, unknown> | undefined,
  fallbackTemplateFile: UploadedFile | null
): MasterTemplatePageDraft[] {
  const sourcePages = masterTemplate?.pages;
  if (Array.isArray(sourcePages) && sourcePages.length) {
    return sourcePages
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((page, index) => ({
        ...page,
        id: page.id || makeId(),
        title: page.title || `Page ${index + 1}`,
        order: index + 1,
        coordsPageKey: page.coordsPageKey || toPageKey(index + 1),
        sourcePage:
          Number.isFinite(page.sourcePage) && Number(page.sourcePage) > 0
            ? Math.trunc(Number(page.sourcePage))
            : 1,
        inclusionMode: normalizeInclusionMode(page.inclusionMode),
        sectionKey: normalizeMasterTemplateSection(page.sectionKey, index),
        isFallback: page.isFallback === true,
        sourcePdf: page.sourcePdf?.url
          ? { name: page.sourcePdf.name, url: page.sourcePdf.url }
          : fallbackTemplateFile ?? undefined,
        dataBindings: Array.isArray(page.dataBindings) ? page.dataBindings : [],
      }));
  }

  const coordKeys = getSortedPageKeys(coords ?? {});
  if (!coordKeys.length) return [];
  return coordKeys.map((pageKey, index) => ({
    id: makeId(),
    title: `Page ${index + 1}`,
    order: index + 1,
    coordsPageKey: pageKey,
    sourcePdf: fallbackTemplateFile ?? undefined,
    sourcePage: parsePageKey(pageKey) ?? index + 1,
    sectionKey:
      DEFAULT_MASTER_TEMPLATE_SECTION_ORDER[index] ?? ("custom" as const),
    inclusionMode:
      index === 1 ? ("product_type" as const) : ("project_type" as const),
    isFallback: false,
    dataBindings: [],
  }));
}

function normalizeLoadedMasterTemplateSelection(
  masterTemplate: MasterTemplateConfig | undefined
): MasterTemplateSelectionDraft {
  const selection = masterTemplate?.selection;
  return {
    projectTypeField: DEFAULT_PROJECT_TYPE_FIELD,
    productTypeField: DEFAULT_PRODUCT_TYPE_FIELD,
    projectTypes: normalizeMasterTemplateProjectTypes(selection?.projectTypes),
    sectionOrder: normalizeMasterTemplateSectionOrder(selection?.sectionOrder),
  };
}

function formatMasterTemplateSectionLabel(section: MasterTemplateSectionKey) {
  if (section === "install_spec") return "Install spec";
  if (section === "title") return "Title";
  if (section === "product") return "Product";
  if (section === "process") return "Process";
  if (section === "terms") return "Terms";
  if (section === "pricing") return "Pricing";
  return "Custom";
}

function formatMasterTemplateRuleSummary(page: MasterTemplatePageDraft) {
  const mode = page.inclusionMode;
  const value = String(page.conditionValue ?? "").trim();
  if (mode === "project_type") {
    return value ? `Project type: ${value}` : "Project type: any";
  }
  if (mode === "product_type") {
    return value ? `Product type: ${value}` : "Product type: any";
  }
  if (mode === "field") {
    const field = String(page.conditionField ?? "").trim() || "field";
    return value ? `${field}: ${value}` : `${field}: has value`;
  }
  if (mode === "vendor") {
    return value ? `Vendor contains: ${value}` : "Vendor contains: any";
  }
  if (mode === "product") {
    return value ? `Product contains: ${value}` : "Product contains: any";
  }
  return "Always include";
}

function getMostRecentLibraryItem(items: LibraryItem[]) {
  return items
    .slice()
    .sort((left, right) => right.uploadedAt - left.uploadedAt)[0];
}

// formatting helpers moved to lib/formatting
