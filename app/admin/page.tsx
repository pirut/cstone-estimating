"use client";

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
import TeamAdminDashboard from "@/components/team-admin-dashboard";
import { SignInButton, clerkEnabled, useOptionalAuth } from "@/lib/clerk";
import { Loader2 } from "lucide-react";

export default function UnifiedAdminPage() {
  const { isLoaded, isSignedIn } = useOptionalAuth();

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

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="w-full px-4 py-3 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-background/80">
                Unified Admin
              </Badge>
              <span className="text-sm text-muted-foreground">
                Team operations and PandaDoc mapping in one dashboard
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild size="sm" variant="secondary">
                <a href="#team-operations">Team Operations</a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href="#pandadoc-mapping">PandaDoc Mapping</a>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <TeamAdminDashboard embedded />
      <AdminMappingDashboard embedded />
    </div>
  );
}
