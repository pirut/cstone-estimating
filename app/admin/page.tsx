import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import AdminMappingDashboard from "@/components/admin-mapping-dashboard";
import TeamAdminDashboard from "@/components/team-admin-dashboard";

type AdminPageProps = {
  searchParams?: {
    section?: string;
  };
};

export default function UnifiedAdminPage({ searchParams }: AdminPageProps) {
  const section = searchParams?.section === "mapping" ? "mapping" : "team";

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
                Team operations and PandaDoc mapping in one place
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                asChild
                size="sm"
                variant={section === "team" ? "secondary" : "outline"}
                className={cn(section === "team" && "shadow-sm")}
              >
                <Link href="/admin?section=team">Team Operations</Link>
              </Button>
              <Button
                asChild
                size="sm"
                variant={section === "mapping" ? "secondary" : "outline"}
                className={cn(section === "mapping" && "shadow-sm")}
              >
                <Link href="/admin?section=mapping">PandaDoc Mapping</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {section === "mapping" ? <AdminMappingDashboard /> : <TeamAdminDashboard />}
    </div>
  );
}
