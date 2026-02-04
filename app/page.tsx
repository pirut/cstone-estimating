"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { AdvancedOverridesCard } from "@/components/advanced-overrides-card";
import { BrandMark } from "@/components/brand-mark";
import { EstimateBuilderCard } from "@/components/estimate-builder-card";
import { UploadCard } from "@/components/upload-card";
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
import type {
  LibraryItem,
  LibraryState,
  LibraryType,
  TemplateConfig,
  UploadedFile,
  UploadState,
} from "@/lib/types";
import { db, instantAppId } from "@/lib/instant";
import { InstantAuthSync } from "@/components/instant-auth-sync";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { ArrowDownToLine, FileDown, FileText, Loader2, Sparkles } from "lucide-react";
import {
  SignInButton,
  SignOutButton,
  clerkEnabled,
  useOptionalAuth,
  useOptionalUser,
} from "@/lib/clerk";
import { id } from "@instantdb/react";

export default function HomePage() {
  const { isLoaded: authLoaded, isSignedIn } = useOptionalAuth();
  const { user } = useOptionalUser();
  const { isLoading: instantLoading, user: instantUser, error: instantAuthError } =
    db.useAuth();
  const [uploads, setUploads] = useState<UploadState>({});
  const [error, setError] = useState<string | null>(null);
  const [templateConfig, setTemplateConfig] = useState<TemplateConfig | null>(null);
  const [templateConfigError, setTemplateConfigError] = useState<string | null>(null);
  const [templateConfigLoading, setTemplateConfigLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [estimateMode, setEstimateMode] = useState<"workbook" | "estimate">(
    "workbook"
  );
  const [estimateValues, setEstimateValues] = useState<
    Record<string, string | number>
  >({});
  const [estimatePayload, setEstimatePayload] = useState<Record<string, any> | null>(
    null
  );
  const [estimateName, setEstimateName] = useState("");
  const [selectedEstimate, setSelectedEstimate] = useState<UploadedFile | null>(
    null
  );
  const [authError, setAuthError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamSaving, setTeamSaving] = useState(false);
  const [editingEstimateId, setEditingEstimateId] = useState<string | null>(null);
  const [loadedEstimatePayload, setLoadedEstimatePayload] = useState<Record<
    string,
    any
  > | null>(null);
  const [library, setLibrary] = useState<LibraryState>({
    workbook: { items: [], loading: false, error: null },
    template: { items: [], loading: false, error: null },
    template_config: { items: [], loading: false, error: null },
    estimate: { items: [], loading: false, error: null },
  });

  const emailAddress = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? "";
  const emailDomain = emailAddress.split("@")[1] ?? "";
  const allowedDomain = (
    process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "cornerstonecompaniesfl.com"
  )
    .trim()
    .toLowerCase();
  const teamDomain = (allowedDomain || emailDomain || "").trim();
  const teamLookupDomain = teamDomain || "__none__";

  const teamQuery = instantAppId
    ? {
        teams: {
          $: { where: { domain: teamLookupDomain } },
          memberships: { user: {} },
          estimates: { owner: {} },
        },
      }
    : { teams: { $: { where: { domain: "__none__" } } } };

  const { data: teamData } = db.useQuery(teamQuery);

  const currentTeam = teamData?.teams?.[0] ?? null;
  const teamMembership = currentTeam?.memberships?.find(
    (membership) => membership.user?.id === instantUser?.id
  );
  const teamEstimates = useMemo(() => {
    const list = currentTeam?.estimates ?? [];
    return [...list].sort(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    );
  }, [currentTeam?.estimates]);

  const hasEstimateValues = useMemo(() => {
    if (estimatePayload?.values) {
      return Object.values(estimatePayload.values).some((value) =>
        String(value ?? "").trim()
      );
    }
    return Object.values(estimateValues).some((value) =>
      String(value ?? "").trim()
    );
  }, [estimatePayload, estimateValues]);
  const canGenerate = Boolean(
    templateConfig?.templatePdf?.url &&
      (estimateMode === "workbook" ? uploads.workbook : hasEstimateValues)
  );
  const progressSteps = useMemo(
    () => [
      {
        label:
          estimateMode === "estimate"
            ? "Loading estimate values"
            : "Downloading workbook",
        value: 0.2,
      },
      { label: "Downloading template", value: 0.4 },
      {
        label:
          estimateMode === "estimate"
            ? "Formatting estimate data"
            : "Reading Excel data",
        value: 0.58,
      },
      { label: "Stamping PDF pages", value: 0.78 },
      { label: "Finalizing download", value: 0.9 },
    ],
    [estimateMode]
  );

  useEffect(() => {
    if (!teamName && teamDomain) {
      const base = teamDomain.split(".")[0] || "Cornerstone";
      setTeamName(`${base.charAt(0).toUpperCase()}${base.slice(1)} Team`);
    }
  }, [teamDomain, teamName]);

  useEffect(() => {
    if (!estimatePayload) {
      setEditingEstimateId(null);
    }
  }, [estimatePayload]);

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

  const status = useMemo(() => {
    if (isGenerating) {
      return {
        label: "Generating PDF",
        helper: "Stamping pages and merging overlays.",
        tone: "loading" as const,
      };
    }

    if (canGenerate) {
      const inputLabel = estimateMode === "estimate" ? "Estimate" : "Workbook";
      return {
        label: "Ready to generate",
        helper: `${inputLabel} and template are ready.`,
        tone: "ready" as const,
      };
    }

    return {
      label: estimateMode === "estimate" ? "Awaiting estimate" : "Awaiting uploads",
      helper:
        estimateMode === "estimate"
          ? "Enter estimate values and select a template to begin."
          : "Upload the workbook and select a template to begin.",
      tone: "idle" as const,
    };
  }, [isGenerating, canGenerate, estimateMode]);

  const statusClassName = cn(
    "border px-4 py-1 text-[10px] tracking-[0.32em]",
    status.tone === "loading" &&
      "border-accent/40 bg-accent/20 text-accent-foreground",
    status.tone === "ready" && "border-white/40 bg-white/10 text-white",
    status.tone === "idle" && "border-white/20 bg-white/5 text-white/70"
  );

  const handleGenerate = async () => {
    setError(null);
    if (!templateConfig?.templatePdf?.url) {
      setError("Select a template from the library.");
      return;
    }
    if (estimateMode === "workbook" && !uploads.workbook) {
      setError("Upload the workbook to continue.");
      return;
    }
    if (estimateMode === "estimate" && !hasEstimateValues) {
      setError("Enter at least one estimate value or load a saved estimate.");
      return;
    }

    const mappingOverride =
      templateConfig?.mapping && !uploads.mapping
        ? templateConfig.mapping
        : undefined;
    const coordsOverride =
      templateConfig?.coords && !uploads.coords ? templateConfig.coords : undefined;

    setIsGenerating(true);
    setProgress(0.1);
    setProgressLabel("Starting generation");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workbookUrl:
            estimateMode === "workbook" ? uploads.workbook?.url : undefined,
          templatePdfUrl: templateConfig.templatePdf.url,
          mappingUrl: uploads.mapping?.url,
          coordsUrl: uploads.coords?.url,
          mappingOverride,
          coordsOverride,
          estimate:
            estimateMode === "estimate"
              ? {
                  ...(estimatePayload ?? {}),
                  name: estimateName.trim(),
                  values:
                    estimatePayload?.values ??
                    (Object.keys(estimateValues).length ? estimateValues : undefined),
                }
              : undefined,
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveEstimateToDb = async () => {
    setError(null);
    if (!instantAppId) {
      setError("InstantDB is not configured yet.");
      return;
    }
    if (!instantUser) {
      setError("Sign in to save estimates.");
      return;
    }
    if (!currentTeam || !teamMembership) {
      setError("Create or join a team to save estimates.");
      return;
    }
    if (!estimatePayload && !Object.keys(estimateValues).length) {
      setError("Enter estimate values before saving.");
      return;
    }

    const now = Date.now();
    const payload = estimatePayload ?? { values: estimateValues };
    const title = estimateName.trim() || "Untitled Estimate";
    const totals = payload?.totals ?? null;

    if (editingEstimateId) {
      await db.transact(
        db.tx.estimates[editingEstimateId]
          .update({
            title,
            status: "draft",
            updatedAt: now,
            templateName: templateConfig?.name,
            templateUrl: templateConfig?.templatePdf?.url,
            payload,
            totals,
          })
          .link({ team: currentTeam.id, owner: instantUser.id })
      );
      return;
    }

    const estimateId = id();
    await db.transact(
      db.tx.estimates[estimateId]
        .create({
          title,
          status: "draft",
          createdAt: now,
          updatedAt: now,
          templateName: templateConfig?.name,
          templateUrl: templateConfig?.templatePdf?.url,
          payload,
          totals,
        })
        .link({ team: currentTeam.id, owner: instantUser.id })
    );
    setEditingEstimateId(estimateId);
  };

  const handleCreateTeam = async () => {
    setTeamError(null);
    if (!instantAppId) {
      setTeamError("InstantDB is not configured yet.");
      return;
    }
    if (!instantUser) {
      setTeamError("Sign in to create a team workspace.");
      return;
    }
    if (!teamDomain) {
      setTeamError("Missing an allowed email domain.");
      return;
    }
    const now = Date.now();
    const teamId = id();
    const membershipId = id();
    const trimmedName = teamName.trim() || `${teamDomain} Team`;

    setTeamSaving(true);
    try {
      await db.transact([
        db.tx.teams[teamId].create({
          name: trimmedName,
          domain: teamDomain,
          createdAt: now,
        }),
        db.tx.memberships[membershipId]
          .create({ role: "owner", createdAt: now })
          .link({ team: teamId, user: instantUser.id }),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setTeamError(message);
    } finally {
      setTeamSaving(false);
    }
  };

  const handleJoinTeam = async () => {
    setTeamError(null);
    if (!instantAppId) {
      setTeamError("InstantDB is not configured yet.");
      return;
    }
    if (!instantUser || !currentTeam) return;
    const now = Date.now();
    const membershipId = id();
    setTeamSaving(true);
    try {
      await db.transact(
        db.tx.memberships[membershipId]
          .create({ role: "member", createdAt: now })
          .link({ team: currentTeam.id, user: instantUser.id })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setTeamError(message);
    } finally {
      setTeamSaving(false);
    }
  };

  const handleLoadTeamEstimate = (estimate: any) => {
    setEstimateMode("estimate");
    setError(null);
    setEstimateName(estimate?.title ?? "");
    setLoadedEstimatePayload(estimate?.payload ?? null);
    setEditingEstimateId(estimate?.id ?? null);
  };

  const loadLibrary = async (type: LibraryType) => {
    setLibrary((prev) => ({
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
      setLibrary((prev) => ({
        ...prev,
        [type]: {
          ...prev[type],
          items: Array.isArray(data.items) ? data.items : [],
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setLibrary((prev) => ({
        ...prev,
        [type]: { ...prev[type], error: message },
      }));
    } finally {
      setLibrary((prev) => ({
        ...prev,
        [type]: { ...prev[type], loading: false },
      }));
    }
  };

  const handleLibrarySelect = (type: LibraryType, item: { name: string; url: string }) => {
    if (!item.url) {
      setError("Selected item has no URL. Try refreshing the library.");
      return;
    }
    setError(null);
    setUploads((prev) => ({
      ...prev,
      [type]: { name: item.name, url: item.url },
    }));
    if (type === "template") {
      setTemplateConfig(null);
    }
  };

  const handleLibraryDeleteAll = async (type: LibraryType) => {
    setLibrary((prev) => ({
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
      setLibrary((prev) => ({
        ...prev,
        [type]: { ...prev[type], items: [] },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setLibrary((prev) => ({
        ...prev,
        [type]: { ...prev[type], error: message },
      }));
    } finally {
      setLibrary((prev) => ({
        ...prev,
        [type]: { ...prev[type], loading: false },
      }));
    }
  };

  useEffect(() => {
    void loadLibrary("workbook");
    void loadLibrary("template_config");
  }, []);

  const handleSelectTemplateConfig = async (item: LibraryItem) => {
    if (!item.url) {
      setTemplateConfigError("Selected template has no URL.");
      return;
    }
    setTemplateConfigError(null);
    setTemplateConfigLoading(true);
    try {
      const response = await fetch(item.url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load template configuration.");
      }
      const data = (await response.json()) as TemplateConfig;
      if (!data?.templatePdf?.url) {
        throw new Error("Template configuration is missing a PDF.");
      }
      setTemplateConfig(data);
      setUploads((prev) => ({
        ...prev,
        template: { name: data.templatePdf.name, url: data.templatePdf.url },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setTemplateConfigError(message);
    } finally {
      setTemplateConfigLoading(false);
    }
  };

  const templateCard = (
    <Card className="border-border/60 bg-card/80 shadow-elevated">
      <CardHeader>
        <CardTitle className="text-2xl font-serif">Template Library</CardTitle>
        <CardDescription>
          Apply a saved PDF template with its calibrated coordinates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {templateConfigError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {templateConfigError}
          </div>
        ) : null}
        {templateConfigLoading ? (
          <div className="text-sm text-muted-foreground">
            Loading template configuration...
          </div>
        ) : null}
        {library.template_config.loading ? (
          <div className="text-sm text-muted-foreground">
            Loading template library...
          </div>
        ) : library.template_config.items.length ? (
          <ScrollArea className="h-56 rounded-lg border border-border/70 bg-background/70">
            <div className="divide-y divide-border/60">
              {library.template_config.items.map((item) => (
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
                    onClick={() => handleSelectTemplateConfig(item)}
                  >
                    Use template
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="text-sm text-muted-foreground">
            No templates yet. Create one in the admin portal.
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>
            Selected template:{" "}
            <span className="text-foreground">
              {templateConfig?.name ?? "None"}
            </span>
          </span>
          {templateConfig ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTemplateConfig(null)}
            >
              Clear selection
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => loadLibrary("template_config")}
          >
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <main className="relative min-h-screen overflow-hidden">
      <InstantAuthSync onDomainError={setAuthError} />
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/2 h-72 w-[520px] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute top-24 right-0 h-72 w-72 rounded-full bg-foreground/10 blur-3xl" />
      </div>
      <div className="container relative py-12">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {!clerkEnabled ? (
              <span>Clerk auth is not configured yet.</span>
            ) : authLoaded ? (
              isSignedIn ? (
                <span>Signed in as {user?.primaryEmailAddress?.emailAddress}</span>
              ) : (
                <span>Sign in to save and share estimates.</span>
              )
            ) : (
              <span>Loading account...</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {clerkEnabled && isSignedIn ? (
              <SignOutButton>
                <Button variant="outline" size="sm">
                  Sign out
                </Button>
              </SignOutButton>
            ) : clerkEnabled ? (
              <SignInButton mode="modal">
                <Button variant="accent" size="sm">
                  Sign in
                </Button>
              </SignInButton>
            ) : (
              <Button variant="outline" size="sm" disabled>
                Sign in
              </Button>
            )}
          </div>
        </div>
        {authError ? (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {authError}
          </div>
        ) : null}
        {!instantAppId ? (
          <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            InstantDB is not configured. Add `NEXT_PUBLIC_INSTANTDB_APP_ID` to
            enable team estimates.
          </div>
        ) : null}
        <section className="relative overflow-hidden rounded-[32px] border border-border/60 bg-foreground text-white shadow-elevated">
          <div className="absolute -right-28 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
          <div className="absolute bottom-0 left-10 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
          <div className="relative grid gap-8 p-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-6">
              <BrandMark tone="dark" />
              <div className="space-y-4">
                <Badge variant="outline" className={statusClassName}>
                  {status.label}
                </Badge>
                <div className="space-y-3">
                  <h1 className="text-4xl font-serif tracking-tight md:text-5xl">
                    New Construction Proposal Studio
                  </h1>
                  <p className="max-w-xl text-base text-white/70">
                    Convert Excel-driven bids into finished Cornerstone proposals
                    with calibrated PDF stamping and branded outputs in minutes.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric
                  icon={FileText}
                  label="Inputs"
                  value="Workbook or Estimate"
                />
                <Metric icon={FileDown} label="Output" value="6-page PDF" />
                <Metric
                  icon={Sparkles}
                  label="Automation"
                  value="Precise stamping"
                />
              </div>
            </div>
            <Card className="border-white/10 bg-white/10 text-white shadow-none">
              <CardHeader>
                <CardTitle className="text-xl text-white">
                  Workflow Overview
                </CardTitle>
                <CardDescription className="text-white/60">
                  {status.helper}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  "Enter estimate values or upload the job workbook",
                  "Select a saved proposal template",
                  "Generate and download the stamped proposal",
                ].map((step, index) => (
                  <div
                    key={step}
                    className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-sm font-semibold">
                      {index + 1}
                    </div>
                    <p className="text-sm text-white/70">{step}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>

        {authLoaded && isSignedIn ? (
          <section className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="border-border/60 bg-card/80 shadow-elevated">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">Team Workspace</CardTitle>
                <CardDescription>
                  InstantDB keeps shared estimates synced for your domain.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {instantAuthError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {instantAuthError.message}
                  </div>
                ) : null}
                {teamError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {teamError}
                  </div>
                ) : null}
                {instantLoading ? (
                  <div className="text-sm text-muted-foreground">
                    Connecting to InstantDB...
                  </div>
                ) : null}

                {currentTeam ? (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Team name</p>
                      <p className="text-lg font-semibold text-foreground">
                        {currentTeam.name}
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Domain: {currentTeam.domain}
                    </div>
                    {teamMembership ? (
                      <Badge variant="outline" className="bg-background/80">
                        Member
                      </Badge>
                    ) : (
                      <Button
                        variant="accent"
                        onClick={() => void handleJoinTeam()}
                        disabled={teamSaving || !instantUser}
                      >
                        {teamSaving ? "Joining..." : "Join team"}
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">
                        Team name
                      </label>
                      <input
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        value={teamName}
                        onChange={(event) => setTeamName(event.target.value)}
                        placeholder="Cornerstone Estimators"
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Domain: {teamDomain || "Unknown"}
                    </div>
                    <Button
                      variant="accent"
                      onClick={() => void handleCreateTeam()}
                      disabled={teamSaving || !instantUser}
                    >
                      {teamSaving ? "Creating..." : "Create team workspace"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="border-border/60 bg-card/80 shadow-elevated">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">
                  Team Estimates
                </CardTitle>
                <CardDescription>
                  Shared estimates for {currentTeam?.name ?? "your team"}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!currentTeam || !teamMembership ? (
                  <div className="text-sm text-muted-foreground">
                    Create or join a team to access shared estimates.
                  </div>
                ) : teamEstimates.length ? (
                  <ScrollArea className="h-56 rounded-lg border border-border/70 bg-background/70">
                    <div className="divide-y divide-border/60">
                      {teamEstimates.map((estimate) => (
                        <div
                          key={estimate.id}
                          className="flex items-center justify-between gap-4 px-4 py-3"
                        >
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {estimate.title ?? "Untitled"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {estimate.updatedAt
                                ? new Date(estimate.updatedAt).toLocaleString()
                                : "No timestamp"}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleLoadTeamEstimate(estimate)}
                          >
                            Load
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No shared estimates yet.
                  </div>
                )}
                {editingEstimateId ? (
                  <div className="text-xs text-muted-foreground">
                    Editing a shared estimate. Use “Save to team” to update it.
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </section>
        ) : null}

        <section
          className={cn(
            "mt-12 grid gap-6",
            estimateMode === "estimate" ? "" : "lg:grid-cols-2"
          )}
        >
          <div className="space-y-6">
            <Tabs
              value={estimateMode}
              onValueChange={(value) =>
                setEstimateMode(value as "workbook" | "estimate")
              }
              className="space-y-4"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="workbook">Excel Workbook</TabsTrigger>
                <TabsTrigger value="estimate">Manual Estimate</TabsTrigger>
              </TabsList>
              <TabsContent value="workbook">
                <UploadCard
                  title="Excel Workbook"
                  description="Job info + bid sheet values (.xlsx)."
                  endpoint="workbook"
                  tag="Required"
                  selected={uploads.workbook}
                  allowedContent=".xlsx only"
                  uploadLabel="Drop the workbook here or browse"
                  library={library.workbook}
                  onUpload={(file) => {
                    setError(null);
                    setUploads((prev) => ({ ...prev, workbook: file }));
                    setEstimateMode("workbook");
                    void loadLibrary("workbook");
                  }}
                  onError={setError}
                  onSelectLibrary={(item) => {
                    handleLibrarySelect("workbook", item);
                    setEstimateMode("workbook");
                  }}
                  onRefreshLibrary={() => loadLibrary("workbook")}
                  onDeleteLibrary={() => handleLibraryDeleteAll("workbook")}
                />
              </TabsContent>
              <TabsContent value="estimate">
                <EstimateBuilderCard
                  values={estimateValues}
                  onValuesChange={setEstimateValues}
                  name={estimateName}
                  onNameChange={setEstimateName}
                  selectedEstimate={selectedEstimate}
                  onSelectEstimate={setSelectedEstimate}
                  onEstimatePayloadChange={setEstimatePayload}
                  loadPayload={loadedEstimatePayload}
                  onActivate={() => {
                    setEstimateMode("estimate");
                    setError(null);
                  }}
                />
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => void handleSaveEstimateToDb()}
                    disabled={!isSignedIn || !teamMembership}
                  >
                    {editingEstimateId ? "Update team estimate" : "Save to team"}
                  </Button>
                  {editingEstimateId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setLoadedEstimatePayload(null);
                        setEditingEstimateId(null);
                        setEstimateName("");
                        setEstimateValues({});
                        setEstimatePayload(null);
                      }}
                    >
                      New estimate
                    </Button>
                  ) : null}
                  {!clerkEnabled ? (
                    <span className="text-xs text-muted-foreground">
                      Configure Clerk + InstantDB to enable team saving.
                    </span>
                  ) : !isSignedIn || !teamMembership ? (
                    <span className="text-xs text-muted-foreground">
                      Sign in with Microsoft and join a team to save estimates.
                    </span>
                  ) : null}
                </div>
              </TabsContent>
            </Tabs>
            {estimateMode === "estimate" ? templateCard : null}
          </div>
          {estimateMode === "estimate" ? null : templateCard}
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <AdvancedOverridesCard
            mapping={uploads.mapping}
            coords={uploads.coords}
            onUploadMapping={(file) => {
              setError(null);
              setUploads((prev) => ({ ...prev, mapping: file }));
            }}
            onUploadCoords={(file) => {
              setError(null);
              setUploads((prev) => ({ ...prev, coords: file }));
            }}
            onError={setError}
          />
          <Card className="border-border/60 bg-card/80 shadow-elevated">
            <CardHeader>
              <CardTitle className="text-2xl font-serif">
                Generate Proposal
              </CardTitle>
              <CardDescription>
                Combine selected inputs into a branded PDF download.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
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
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Input source</span>
                  <span className="text-right font-medium text-foreground">
                    {estimateMode === "estimate" ? "Manual estimate" : "Workbook"}
                  </span>
                </div>
                {estimateMode === "estimate" ? (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Estimate</span>
                    <span className="text-right font-medium text-foreground">
                      {estimateName.trim() ||
                        selectedEstimate?.name ||
                        (hasEstimateValues ? "Manual entry" : "Not started")}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Workbook</span>
                    <span className="text-right font-medium text-foreground">
                      {uploads.workbook?.name ?? "Not selected"}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Template</span>
                  <span className="text-right font-medium text-foreground">
                    {templateConfig?.name ?? "Not selected"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Mapping</span>
                  <span className="text-right text-muted-foreground">
                    {uploads.mapping?.name ??
                      (templateConfig?.mapping ? "Template config" : "Default")}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Coordinates</span>
                  <span className="text-right text-muted-foreground">
                    {uploads.coords?.name ??
                      (templateConfig?.coords ? "Template config" : "Default")}
                  </span>
                </div>
              </div>
              <Separator />
              <div className="flex flex-col gap-3">
                <Button
                  variant="accent"
                  size="lg"
                  onClick={handleGenerate}
                  disabled={!canGenerate || isGenerating}
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowDownToLine className="h-4 w-4" />
                  )}
                  {isGenerating ? "Generating..." : "Generate Proposal PDF"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setUploads({});
                    setTemplateConfig(null);
                    setEstimateValues({});
                    setEstimateName("");
                    setSelectedEstimate(null);
                    setEstimatePayload(null);
                    setLoadedEstimatePayload(null);
                    setEditingEstimateId(null);
                  }}
                  disabled={isGenerating}
                >
                  Clear inputs
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Generated PDFs are produced on demand and downloaded immediately.
              </p>
            </CardContent>
          </Card>
        </section>

        <Separator className="my-12" />

        <footer className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>
            UploadThing handles file storage. Files can be re-used from the
            library tabs in each section.
          </span>
          <div className="flex items-center gap-4">
            <Link className="hover:text-foreground" href="/admin">
              Admin portal
            </Link>
            <span>Cornerstone Proposal Generator · v{APP_VERSION}</span>
          </div>
        </footer>
      </div>
    </main>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20">
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.3em] text-white/50">
          {label}
        </p>
        <p className="text-sm font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}
