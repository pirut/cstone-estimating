"use client";

import Link from "next/link";
import { useState } from "react";
import AdminMappingDashboard from "@/components/admin-mapping-dashboard";
import { ConvexAuthSync } from "@/components/convex-auth-sync";
import TeamAdminDashboard from "@/components/team-admin-dashboard";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SignInButton, clerkEnabled, useOptionalAuth } from "@/lib/clerk";
import {
  ArrowRight,
  FileStack,
  FolderKanban,
  Loader2,
  UsersRound,
  WandSparkles,
} from "lucide-react";

type AdminTab = "workspace" | "catalog" | "records" | "pandadoc";

export default function UnifiedAdminPage() {
  const { isLoaded, isSignedIn } = useOptionalAuth();
  const [convexSetupError, setConvexSetupError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("workspace");

  if (!clerkEnabled) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
        <Card className="w-full max-w-lg border-border/60 bg-card/85 shadow-elevated">
          <CardHeader>
            <CardTitle className="text-2xl font-serif">Admin unavailable</CardTitle>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (!isLoaded) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
        <Card className="w-full max-w-lg border-border/60 bg-card/85 shadow-elevated">
          <CardHeader>
            <CardTitle className="text-2xl font-serif">Loading admin access</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking sign-in status...
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!isSignedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
        <Card className="w-full max-w-lg border-border/60 bg-card/85 shadow-elevated">
          <CardHeader>
            <CardTitle className="text-2xl font-serif">Sign in required</CardTitle>
          </CardHeader>
          <CardContent>
            <SignInButton mode="modal">
              <Button variant="accent" size="sm">
                Sign in with Microsoft
              </Button>
            </SignInButton>
          </CardContent>
        </Card>
      </main>
    );
  }

  const isClerkRetrying = Boolean(
    convexSetupError &&
      convexSetupError.toLowerCase().includes("clerk is temporarily unavailable")
  );
  const convexSetupBanner = convexSetupError
    ? isClerkRetrying
      ? "Clerk is temporarily unavailable. Retrying sign-in in about 15 seconds."
      : `Convex auth issue: ${convexSetupError}`
    : null;

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-background">
      <ConvexAuthSync
        onAuthError={setConvexSetupError}
        onDomainError={setConvexSetupError}
      />

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 top-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute right-0 top-12 h-80 w-80 rounded-full bg-foreground/10 blur-3xl" />
      </div>

      <div className="relative w-full px-4 py-6 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
        <section className="relative overflow-hidden rounded-[34px] border border-border/60 bg-[#18120d] p-7 text-[#f8efe2] shadow-elevated md:p-9">
          <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-accent/25 blur-3xl" />
          <div className="absolute -bottom-16 left-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
          <div className="relative grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <Badge variant="outline" className="border-white/30 bg-white/10 text-white">
                Admin Operations Atlas
              </Badge>
              <div className="space-y-2">
                <h1 className="text-4xl font-serif leading-tight tracking-tight md:text-5xl">
                  One dashboard for teams, catalogs, projects, estimates, and PandaDoc routing.
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setActiveTab("workspace")}>
                  Team Ops
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/25 bg-white/5 text-white hover:bg-white/10"
                  onClick={() => setActiveTab("catalog")}
                >
                  Catalog
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/25 bg-white/5 text-white hover:bg-white/10"
                  onClick={() => setActiveTab("records")}
                >
                  Projects + Estimates
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/25 bg-white/5 text-white hover:bg-white/10"
                  onClick={() => setActiveTab("pandadoc")}
                >
                  PandaDoc Mapping
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/65">
                  Workspace
                </p>
                <p className="mt-1 text-xl font-semibold text-white">Team + Roles</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/65">
                  Catalog
                </p>
                <p className="mt-1 text-xl font-semibold text-white">Pricing Inputs</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/65">
                  Records
                </p>
                <p className="mt-1 text-xl font-semibold text-white">Projects + Estimates</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/65">
                  Mapping
                </p>
                <p className="mt-1 text-xl font-semibold text-white">PandaDoc Rules</p>
              </div>
            </div>
          </div>
        </section>

        {convexSetupBanner ? (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
            {convexSetupBanner}
          </div>
        ) : null}

        <section className="mt-4 rounded-2xl border border-border/60 bg-card/80 p-3 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Focus Tabs
            </p>
            <div className="flex items-center gap-2">
              <ThemeToggle className="h-9 w-9 bg-background/70" />
              <Button asChild variant="accent" size="sm">
                <Link href="/">
                  Proposal workspace
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as AdminTab)}
            className="w-full"
          >
            <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0 md:grid-cols-4">
              <TabsTrigger value="workspace" className="justify-start gap-2 rounded-xl border border-border/60 bg-background/60 px-3 py-2 data-[state=active]:bg-accent/20">
                <UsersRound className="h-4 w-4" />
                Workspace
              </TabsTrigger>
              <TabsTrigger value="catalog" className="justify-start gap-2 rounded-xl border border-border/60 bg-background/60 px-3 py-2 data-[state=active]:bg-accent/20">
                <WandSparkles className="h-4 w-4" />
                Catalog
              </TabsTrigger>
              <TabsTrigger value="records" className="justify-start gap-2 rounded-xl border border-border/60 bg-background/60 px-3 py-2 data-[state=active]:bg-accent/20">
                <FolderKanban className="h-4 w-4" />
                Projects & Estimates
              </TabsTrigger>
              <TabsTrigger value="pandadoc" className="justify-start gap-2 rounded-xl border border-border/60 bg-background/60 px-3 py-2 data-[state=active]:bg-accent/20">
                <FileStack className="h-4 w-4" />
                PandaDoc Mapping
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </section>

        {(activeTab === "workspace" || activeTab === "catalog") ? (
          <section className="mt-6 scroll-mt-24 space-y-3">
            <div className="rounded-2xl border border-border/60 bg-card/70 px-4 py-3 sm:px-5">
              <h2 className="text-xl font-serif">
                {activeTab === "workspace"
                  ? "Workspace and Team Operations"
                  : "Catalog Management"}
              </h2>
            </div>
            <TeamAdminDashboard
              embedded
              includeAuthSync={false}
              showHeader={false}
              showFooter={false}
              includeEstimateSection={false}
              showWorkspaceSections={activeTab === "workspace"}
              showCatalogSection={activeTab === "catalog"}
              sectionId="workspace-teams"
            />
          </section>
        ) : null}

        {(activeTab === "records" || activeTab === "pandadoc") ? (
          <section className="mt-8 scroll-mt-24 space-y-3">
            <div className="rounded-2xl border border-border/60 bg-card/70 px-4 py-3 sm:px-5">
              <h2 className="text-xl font-serif">
                {activeTab === "records"
                  ? "Project and Estimate Operations"
                  : "PandaDoc Mapping and Template Config"}
              </h2>
            </div>
            <AdminMappingDashboard
              embedded
              includeAuthSync={false}
              showHero={false}
              showAmbientBackground={false}
              showRecordSections={activeTab === "records"}
              showMappingSections={activeTab === "pandadoc"}
              sectionId="records-mapping"
            />
          </section>
        ) : null}
      </div>
    </main>
  );
}
