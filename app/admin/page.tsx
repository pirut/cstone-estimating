"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import AdminMappingDashboard from "@/components/admin-mapping-dashboard";
import { ConvexAuthSync } from "@/components/convex-auth-sync";
import TeamAdminDashboard from "@/components/team-admin-dashboard";
import { SignInButton, clerkEnabled, useOptionalAuth } from "@/lib/clerk";
import {
  ArrowRight,
  FileStack,
  FolderKanban,
  Loader2,
  UsersRound,
  WandSparkles,
} from "lucide-react";

export default function UnifiedAdminPage() {
  const { isLoaded, isSignedIn } = useOptionalAuth();
  const [convexSetupError, setConvexSetupError] = useState<string | null>(null);

  if (!clerkEnabled) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
        <Card className="w-full max-w-lg border-border/60 bg-card/85 shadow-elevated">
          <CardHeader>
            <CardTitle className="text-2xl font-serif">Admin unavailable</CardTitle>
            <CardDescription>
              Configure Clerk to access the unified admin dashboard.
            </CardDescription>
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
            <CardDescription>
              Verifying your account before showing dashboard data.
            </CardDescription>
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
            <CardDescription>
              Sign in to view and manage projects, estimates, and PandaDoc mappings.
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
                <p className="max-w-3xl text-sm text-white/75 md:text-base">
                  Rebuilt as a single operational surface so you can manage the whole
                  system without jumping between separate admin pages.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="secondary" size="sm">
                  <a href="#workspace-control">Team and Catalog</a>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="border-white/25 bg-white/5 text-white hover:bg-white/10"
                >
                  <a href="#project-management">Projects and Estimates</a>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="border-white/25 bg-white/5 text-white hover:bg-white/10"
                >
                  <a href="#pandadoc-template">PandaDoc Mapping</a>
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/65">
                  Workspace
                </p>
                <p className="mt-1 text-xl font-semibold text-white">Team + Roles</p>
                <p className="text-xs text-white/65">Owners, admins, and sub-teams</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/65">
                  Catalog
                </p>
                <p className="mt-1 text-xl font-semibold text-white">Pricing Inputs</p>
                <p className="text-xs text-white/65">Vendors, types, and feature options</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/65">
                  Records
                </p>
                <p className="mt-1 text-xl font-semibold text-white">Projects + Estimates</p>
                <p className="text-xs text-white/65">Create, rename, move, and remove</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/65">
                  Mapping
                </p>
                <p className="mt-1 text-xl font-semibold text-white">PandaDoc Rules</p>
                <p className="text-xs text-white/65">Template routing and field bindings</p>
              </div>
            </div>
          </div>
        </section>

        {convexSetupBanner ? (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
            {convexSetupBanner}
          </div>
        ) : null}

        <div className="sticky top-2 z-40 mt-4 rounded-2xl border border-border/60 bg-background/90 p-2 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <a href="#workspace-control">
                  <UsersRound className="h-4 w-4" />
                  Workspace
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href="#catalog-settings">
                  <WandSparkles className="h-4 w-4" />
                  Catalog
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href="#project-management">
                  <FolderKanban className="h-4 w-4" />
                  Projects
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href="#estimate-management">
                  <FileStack className="h-4 w-4" />
                  Estimates
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href="#pandadoc-template">PandaDoc</a>
              </Button>
            </div>
            <Button asChild variant="accent" size="sm">
              <Link href="/">
                Proposal workspace
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        <section id="workspace-control" className="mt-6 scroll-mt-24 space-y-3">
          <div className="rounded-2xl border border-border/60 bg-card/70 px-4 py-3 sm:px-5">
            <h2 className="text-xl font-serif">Workspace, Teams, and Catalog Controls</h2>
            <p className="text-sm text-muted-foreground">
              Organization structure, member roles, team settings, and pricing/product catalogs.
            </p>
          </div>
          <TeamAdminDashboard
            embedded
            includeAuthSync={false}
            showHeader={false}
            showFooter={false}
            includeEstimateSection={false}
            sectionId="workspace-teams"
          />
        </section>

        <section id="records-and-mapping" className="mt-8 scroll-mt-24 space-y-3">
          <div className="rounded-2xl border border-border/60 bg-card/70 px-4 py-3 sm:px-5">
            <h2 className="text-xl font-serif">Project, Estimate, and PandaDoc Operations</h2>
            <p className="text-sm text-muted-foreground">
              Project and estimate lifecycle management plus PandaDoc template routing and binding configuration.
            </p>
          </div>
          <AdminMappingDashboard
            embedded
            includeAuthSync={false}
            showHero={false}
            showAmbientBackground={false}
            sectionId="records-mapping"
          />
        </section>
      </div>
    </main>
  );
}
