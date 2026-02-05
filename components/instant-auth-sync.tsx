"use client";

import { useCallback, useEffect, useRef } from "react";
import { clerkEnabled, useOptionalAuth, useOptionalUser } from "@/lib/clerk";
import { db, instantAppId } from "@/lib/instant";

const clerkClientName = process.env.NEXT_PUBLIC_CLERK_CLIENT_NAME;
const clerkTokenTemplate = process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE;
const allowedDomain = (
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "cornerstonecompaniesfl.com"
)
  .trim()
  .toLowerCase();
const hasAllowedDomain = allowedDomain.length > 0;

type InstantAuthSyncProps = {
  onDomainError?: (message: string) => void;
  onAuthError?: (message: string | null) => void;
};

export function InstantAuthSync({
  onDomainError,
  onAuthError,
}: InstantAuthSyncProps) {
  const {
    isLoaded,
    isSignedIn,
    getToken,
    signOut: clerkSignOut,
  } = useOptionalAuth();
  const { user } = useOptionalUser();
  const lastAuthErrorRef = useRef<string | null>(null);

  const reportAuthError = useCallback(
    (message: string | null) => {
      if (lastAuthErrorRef.current === message) return;
      lastAuthErrorRef.current = message;
      onAuthError?.(message);
    },
    [onAuthError]
  );

  useEffect(() => {
    if (!instantAppId) return;
    if (!clerkClientName) {
      reportAuthError("Missing NEXT_PUBLIC_CLERK_CLIENT_NAME.");
      return;
    }
    if (!clerkEnabled) return;
    if (!isLoaded) return;

    const sync = async () => {
      if (!isSignedIn) {
        await db.auth.signOut();
        reportAuthError(null);
        return;
      }

      const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? "";
      if (hasAllowedDomain && email && !email.endsWith(`@${allowedDomain}`)) {
        onDomainError?.(
          `Only ${allowedDomain} accounts can access this workspace.`
        );
        await db.auth.signOut();
        await clerkSignOut();
        return;
      }

      const idToken = await getToken(
        clerkTokenTemplate ? { template: clerkTokenTemplate } : undefined
      );
      if (!idToken) {
        reportAuthError(
          "Clerk token missing. Confirm the session token includes email."
        );
        return;
      }
      try {
        await db.auth.signInWithIdToken({
          idToken,
          clientName: clerkClientName,
        });
        reportAuthError(null);
      } catch (err) {
        console.error("InstantDB auth sync failed", err);
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "InstantDB auth sync failed.";
        const details =
          typeof err === "object" && err !== null
            ? JSON.stringify(err, Object.getOwnPropertyNames(err))
            : null;
        reportAuthError(details && details !== "{}" ? details : message);
      }
    };

    void sync();
  }, [
    getToken,
    isLoaded,
    isSignedIn,
    clerkSignOut,
    onDomainError,
    reportAuthError,
    user?.id,
  ]);

  return null;
}
