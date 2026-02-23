// @ts-nocheck
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConvexAuthSync } from "@/components/convex-auth-sync";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  clerkEnabled,
  useOptionalAuth,
  useOptionalUser,
} from "@/lib/clerk";
import { getSourceFieldKeys } from "@/lib/field-catalog";
import { db, convexAppUrl } from "@/lib/convex";
import {
  getOrganizationScopedTeams,
  pickOrganizationTeam,
} from "@/lib/org-teams";
import type {
  PandaDocTemplateBinding,
  PandaDocTemplateRule,
  TemplateConfig,
} from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Loader2, Plus, RefreshCw, Save, Trash2, WandSparkles } from "lucide-react";

type LibraryItem = {
  key: string;
  name: string;
  uploadedAt: number;
  url: string;
};

type PandaDocTemplateListItem = {
  id: string;
  name: string;
  dateModified?: string;
  dateCreated?: string;
  version?: string;
};

type PandaDocTemplateDetails = {
  id: string;
  name: string;
  roles: Array<{ id: string; name: string; signingOrder?: string }>;
  tokens: Array<{ name: string }>;
  fields: Array<{ name: string; mergeField?: string; type?: string }>;
};

const STATIC_SOURCE_KEYS = getSourceFieldKeys();
const ANY_VENDOR_VALUE = "__any_vendor__";
const ANY_PROJECT_TYPE_VALUE = "__any_project_type__";

function normalizedKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function createBinding(
  details: PandaDocTemplateDetails | null,
  sourceKeys: string[],
  sourceKey = sourceKeys[0] ?? ""
): PandaDocTemplateBinding {
  const firstToken = details?.tokens[0]?.name ?? "";
  return {
    id: `binding-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sourceKey,
    targetType: "token",
    targetName: firstToken,
  };
}

function addFlatKeys(value: unknown, keys: Set<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  Object.keys(value as Record<string, unknown>).forEach((key) => {
    const normalized = key.trim();
    if (!normalized) return;
    keys.add(normalized);
  });
}

function collectKeysFromEstimatePayload(value: unknown, keys: Set<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const payload = value as Record<string, unknown>;
  addFlatKeys(payload, keys);
  addFlatKeys(payload.values, keys);
  addFlatKeys(payload.info, keys);
}

export default function AdminPage() {
  const [configName, setConfigName] = useState("Team PandaDoc Mapping");
  const [templateVersion, setTemplateVersion] = useState(1);
  const [recipientRole, setRecipientRole] = useState("Client");
  const [bindings, setBindings] = useState<PandaDocTemplateBinding[]>([]);
  const [templateRules, setTemplateRules] = useState<PandaDocTemplateRule[]>([]);

  const [search, setSearch] = useState("");
  const [templates, setTemplates] = useState<PandaDocTemplateListItem[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateDetails, setTemplateDetails] = useState<PandaDocTemplateDetails | null>(
    null
  );
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const [activePreset, setActivePreset] = useState<LibraryItem | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [convexSetupError, setConvexSetupError] = useState<string | null>(null);

  const { isLoaded: authLoaded, isSignedIn } = useOptionalAuth();
  const { user } = useOptionalUser();
  const {
    isLoading: convexLoading,
    user: convexUser,
    error: convexAuthError,
  } = db.useAuth();

  const emailAddress = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? "";
  const emailDomain = emailAddress.split("@")[1] ?? "";
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

  const teamQuery = convexAppUrl
    ? {
        teams: {
          $: {
            where: { domain: teamLookupDomain },
            order: { createdAt: "desc" as const },
          },
          memberships: { user: {} },
          estimates: {},
          vendors: {},
          projectTypes: {},
        },
      }
    : {
        teams: {
          $: { where: { domain: "__none__" } },
          memberships: { user: {} },
          estimates: {},
          vendors: {},
          projectTypes: {},
        },
      };

  const { data: teamData, error: teamQueryError, isLoading: teamLoading } =
    db.useQuery(teamQuery);
  const teams = (teamData?.teams ?? []) as Array<any>;
  const orgTeam = useMemo(
    () => pickOrganizationTeam(teams, normalizedOrgTeamName),
    [teams, normalizedOrgTeamName]
  );
  const orgScopedTeams = useMemo(
    () => getOrganizationScopedTeams(teams, orgTeam?.id),
    [orgTeam?.id, teams]
  );
  const allMemberTeams = useMemo(() => {
    if (!convexUser?.id) return [];
    return teams.filter((team) =>
      team.memberships?.some((membership) => membership.user?.id === convexUser.id)
    );
  }, [convexUser?.id, teams]);
  const orgMemberTeams = useMemo(() => {
    if (!convexUser?.id) return [];
    return orgScopedTeams.filter((team) =>
      team.memberships?.some((membership) => membership.user?.id === convexUser.id)
    );
  }, [convexUser?.id, orgScopedTeams]);
  const catalogTeam = orgTeam ?? orgMemberTeams[0] ?? allMemberTeams[0] ?? null;
  const vendorOptions = useMemo(() => {
    const source = Array.isArray(catalogTeam?.vendors) ? catalogTeam.vendors : [];
    const list = source
      .filter((vendor) => vendor?.isActive !== false)
      .map((vendor, index) => ({
        id: String(vendor?.id ?? ""),
        name: String(vendor?.name ?? "").trim(),
        sortOrder:
          typeof vendor?.sortOrder === "number" ? vendor.sortOrder : index + 1,
      }))
      .filter((vendor) => vendor.id && vendor.name);
    return list.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name);
    });
  }, [catalogTeam?.vendors]);
  const projectTypeOptions = useMemo(() => {
    const source = Array.isArray(catalogTeam?.projectTypes)
      ? catalogTeam.projectTypes
      : [];
    const seen = new Set<string>();
    const list = source
      .filter((projectType) => projectType?.isActive !== false)
      .map((projectType, index) => ({
        label: String(projectType?.label ?? "").trim(),
        sortOrder:
          typeof projectType?.sortOrder === "number"
            ? projectType.sortOrder
            : index + 1,
      }))
      .filter((projectType) => projectType.label)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.label.localeCompare(b.label);
      })
      .filter((projectType) => {
        const key = projectType.label.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return list.map((projectType) => projectType.label);
  }, [catalogTeam?.projectTypes]);

  const templateNameById = useMemo(() => {
    const map = new Map<string, string>();
    templates.forEach((template) => {
      map.set(template.id, template.name);
    });
    if (templateDetails?.id && templateDetails.name) {
      map.set(templateDetails.id, templateDetails.name);
    }
    return map;
  }, [templateDetails?.id, templateDetails?.name, templates]);

  const targetTokenNames = useMemo(
    () => (templateDetails?.tokens ?? []).map((token) => token.name),
    [templateDetails?.tokens]
  );
  const targetFieldNames = useMemo(
    () => (templateDetails?.fields ?? []).map((field) => field.name),
    [templateDetails?.fields]
  );
  const orgScopedSourceKeys = useMemo(() => {
    const keys = new Set<string>();
    orgScopedTeams.forEach((team) => {
      (team.estimates ?? []).forEach((estimate) => {
        collectKeysFromEstimatePayload(estimate?.payload, keys);
        if (Array.isArray(estimate?.versionHistory)) {
          estimate.versionHistory.forEach((entry) => {
            collectKeysFromEstimatePayload(
              (entry as { payload?: unknown } | null)?.payload,
              keys
            );
          });
        }
      });
    });

    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [orgScopedTeams]);
  const memberSourceKeys = useMemo(() => {
    const keys = new Set<string>();
    allMemberTeams.forEach((team) => {
      (team.estimates ?? []).forEach((estimate) => {
        collectKeysFromEstimatePayload(estimate?.payload, keys);
        if (Array.isArray(estimate?.versionHistory)) {
          estimate.versionHistory.forEach((entry) => {
            collectKeysFromEstimatePayload(
              (entry as { payload?: unknown } | null)?.payload,
              keys
            );
          });
        }
      });
    });
    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [allMemberTeams]);
  const convexSourceKeys = orgScopedSourceKeys.length
    ? orgScopedSourceKeys
    : memberSourceKeys;
  const sourceKeyOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];
    const baseKeys = convexSourceKeys.length ? convexSourceKeys : STATIC_SOURCE_KEYS;
    baseKeys.forEach((key) => {
      if (seen.has(key)) return;
      seen.add(key);
      options.push(key);
    });
    bindings.forEach((binding) => {
      const key = String(binding.sourceKey ?? "").trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      options.push(key);
    });
    return options;
  }, [bindings, convexSourceKeys]);
  const catalogStatusMessage = useMemo(() => {
    if (!convexAppUrl) return "Convex is not configured for this app.";
    if (clerkEnabled && !authLoaded) return "Loading authentication…";
    if (clerkEnabled && !isSignedIn) return "Sign in to load org catalog keys.";
    if (convexLoading || teamLoading) return "Loading source keys from Convex…";
    if (convexAuthError) return `Convex auth error: ${convexAuthError.message}`;
    if (convexSetupError) return convexSetupError;
    if (teamQueryError) {
      return teamQueryError instanceof Error
        ? teamQueryError.message
        : "Unable to load organization teams.";
    }
    if (!catalogTeam) return "No organization workspace found yet.";
    if (!convexSourceKeys.length) {
      return "No source keys found in saved org estimates yet.";
    }
    if (!orgScopedSourceKeys.length && memberSourceKeys.length) {
      return `Loaded ${memberSourceKeys.length} source key${memberSourceKeys.length === 1 ? "" : "s"} from legacy team estimates (outside org tree).`;
    }
    return `Loaded ${convexSourceKeys.length} source key${convexSourceKeys.length === 1 ? "" : "s"} from Convex.`;
  }, [
    memberSourceKeys.length,
    orgScopedSourceKeys.length,
    authLoaded,
    catalogTeam,
    convexAppUrl,
    convexAuthError,
    convexLoading,
    convexSetupError,
    convexSourceKeys.length,
    isSignedIn,
    teamLoading,
    teamQueryError,
  ]);
  const isClerkRetrying = Boolean(
    convexSetupError &&
      convexSetupError.toLowerCase().includes("clerk is temporarily unavailable")
  );
  const convexSetupBanner = isClerkRetrying
    ? "Clerk is temporarily unavailable. Retrying sign-in in about 15 seconds."
    : convexSetupError
      ? `Convex auth issue: ${convexSetupError}`
      : null;
  const firstTokenName = targetTokenNames[0] ?? "";
  const firstFieldName = targetFieldNames[0] ?? "";

  const loadTemplateDetails = useCallback(async (templateId: string) => {
    const normalized = templateId.trim();
    if (!normalized) {
      setTemplateDetails(null);
      setDetailsError(null);
      return;
    }

    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const response = await fetch(
        `/api/pandadoc/templates/${encodeURIComponent(normalized)}`,
        {
          cache: "no-store",
        }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to load PandaDoc template details.");
      }
      const data = (await response.json()) as {
        template?: PandaDocTemplateDetails;
      };
      if (!data.template?.id) {
        throw new Error("PandaDoc template details are empty.");
      }
      setTemplateDetails(data.template);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setTemplateDetails(null);
      setDetailsError(message);
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  const loadTemplates = useCallback(async (query = "") => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) {
        params.set("q", query.trim());
      }
      params.set("count", "50");
      const response = await fetch(`/api/pandadoc/templates?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to load PandaDoc templates.");
      }
      const data = (await response.json()) as { results?: PandaDocTemplateListItem[] };
      setTemplates(Array.isArray(data.results) ? data.results : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setTemplatesError(message);
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  const loadActivePreset = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError(null);
    try {
      const response = await fetch("/api/library?type=template_config", {
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to load active preset.");
      }
      const data = (await response.json()) as { items?: LibraryItem[] };
      const item = Array.isArray(data.items) ? data.items[0] : null;
      setActivePreset(item ?? null);

      if (!item?.url) return;
      const configResponse = await fetch(item.url, { cache: "no-store" });
      if (!configResponse.ok) {
        throw new Error("Failed to load active preset JSON.");
      }
      const config = (await configResponse.json()) as TemplateConfig;
      const configBindings = Array.isArray(config.pandadoc?.bindings)
        ? config.pandadoc.bindings
        : [];
      const configRules = Array.isArray(config.pandadoc?.rules)
        ? config.pandadoc.rules
        : [];
      setConfigName(config.name || "Team PandaDoc Mapping");
      setTemplateVersion(
        Number.isFinite(Number(config.templateVersion)) &&
          Number(config.templateVersion) > 0
          ? Math.trunc(Number(config.templateVersion))
          : 1
      );
      setRecipientRole(config.pandadoc?.recipientRole ?? "Client");
      setBindings(configBindings);
      setTemplateRules(
        configRules.map((rule, index) => ({
          id:
            String(rule.id ?? "").trim() ||
            `rule-${Date.now()}-${index + 1}`,
          vendorId: String(rule.vendorId ?? "").trim() || undefined,
          vendorName: String(rule.vendorName ?? "").trim() || undefined,
          projectType: String(rule.projectType ?? "").trim() || undefined,
          templateUuid: String(rule.templateUuid ?? "").trim(),
          templateName: String(rule.templateName ?? "").trim() || undefined,
          recipientRole: String(rule.recipientRole ?? "").trim() || undefined,
          isActive: rule.isActive !== false,
        }))
      );

      const presetTemplateId = String(config.pandadoc?.templateUuid ?? "").trim();
      if (presetTemplateId) {
        setSelectedTemplateId(presetTemplateId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setLibraryError(message);
      setActivePreset(null);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
    void loadActivePreset();
  }, [loadActivePreset, loadTemplates]);

  useEffect(() => {
    if (!selectedTemplateId) {
      setTemplateDetails(null);
      setDetailsError(null);
      return;
    }
    void loadTemplateDetails(selectedTemplateId);
  }, [loadTemplateDetails, selectedTemplateId]);

  const updateBinding = (
    bindingId: string,
    patch: Partial<PandaDocTemplateBinding>
  ) => {
    setBindings((prev) =>
      prev.map((binding) => {
        if (binding.id !== bindingId) return binding;
        const next = { ...binding, ...patch };

        if (next.targetType === "field") {
          const matched = (templateDetails?.fields ?? []).find(
            (field) => field.name === next.targetName
          );
          next.targetFieldType = matched?.type ?? undefined;
        } else {
          delete next.targetFieldType;
          delete next.role;
        }

        return next;
      })
    );
  };

  const removeBinding = (bindingId: string) => {
    setBindings((prev) => prev.filter((binding) => binding.id !== bindingId));
  };

  const addBinding = () => {
    setBindings((prev) => [...prev, createBinding(templateDetails, sourceKeyOptions)]);
  };

  const updateTemplateRule = (
    ruleId: string,
    patch: Partial<PandaDocTemplateRule>
  ) => {
    setTemplateRules((prev) =>
      prev.map((rule) => {
        if (rule.id !== ruleId) return rule;
        const next = { ...rule, ...patch };
        const templateUuid = String(next.templateUuid ?? "").trim();
        const templateName =
          templateNameById.get(templateUuid) ||
          String(next.templateName ?? "").trim() ||
          undefined;
        return {
          ...next,
          templateUuid,
          templateName,
          vendorId: String(next.vendorId ?? "").trim() || undefined,
          vendorName: String(next.vendorName ?? "").trim() || undefined,
          projectType: String(next.projectType ?? "").trim() || undefined,
          recipientRole: String(next.recipientRole ?? "").trim() || undefined,
          isActive: next.isActive !== false,
        };
      })
    );
  };

  const removeTemplateRule = (ruleId: string) => {
    setTemplateRules((prev) => prev.filter((rule) => rule.id !== ruleId));
  };

  const addTemplateRule = () => {
    const defaultTemplateUuid =
      selectedTemplateId.trim() ||
      (templates[0]?.id ? String(templates[0].id).trim() : "");
    const defaultTemplateName =
      templateNameById.get(defaultTemplateUuid) ||
      (templates[0]?.name ? String(templates[0].name).trim() : undefined);
    setTemplateRules((prev) => [
      ...prev,
      {
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        templateUuid: defaultTemplateUuid,
        templateName: defaultTemplateName,
        isActive: true,
      },
    ]);
  };

  const handleAutoMap = () => {
    if (!templateDetails) {
      setSaveError("Select a PandaDoc template first.");
      return;
    }

    const tokenLookup = new Map<string, string>();
    const fieldLookup = new Map<string, { name: string; type?: string }>();

    templateDetails.tokens.forEach((token) => {
      const key = normalizedKey(token.name);
      if (!key || tokenLookup.has(key)) return;
      tokenLookup.set(key, token.name);
    });

    templateDetails.fields.forEach((field) => {
      const key = normalizedKey(field.name);
      if (!key || fieldLookup.has(key)) return;
      fieldLookup.set(key, { name: field.name, type: field.type });
    });

    const autoMapSourceKeys = sourceKeyOptions.filter((key) => key.trim().length > 0);
    const nextBindings: PandaDocTemplateBinding[] = [];
    autoMapSourceKeys.forEach((sourceKey, index) => {
      const key = normalizedKey(sourceKey);
      if (!key) return;

      const tokenName = tokenLookup.get(key);
      if (tokenName) {
        nextBindings.push({
          id: `binding-auto-token-${index + 1}`,
          sourceKey,
          targetType: "token",
          targetName: tokenName,
        });
        return;
      }

      const field = fieldLookup.get(key);
      if (field) {
        nextBindings.push({
          id: `binding-auto-field-${index + 1}`,
          sourceKey,
          targetType: "field",
          targetName: field.name,
          targetFieldType: field.type,
          role: recipientRole.trim() || undefined,
        });
      }
    });

    const autoMappedBindingKeys = new Set(
      nextBindings.map((binding) =>
        [binding.sourceKey, binding.targetType, binding.targetName, binding.role ?? ""].join(
          "|"
        )
      )
    );
    const preservedCustomBindings = bindings.filter((binding) => {
      const sourceKey = String(binding.sourceKey ?? "").trim();
      const targetName = String(binding.targetName ?? "").trim();
      if (!sourceKey || !targetName) return false;
      const dedupeKey = [
        sourceKey,
        binding.targetType,
        targetName,
        binding.role ?? "",
      ].join("|");
      return !autoMappedBindingKeys.has(dedupeKey);
    });

    const dedupe = new Set<string>();
    const mergedBindings = [...nextBindings, ...preservedCustomBindings].filter(
      (binding) => {
        const key = [
          binding.sourceKey,
          binding.targetType,
          binding.targetName,
          binding.role ?? "",
        ].join("|");
        if (dedupe.has(key)) return false;
        dedupe.add(key);
        return true;
      }
    );

    setBindings(mergedBindings);
    setSaveError(null);
    setSaveStatus(
      mergedBindings.length
        ? `Auto-mapped ${nextBindings.length} binding${nextBindings.length === 1 ? "" : "s"}${preservedCustomBindings.length ? ` and preserved ${preservedCustomBindings.length} custom binding${preservedCustomBindings.length === 1 ? "" : "s"}` : ""}.`
        : "No matching token or field names found for current source keys."
    );
  };

  const handleSave = async (scope: "routes" | "preset" = "preset") => {
    setSaveError(null);
    setSaveStatus(null);

    const name = configName.trim();
    if (!name) {
      setSaveError("Preset name is required.");
      return;
    }

    const cleanedBindings = bindings
      .map((binding, index) => {
        const sourceKey = String(binding.sourceKey ?? "").trim();
        const targetName = String(binding.targetName ?? "").trim();
        if (!sourceKey || !targetName) return null;
        const targetType = binding.targetType === "field" ? "field" : "token";
        const next: PandaDocTemplateBinding = {
          id: String(binding.id ?? `binding-${index + 1}`),
          sourceKey,
          targetType,
          targetName,
        };
        if (targetType === "field") {
          const role = String(binding.role ?? "").trim();
          if (role) next.role = role;
          const targetFieldType = String(binding.targetFieldType ?? "").trim();
          if (targetFieldType) next.targetFieldType = targetFieldType;
        }
        return next;
      })
      .filter((binding): binding is PandaDocTemplateBinding => Boolean(binding));
    const cleanedRules = templateRules
      .map((rule, index) => {
        const templateUuid = String(rule.templateUuid ?? "").trim();
        if (!templateUuid) return null;
        const vendorId = String(rule.vendorId ?? "").trim();
        const vendorName =
          vendorOptions.find((vendor) => vendor.id === vendorId)?.name ||
          String(rule.vendorName ?? "").trim();
        const projectType = String(rule.projectType ?? "").trim();
        return {
          id: String(rule.id ?? `rule-${index + 1}`).trim() || `rule-${index + 1}`,
          vendorId: vendorId || undefined,
          vendorName: vendorName || undefined,
          projectType: projectType || undefined,
          templateUuid,
          templateName:
            templateNameById.get(templateUuid) ||
            String(rule.templateName ?? "").trim() ||
            undefined,
          recipientRole: String(rule.recipientRole ?? "").trim() || undefined,
          isActive: rule.isActive !== false,
        } satisfies PandaDocTemplateRule;
      })
      .filter((rule): rule is PandaDocTemplateRule => Boolean(rule));
    const templateUuid = selectedTemplateId.trim();
    if (!templateUuid && !cleanedRules.length) {
      setSaveError(
        "Select a default PandaDoc template or add at least one routing rule."
      );
      return;
    }

    setSaveLoading(true);
    try {
      const response = await fetch("/api/template-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          templateVersion,
          description: "PandaDoc variable/field binding preset",
          coords: {},
          pandadoc: {
            templateUuid,
            templateName:
              templateNameById.get(templateUuid) || templateDetails?.name || undefined,
            recipientRole: recipientRole.trim() || undefined,
            bindings: cleanedBindings,
            rules: cleanedRules,
          },
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to save preset.");
      }

      setSaveStatus(
        scope === "routes"
          ? "Template routes saved. The active preset now includes this routing."
          : "Preset saved. Home page generation will use these bindings."
      );
      setTemplateVersion((prev) => prev + 1);
      await loadActivePreset();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setSaveError(message);
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-background">
      <ConvexAuthSync
        onAuthError={setConvexSetupError}
        onDomainError={setConvexSetupError}
      />
      <div className="container space-y-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-3xl font-serif">PandaDoc Mapping Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Link estimate source variables to PandaDoc tokens and fields.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/team-admin">Team Admin</Link>
            </Button>
            <Button asChild variant="accent" size="sm">
              <Link href="/">Proposal Workspace</Link>
            </Button>
          </div>
        </div>
        {convexSetupBanner ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            {convexSetupBanner}
          </div>
        ) : null}

        <Card className="rounded-3xl border-border/60 bg-card/85 shadow-elevated">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <Badge variant="muted" className="bg-muted/80 text-[10px]">
                  Active preset
                </Badge>
                <CardTitle className="text-xl font-serif">Template Config</CardTitle>
                <CardDescription>
                  This preset is read by proposal generation on the main page.
                </CardDescription>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadActivePreset()}
                disabled={libraryLoading}
              >
                {libraryLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {libraryError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {libraryError}
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Preset name
                </label>
                <Input
                  value={configName}
                  onChange={(event) => setConfigName(event.target.value)}
                  placeholder="Team PandaDoc Mapping"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Template version
                </label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={templateVersion}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setTemplateVersion(
                      Number.isFinite(next) && next > 0 ? Math.trunc(next) : 1
                    );
                  }}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {activePreset ? (
                <>
                  Current active preset: <span className="text-foreground">{activePreset.name}</span>{" "}
                  ({new Date(activePreset.uploadedAt).toLocaleString()})
                </>
              ) : (
                "No active preset found yet."
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/60 bg-card/85 shadow-elevated">
          <CardHeader>
            <CardTitle className="text-xl font-serif">PandaDoc Template</CardTitle>
            <CardDescription>
              Choose a PandaDoc template, then map source keys to tokens/fields.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {templatesError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {templatesError}
              </div>
            ) : null}
            {detailsError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {detailsError}
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search PandaDoc templates"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void loadTemplates(search);
                  }
                }}
              />
              <Button
                variant="secondary"
                onClick={() => void loadTemplates(search)}
                disabled={templatesLoading}
              >
                {templatesLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Search
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  PandaDoc template
                </label>
                <Select
                  value={selectedTemplateId || "__none__"}
                  onValueChange={(value) => {
                    setSelectedTemplateId(value === "__none__" ? "" : value);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select PandaDoc template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No template selected</SelectItem>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                    {selectedTemplateId &&
                    !templates.some((template) => template.id === selectedTemplateId) ? (
                      <SelectItem value={selectedTemplateId}>
                        {templateNameById.get(selectedTemplateId) || selectedTemplateId}
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Recipient role (default for field bindings)
                </label>
                <Input
                  value={recipientRole}
                  onChange={(event) => setRecipientRole(event.target.value)}
                  placeholder="Client"
                />
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              {detailsLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading template details...
                </span>
              ) : templateDetails ? (
                <>
                  Loaded: <span className="text-foreground">{templateDetails.name}</span> ·
                  {" "}
                  {templateDetails.roles.length} roles · {templateDetails.tokens.length} tokens ·{" "}
                  {templateDetails.fields.length} fields
                </>
              ) : (
                "Select a PandaDoc template to load roles, tokens, and fields."
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Template Routing Rules
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Route PandaDoc template by vendor + project type. First exact
                    match wins, then less specific matches.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={addTemplateRule}>
                  <Plus className="h-4 w-4" />
                  Add rule
                </Button>
              </div>
              {templateRules.length ? (
                <div className="space-y-2">
                  {templateRules.map((rule) => {
                    const activeVendorId = String(rule.vendorId ?? "").trim();
                    const activeProjectType = String(rule.projectType ?? "").trim();
                    const activeTemplateId = String(rule.templateUuid ?? "").trim();
                    return (
                      <div
                        key={rule.id}
                        className="grid gap-2 rounded-lg border border-border/60 bg-background/70 p-3 md:grid-cols-[0.7fr_1fr_1fr_1fr_1fr_auto]"
                      >
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            Status
                          </label>
                          <label
                            className={`flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 ${
                              rule.isActive !== false
                                ? "border-emerald-500/40 bg-emerald-500/10"
                                : "border-border/60 bg-card/60"
                            }`}
                          >
                            <Checkbox
                              className="h-5 w-5"
                              checked={rule.isActive !== false}
                              onCheckedChange={(checked) =>
                                updateTemplateRule(rule.id, {
                                  isActive: checked === true,
                                })
                              }
                            />
                            <span className="text-sm font-medium text-foreground">
                              Active
                            </span>
                          </label>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            Vendor
                          </label>
                          <Select
                            value={activeVendorId || ANY_VENDOR_VALUE}
                            onValueChange={(value) => {
                              if (value === ANY_VENDOR_VALUE) {
                                updateTemplateRule(rule.id, {
                                  vendorId: undefined,
                                  vendorName: undefined,
                                });
                                return;
                              }
                              const vendor =
                                vendorOptions.find((entry) => entry.id === value) ??
                                null;
                              updateTemplateRule(rule.id, {
                                vendorId: vendor?.id,
                                vendorName: vendor?.name,
                              });
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Any vendor" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={ANY_VENDOR_VALUE}>
                                Any vendor
                              </SelectItem>
                              {vendorOptions.map((vendor) => (
                                <SelectItem key={vendor.id} value={vendor.id}>
                                  {vendor.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            Project type
                          </label>
                          <Select
                            value={activeProjectType || ANY_PROJECT_TYPE_VALUE}
                            onValueChange={(value) =>
                              updateTemplateRule(rule.id, {
                                projectType:
                                  value === ANY_PROJECT_TYPE_VALUE
                                    ? undefined
                                    : value,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Any project type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={ANY_PROJECT_TYPE_VALUE}>
                                Any project type
                              </SelectItem>
                              {projectTypeOptions.map((projectType) => (
                                <SelectItem key={projectType} value={projectType}>
                                  {projectType}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            PandaDoc template
                          </label>
                          <Select
                            value={activeTemplateId || "__none__"}
                            onValueChange={(value) =>
                              updateTemplateRule(rule.id, {
                                templateUuid: value === "__none__" ? "" : value,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select PandaDoc template" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">
                                Select PandaDoc template
                              </SelectItem>
                              {templates.map((template) => (
                                <SelectItem key={template.id} value={template.id}>
                                  {template.name}
                                </SelectItem>
                              ))}
                              {activeTemplateId &&
                              !templates.some(
                                (template) => template.id === activeTemplateId
                              ) ? (
                                <SelectItem value={activeTemplateId}>
                                  {templateNameById.get(activeTemplateId) ||
                                    activeTemplateId}
                                </SelectItem>
                              ) : null}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            Recipient role (optional)
                          </label>
                          <Input
                            value={String(rule.recipientRole ?? "")}
                            onChange={(event) =>
                              updateTemplateRule(rule.id, {
                                recipientRole: event.target.value,
                              })
                            }
                            placeholder="Use default role"
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeTemplateRule(rule.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No routing rules yet. Add rules to map vendor/project type to
                  specific PandaDoc templates.
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  Rule changes are saved to the active template preset.
                </p>
                <Button
                  variant="accent"
                  size="sm"
                  onClick={() => void handleSave("routes")}
                  disabled={saveLoading}
                >
                  {saveLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {saveLoading ? "Saving..." : "Save template routes"}
                </Button>
              </div>
              {saveError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {saveError}
                </div>
              ) : null}
              {saveStatus ? (
                <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  <div>{saveStatus}</div>
                  {activePreset ? (
                    <div className="mt-1 text-xs">
                      Last saved preset: {activePreset.name} (
                      {new Date(activePreset.uploadedAt).toLocaleString()})
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/60 bg-card/85 shadow-elevated">
          <CardHeader>
            <CardTitle className="text-xl font-serif">Field Catalog</CardTitle>
            <CardDescription>
              Source keys for bindings are loaded from Convex org estimate data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {sourceKeyOptions.length} selectable source key
              {sourceKeyOptions.length === 1 ? "" : "s"} available.
            </p>
            <p className="text-xs text-muted-foreground">{catalogStatusMessage}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary" size="sm">
                <a href="/api/field-catalog?format=csv">Download CSV</a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href="/api/field-catalog?format=json&download=1">Download JSON</a>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/60 bg-card/85 shadow-elevated">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-xl font-serif">Bindings</CardTitle>
                <CardDescription>
                  Map estimate source keys to PandaDoc token names or merge fields.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={handleAutoMap}>
                  <WandSparkles className="h-4 w-4" />
                  Auto-map
                </Button>
                <Button variant="outline" size="sm" onClick={addBinding}>
                  <Plus className="h-4 w-4" />
                  Add binding
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-[1fr_auto] items-center gap-3 text-xs text-muted-foreground">
              <span>{bindings.length} binding(s)</span>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-background/80">
                  {targetTokenNames.length} tokens
                </Badge>
                <Badge variant="outline" className="bg-background/80">
                  {targetFieldNames.length} fields
                </Badge>
              </div>
            </div>
            <Separator />

            {bindings.length ? (
              <ScrollArea className="h-[420px] rounded-lg border border-border/60 bg-background/70">
                <div className="space-y-3 p-3">
                  {bindings.map((binding) => {
                    const targetOptions =
                      binding.targetType === "field" ? targetFieldNames : targetTokenNames;
                    const sourceValue = String(binding.sourceKey ?? "").trim();
                    const sourceHasValue = sourceKeyOptions.includes(sourceValue);
                    const targetValue = String(binding.targetName ?? "").trim();
                    const targetHasValue = targetOptions.includes(targetValue);
                    return (
                      <div
                        key={binding.id}
                        className="grid gap-2 rounded-lg border border-border/60 bg-card/80 p-3 md:grid-cols-[1fr_140px_1fr_170px_auto]"
                      >
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            Source key
                          </label>
                          <Select
                            value={sourceHasValue ? sourceValue : "__none__"}
                            onValueChange={(value) =>
                              updateBinding(binding.id, {
                                sourceKey: value === "__none__" ? "" : value,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select source key" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Select source key</SelectItem>
                              {!sourceHasValue && sourceValue ? (
                                <SelectItem value={sourceValue}>
                                  Unavailable: {sourceValue}
                                </SelectItem>
                              ) : null}
                              {sourceKeyOptions.map((key) => (
                                <SelectItem key={key} value={key}>
                                  {key}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            Target type
                          </label>
                          <Select
                            value={binding.targetType}
                            onValueChange={(value) =>
                              updateBinding(binding.id, {
                                targetType: value === "field" ? "field" : "token",
                                targetName:
                                  value === "field" ? firstFieldName : firstTokenName,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="token">Token</SelectItem>
                              <SelectItem value="field">Field</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            Target name
                          </label>
                          <Select
                            value={targetHasValue ? targetValue : "__none__"}
                            onValueChange={(value) =>
                              updateBinding(binding.id, {
                                targetName: value === "__none__" ? "" : value,
                              })
                            }
                            disabled={!targetOptions.length}
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={
                                  binding.targetType === "field"
                                    ? "Select field"
                                    : "Select token"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">
                                {binding.targetType === "field"
                                  ? "Select field"
                                  : "Select token"}
                              </SelectItem>
                              {!targetHasValue && targetValue ? (
                                <SelectItem value={targetValue}>
                                  Unavailable: {targetValue}
                                </SelectItem>
                              ) : null}
                              {targetOptions.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            Role
                          </label>
                          <Select
                            value={binding.role?.trim() || "__none__"}
                            onValueChange={(value) =>
                              updateBinding(binding.id, {
                                role: value === "__none__" ? undefined : value,
                              })
                            }
                            disabled={binding.targetType !== "field"}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="No role" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">No role</SelectItem>
                              {(templateDetails?.roles ?? []).map((role) => (
                                <SelectItem key={role.id} value={role.name}>
                                  {role.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {binding.targetType === "field" && binding.targetFieldType ? (
                            <p className="text-[11px] text-muted-foreground">
                              Type: {binding.targetFieldType}
                            </p>
                          ) : null}
                        </div>

                        <div className="flex items-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => removeBinding(binding.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            ) : (
              <div className="rounded-lg border border-border/60 bg-background/70 px-4 py-6 text-sm text-muted-foreground">
                No bindings yet. Add rows manually or use auto-map.
              </div>
            )}

            {saveError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {saveError}
              </div>
            ) : null}
            {saveStatus ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                {saveStatus}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="accent"
                onClick={() => void handleSave("preset")}
                disabled={saveLoading}
              >
                {saveLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saveLoading ? "Saving..." : "Save preset"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Saving updates the active `template_config` used by generation.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
