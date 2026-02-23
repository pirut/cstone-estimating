import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import AdminMappingDashboard from "@/components/admin-mapping-dashboard";
import TeamAdminDashboard from "@/components/team-admin-dashboard";

export default function UnifiedAdminPage() {
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
