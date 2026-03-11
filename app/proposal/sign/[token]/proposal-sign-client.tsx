"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw } from "lucide-react";

type InviteStatusResponse = {
  invalid?: boolean;
  expired?: boolean;
  completed?: boolean;
  invite?: {
    id?: string;
    recipientEmail?: string;
    recipientFirstName?: string;
    recipientLastName?: string;
    recipientRole?: string;
    expiresAt?: number;
    status?: string;
  };
  estimate?: {
    id?: string;
    title?: string;
    pandadocState?: {
      status?: string;
      lastCompletedAt?: number;
    } | null;
  } | null;
  error?: string;
};

type SessionResponse = {
  document?: {
    name?: string;
    status?: string;
  };
  session?: {
    url?: string;
  };
  error?: string;
};

function formatInviteExpiry(timestamp?: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ProposalSignClient({ token }: { token: string }) {
  const [statusData, setStatusData] = useState<InviteStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [localCompletion, setLocalCompletion] = useState(false);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const response = await fetch(
        `/api/proposals/sign/${encodeURIComponent(token)}/status`,
        { cache: "no-store" }
      );
      const data = (await response.json().catch(() => null)) as InviteStatusResponse | null;
      if (!response.ok) {
        throw new Error(data?.error || "Failed to load signing status.");
      }
      setStatusData(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setStatusError(message);
    } finally {
      setStatusLoading(false);
    }
  }, [token]);

  const createSession = useCallback(async () => {
    setSessionLoading(true);
    setSessionError(null);
    try {
      const response = await fetch(
        `/api/proposals/sign/${encodeURIComponent(token)}/session`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      const data = (await response.json().catch(() => null)) as SessionResponse | null;
      if (!response.ok) {
        throw new Error(data?.error || "Failed to create signing session.");
      }
      const nextUrl = String(data?.session?.url ?? "").trim();
      if (!nextUrl) {
        throw new Error("Signing session did not return a URL.");
      }
      setSessionUrl(nextUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setSessionError(message);
    } finally {
      setSessionLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!statusData || statusData.invalid || statusData.completed) return;
    if (sessionUrl || sessionLoading) return;
    void createSession();
  }, [createSession, sessionLoading, sessionUrl, statusData]);

  useEffect(() => {
    if (!statusData || statusData.invalid || statusData.completed) return;
    const interval = window.setInterval(() => {
      void loadStatus();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [loadStatus, statusData]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== "https://app.pandadoc.com") return;
      const type =
        typeof event.data === "string"
          ? event.data
          : event.data && typeof event.data === "object" && "type" in event.data
            ? String((event.data as { type?: unknown }).type ?? "")
            : "";
      if (!type) return;
      if (/complete|finish|signed/i.test(type)) {
        setLocalCompletion(true);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const displayName = useMemo(() => {
    const first = statusData?.invite?.recipientFirstName ?? "";
    const last = statusData?.invite?.recipientLastName ?? "";
    return [first, last].filter(Boolean).join(" ").trim();
  }, [statusData?.invite?.recipientFirstName, statusData?.invite?.recipientLastName]);

  const completed =
    localCompletion ||
    statusData?.completed === true ||
    statusData?.estimate?.pandadocState?.status === "document.completed";

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7f2e8_0%,#f0ece4_100%)] px-4 py-10 text-foreground">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 text-center">
          <p className="text-xs uppercase tracking-[0.32em] text-muted-foreground">
            Cornerstone Proposal
          </p>
          <h1 className="mt-3 font-serif text-4xl font-light tracking-tight">
            {statusData?.estimate?.title || "Review and sign"}
          </h1>
          {displayName ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Signing as {displayName}
            </p>
          ) : null}
        </div>

        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card className="border-border/70 bg-white/80 shadow-sm">
            <CardHeader>
              <CardTitle className="font-serif text-xl font-light">
                Signature Access
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              {statusLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading signing link...
                </div>
              ) : null}
              {statusError ? (
                <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-destructive">
                  {statusError}
                </p>
              ) : null}
              {statusData?.expired ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2 text-amber-900">
                  This signing link has expired.
                </p>
              ) : null}
              {statusData?.invalid && !statusData?.expired ? (
                <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-destructive">
                  This signing link is no longer available.
                </p>
              ) : null}
              {completed ? (
                <p className="rounded-lg border border-emerald-500/30 bg-emerald-50 px-3 py-2 text-emerald-900">
                  This proposal has been completed.
                </p>
              ) : null}
              {statusData?.invite?.expiresAt ? (
                <p>Link expires {formatInviteExpiry(statusData.invite.expiresAt)}.</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => void loadStatus()}
                  disabled={statusLoading}
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh status
                </Button>
                {!completed && !statusData?.invalid ? (
                  <Button
                    onClick={() => void createSession()}
                    disabled={sessionLoading}
                  >
                    {sessionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Refresh session
                  </Button>
                ) : null}
              </div>
              {sessionError ? (
                <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-destructive">
                  {sessionError}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="min-h-[70vh] overflow-hidden border-border/70 bg-white shadow-lg">
            <CardContent className="p-0">
              {completed ? (
                <div className="flex min-h-[70vh] items-center justify-center px-8 text-center">
                  <div>
                    <h2 className="font-serif text-3xl font-light">Proposal completed</h2>
                    <p className="mt-3 text-sm text-muted-foreground">
                      The signed proposal has been recorded. You can close this page.
                    </p>
                  </div>
                </div>
              ) : sessionUrl ? (
                <iframe
                  title="Cornerstone embedded signing"
                  src={sessionUrl}
                  className="min-h-[70vh] w-full border-0"
                  allow="clipboard-read; clipboard-write"
                />
              ) : (
                <div className="flex min-h-[70vh] items-center justify-center px-8 text-center text-muted-foreground">
                  {sessionLoading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Preparing signing session...
                    </div>
                  ) : (
                    "A signing session will appear here when it is ready."
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
