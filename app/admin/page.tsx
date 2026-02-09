"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { UploadedFile } from "@/lib/types";
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
  const [coordsEditorError, setCoordsEditorError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const embedded = new URLSearchParams(window.location.search).get("embedded");
    setIsEmbedded(embedded === "1");
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

  const previewLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    const preparedByMap = mappingConfig.prepared_by_map ?? {};
    const missingValue = String(mappingConfig.missing_value ?? "");
    const fields =
      (coordsConfig[previewPage] as Record<string, CoordField>) ?? {};
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
  }, [coordsConfig, previewPage, cellPreviews, mappingConfig]);

  useEffect(() => {
    if (!hasTeamAdminAccess) return;
    (Object.keys(LIBRARY_CONFIG) as AdminLibraryType[]).forEach((type) => {
      void loadLibrary(type);
    });
  }, [hasTeamAdminAccess]);

  const handleGenerate = async () => {
    setCalibrationError(null);
    if (!workbookFile || !templateFile) {
      setCalibrationError("Upload both the workbook and template PDF.");
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
          templatePdfUrl: templateFile.url,
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

  const handleSaveTemplate = async (options?: { replaceKey?: string }) => {
    setTemplateSaveError(null);
    setTemplateSaveStatus(null);
    setTemplateLoadError(null);
    if (!templateFile?.url) {
      setTemplateSaveError("Select a template PDF before saving.");
      return;
    }
    if (!templateName.trim()) {
      setTemplateSaveError("Template name is required.");
      return;
    }

    setTemplateSaving(true);
    try {
      const response = await fetch("/api/template-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName.trim(),
          description: templateDescription.trim() || undefined,
          templatePdf: templateFile,
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
      const replaceKey = options?.replaceKey;
      if (replaceKey && replaceKey !== savedKey) {
        await deleteItem("template_config", replaceKey);
      }
      if (savedKey) {
        setEditingTemplateKey(savedKey);
        setSelectedTemplateKey(savedKey);
      }
      setTemplateSaveStatus(
        replaceKey ? "Template updated in library." : "Template saved to library."
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

  const handleLoadTemplateConfig = async (item: LibraryItem) => {
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
        description?: string;
        templatePdf?: { name?: string; url?: string };
        coords?: Record<string, any>;
        mapping?: Record<string, any>;
      };
      if (!data?.templatePdf?.url || !data?.coords) {
        throw new Error("Template configuration is incomplete.");
      }
      setTemplateName(data.name ?? "");
      setTemplateDescription(data.description ?? "");
      setTemplateFile({
        name: data.templatePdf.name ?? "template.pdf",
        url: data.templatePdf.url,
      });
      if (data.coords) {
        setCoordsConfig(data.coords);
      }
      if (data.mapping) {
        setMappingConfig(data.mapping as MappingConfig);
      }
      setEditingTemplateKey(item.key);
      setSelectedTemplateKey(item.key);
      setTemplateSaveStatus("Template loaded for editing.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setTemplateLoadError(message);
    } finally {
      setTemplateLoading(false);
    }
  };

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
    const fields = coordsConfig[previewPage] as Record<string, CoordField> | undefined;
    const current = fields?.[selectedField];
    if (!current) return;
    const nextX = (current.x ?? 0) + dx;
    const nextY = (current.y ?? 0) + dy;
    updateCoordField(previewPage, selectedField, { x: nextX, y: nextY });
  };

  const snapSelectedField = () => {
    if (!selectedField || gridSize <= 0) return;
    const fields = coordsConfig[previewPage] as Record<string, CoordField> | undefined;
    const current = fields?.[selectedField];
    if (!current) return;
    const nextX = snapToGridValue(current.x ?? 0, gridSize);
    const nextY = snapToGridValue(current.y ?? 0, gridSize);
    updateCoordField(previewPage, selectedField, { x: nextX, y: nextY });
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
  const previewPageFields = useMemo(
    () =>
      ((coordsConfig[previewPage] as Record<string, CoordField> | undefined) ??
      {}) as Record<string, CoordField>,
    [coordsConfig, previewPage]
  );
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

  const addFieldToCurrentPage = (fieldName: string) => {
    const nextField = String(fieldName ?? "").trim();
    if (!nextField) {
      setCoordsEditorError("Enter or select a field key to add.");
      return;
    }
    if (!parsePageKey(previewPage)) {
      setCoordsEditorError("Select a valid page before adding fields.");
      return;
    }
    setCoordsConfig((prev) => {
      const page =
        (prev[previewPage] as Record<string, CoordField> | undefined) ?? {};
      if (page[nextField]) return prev;
      return {
        ...prev,
        [previewPage]: {
          ...page,
          [nextField]: {
            x: 36,
            y: 36,
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
        (prev[previewPage] as Record<string, CoordField> | undefined) ?? {};
      if (!page[selectedField]) return prev;
      const nextPage = { ...page };
      delete nextPage[selectedField];
      return {
        ...prev,
        [previewPage]: nextPage,
      };
    });
    setSelectedField(null);
    setCoordsEditorError(null);
  };

  const removeCurrentPage = () => {
    if (!parsePageKey(previewPage)) return;
    setCoordsConfig((prev) => {
      if (!prev[previewPage]) return prev;
      const next = { ...prev };
      delete next[previewPage];
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
  }, [selectedField, nudgeStep, previewPage, coordsConfig, snapToGrid, gridSize]);

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
                <Link href="/">
                  <ArrowLeft className="h-4 w-4" />
                  Back to generator
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
                <Link href="/">
                  <ArrowLeft className="h-4 w-4" />
                  Back to generator
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
                  Save the selected PDF with the current coordinates and mapping
                  as a reusable template.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs text-muted-foreground">
                      Load existing template
                    </label>
                    {libraries.template_config.items.length ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={selectedTemplateKey || "__none__"}
                          onValueChange={(value) =>
                            setSelectedTemplateKey(value === "__none__" ? "" : value)
                          }
                        >
                          <SelectTrigger className="min-w-[240px] flex-1">
                            <SelectValue placeholder="Select a saved template" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Select a saved template</SelectItem>
                            {libraries.template_config.items.map((item) => (
                              <SelectItem key={item.key} value={item.key}>
                                {item.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const selected = libraries.template_config.items.find(
                              (item) => item.key === selectedTemplateKey
                            );
                            if (selected) {
                              handleLoadTemplateConfig(selected);
                            }
                          }}
                          disabled={!selectedTemplateKey || templateLoading}
                        >
                          {templateLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          Load
                        </Button>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        No templates yet. Save one to enable editing.
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
                    Uses: {templateFile?.name ?? "no PDF selected"}
                  </span>
                  <span>•</span>
                  <span>{configuredPageKeys.length} configured page(s)</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="accent"
                    onClick={() => handleSaveTemplate()}
                    disabled={templateSaving}
                  >
                    {templateSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileDown className="h-4 w-4" />
                    )}
                    {templateSaving ? "Saving..." : "Save new template"}
                  </Button>
                  {editingTemplateKey ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        handleSaveTemplate({ replaceKey: editingTemplateKey })
                      }
                      disabled={templateSaving}
                    >
                      Update existing template
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/80 shadow-elevated">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">
                  Mapping Builder
                </CardTitle>
                <CardDescription>
                  Assign Excel cells to proposal fields.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setMappingConfig(cloneJson(mappingDefault as MappingConfig))
                    }
                  >
                    Reset to default
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      handleDownloadJson(mappingConfig, "mapping.override.json")
                    }
                  >
                    <FileDown className="h-4 w-4" />
                    Download mapping JSON
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
                <Separator />
                <div className="space-y-4">
                  {Object.entries(mappingConfig.fields).map(
                    ([fieldName, field]) => (
                      <div
                        key={fieldName}
                        className="grid gap-3 rounded-xl border border-border/60 bg-background/80 p-4 md:grid-cols-[1.2fr_1fr_0.8fr]"
                      >
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {formatFieldLabel(fieldName)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {field.format ?? "text"}
                          </p>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-muted-foreground">
                            Sheet
                          </label>
                          <Select
                            value={field.sheet || "__none__"}
                            onValueChange={(value) =>
                              updateMappingField(fieldName, {
                                sheet: value === "__none__" ? "" : value,
                              })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select sheet" />
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
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-muted-foreground">
                            Cell
                          </label>
                          <Input
                            value={field.cell ?? ""}
                            onChange={(event) =>
                              updateMappingField(fieldName, {
                                cell: event.target.value.toUpperCase(),
                              })
                            }
                            placeholder="C1"
                          />
                          <p className="text-xs text-muted-foreground">
                            {getCellPreview(
                              cellPreviews,
                              fieldName,
                              workbookLoading,
                              workbookError
                            )}
                          </p>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/80 shadow-elevated">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">
                  Coordinates Editor
                </CardTitle>
                <CardDescription>
                  Adjust placement, size, and alignment for each field.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setCoordsConfig(cloneJson(coordinatesDefault as CoordsConfig))
                    }
                  >
                    Reset to default
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      handleDownloadJson(coordsConfig, "coordinates.override.json")
                    }
                  >
                    <FileDown className="h-4 w-4" />
                    Download coordinates JSON
                  </Button>
                  <Button variant="outline" onClick={handleCalibrationPdf}>
                    <ArrowDownToLine className="h-4 w-4" />
                    Download calibration PDF
                  </Button>
                </div>
                <Separator />
                <div className="grid gap-4 lg:grid-cols-[0.6fr_1.4fr]">
                  <div className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-4">
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        Page setup
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Template pages detected:{" "}
                        {templatePageCount > 0 ? templatePageCount : "Not loaded"}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                        <Input
                          uiSize="xs"
                          type="number"
                          min={1}
                          placeholder="Page number"
                          value={pageNumberToAdd}
                          onChange={(event) =>
                            setPageNumberToAdd(event.target.value)
                          }
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
                          disabled={!parsePageKey(previewPage)}
                        >
                          Remove current page
                        </Button>
                      </div>
                    </div>
                    <Separator />
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">
                        Preview page
                      </label>
                      <Select
                        value={pageKeys.includes(previewPage) ? previewPage : "__none__"}
                        onValueChange={(value) =>
                          setPreviewPage(value === "__none__" ? previewPage : value)
                        }
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
                        Field to place
                      </label>
                      <Select
                        value={selectedField ?? "__none__"}
                        onValueChange={(value) =>
                          setSelectedField(value === "__none__" ? null : value)
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select field" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Select field</SelectItem>
                          {Object.keys(previewPageFields).map((fieldName) => (
                            <SelectItem key={fieldName} value={fieldName}>
                              {formatFieldLabel(fieldName)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">
                        Add field to current page
                      </label>
                      <Select
                        value={fieldToAdd || "__none__"}
                        onValueChange={(value) =>
                          setFieldToAdd(value === "__none__" ? "" : value)
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose field key" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Choose field key</SelectItem>
                          {availableStampFields.map((fieldName) => (
                            <SelectItem key={fieldName} value={fieldName}>
                              {fieldName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        uiSize="xs"
                        placeholder="Or enter custom field key"
                        value={customFieldToAdd}
                        onChange={(event) => setCustomFieldToAdd(event.target.value)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            addFieldToCurrentPage(customFieldToAdd || fieldToAdd)
                          }
                          disabled={!parsePageKey(previewPage)}
                        >
                          Add field
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={removeSelectedField}
                          disabled={!selectedField}
                        >
                          Remove selected
                        </Button>
                      </div>
                    </div>
                    {coordsEditorError ? (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {coordsEditorError}
                      </div>
                    ) : null}
                    <Separator />
                    <div className="space-y-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        Placement tools
                      </p>
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
                      <div className="flex flex-col items-center gap-2">
                        <div className="grid grid-cols-3 gap-2">
                          <span />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => nudgeSelectedField(0, nudgeStep)}
                            disabled={!selectedField}
                            aria-label="Nudge up"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <span />
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
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={snapSelectedField}
                          disabled={!selectedField || gridSize <= 0}
                        >
                          Snap selection to grid
                        </Button>
                        <p className="text-[11px] text-muted-foreground">
                          Click or drag to place (snaps if enabled). Arrow keys
                          and nudges always move by the nudge step; use Snap
                          selection to grid to align.
                        </p>
                      </div>
                    </div>
                  </div>
                  <PdfCalibrationViewer
                    pdfUrl={templateFile?.url}
                    pageKey={previewPage}
                    fields={previewPageFields}
                    selectedField={selectedField}
                    onSelectField={setSelectedField}
                    onChangeCoord={(field, x, y) =>
                      updateCoordField(previewPage, field, { x, y })
                    }
                    onDocumentInfo={handlePdfDocumentInfo}
                    showGrid={showGrid}
                    snapToGrid={snapToGrid}
                    gridSize={gridSize}
                    labelMap={previewLabelMap}
                    className="min-h-[360px]"
                  />
                </div>
                {pageKeys.length ? (
                  <Tabs value={previewPage} onValueChange={setPreviewPage}>
                    <TabsList className="flex flex-wrap">
                      {pageKeys.map((pageKey) => (
                        <TabsTrigger key={pageKey} value={pageKey}>
                          {pageKey.replace("_", " ").toUpperCase()}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    {pageKeys.map((pageKey) => {
                      const fields = coordsConfig[pageKey] ?? {};
                      return (
                        <TabsContent key={pageKey} value={pageKey} className="mt-4">
                          <div className="space-y-3">
                            {Object.entries(fields as Record<string, CoordField>).map(
                              ([fieldName, field]) => (
                                <div
                                  key={fieldName}
                                  className="grid gap-3 rounded-xl border border-border/60 bg-background/80 p-4 md:grid-cols-[1.2fr_repeat(8,_minmax(0,_1fr))]"
                                >
                                  <div>
                                    <p className="text-sm font-semibold text-foreground">
                                      {formatFieldLabel(fieldName)}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {fieldName}
                                    </p>
                                  </div>
                                  <NumberField
                                    label="X"
                                    value={field.x}
                                    onChange={(value) =>
                                      updateCoordField(pageKey, fieldName, {
                                        x: value,
                                      })
                                    }
                                  />
                                  <NumberField
                                    label="Y"
                                    value={field.y}
                                    onChange={(value) =>
                                      updateCoordField(pageKey, fieldName, {
                                        y: value,
                                      })
                                    }
                                  />
                                  <NumberField
                                    label="Size"
                                    value={field.size}
                                    onChange={(value) =>
                                      updateCoordField(pageKey, fieldName, {
                                        size: value,
                                      })
                                    }
                                  />
                                  <NumberField
                                    label="Max width"
                                    value={field.max_width}
                                    onChange={(value) =>
                                      updateCoordField(pageKey, fieldName, {
                                        max_width: value,
                                      })
                                    }
                                  />
                                  <NumberField
                                    label="Min size"
                                    value={field.min_size}
                                    onChange={(value) =>
                                      updateCoordField(pageKey, fieldName, {
                                        min_size: value,
                                      })
                                    }
                                  />
                                  <div className="space-y-2">
                                    <label className="text-xs text-muted-foreground">
                                      Align
                                    </label>
                                    <Select
                                      value={field.align ?? "left"}
                                      onValueChange={(value) =>
                                        updateCoordField(pageKey, fieldName, {
                                          align: value,
                                        })
                                      }
                                    >
                                      <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Alignment" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="left">Left</SelectItem>
                                        <SelectItem value="center">Center</SelectItem>
                                        <SelectItem value="right">Right</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-2">
                                    <label className="text-xs text-muted-foreground">
                                      Font
                                    </label>
                                    <Select
                                      value={field.font ?? "WorkSans"}
                                      onValueChange={(value) =>
                                        updateCoordField(pageKey, fieldName, {
                                          font: value,
                                        })
                                      }
                                    >
                                      <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Font" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {fontOptions.map((font) => (
                                          <SelectItem key={font} value={font}>
                                            {font}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-2">
                                    <label className="text-xs text-muted-foreground">
                                      Color
                                    </label>
                                    <Input
                                      uiSize="xs"
                                      value={field.color ?? "#111111"}
                                      onChange={(event) =>
                                        updateCoordField(pageKey, fieldName, {
                                          color: event.target.value,
                                        })
                                      }
                                    />
                                  </div>
                                  <NumberField
                                    label="Opacity"
                                    value={field.opacity}
                                    onChange={(value) =>
                                      updateCoordField(pageKey, fieldName, {
                                        opacity: value,
                                      })
                                    }
                                  />
                                </div>
                              )
                            )}
                          </div>
                        </TabsContent>
                      );
                    })}
                  </Tabs>
                ) : (
                  <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    No coordinate pages configured yet. Add a page to begin.
                  </div>
                )}
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

// formatting helpers moved to lib/formatting
