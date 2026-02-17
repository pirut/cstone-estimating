import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container py-12">
        <Card className="mx-auto max-w-2xl rounded-3xl border-border/60 bg-card/85 shadow-elevated">
          <CardHeader className="space-y-3">
            <Badge variant="muted" className="w-fit bg-muted/80 text-[10px]">
              Deprecated
            </Badge>
            <CardTitle className="text-3xl font-serif">
              Legacy Template System Removed
            </CardTitle>
            <CardDescription>
              PDF calibration, coordinate mapping, and workbook-based template tools
              are no longer part of the active workflow.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Proposal generation now runs from the manual estimate builder into
              PandaDoc only.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="accent" size="sm">
                <Link href="/">Open Proposal Workspace</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/team-admin">Open Team Admin</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
