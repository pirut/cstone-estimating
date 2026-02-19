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
  const { user: instantUser } = db.useAuth();
  const lastAuthErrorRef = useRef<string | null>(null);
  const lastProfileSyncRef = useRef<string | null>(null);
  const authSyncInFlightRef = useRef(false);
  const lastSyncedClerkUserIdRef = useRef<string | null>(null);
  const nextAllowedAuthSyncAtRef = useRef(0);

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

    if (!isSignedIn) {
      lastSyncedClerkUserIdRef.current = null;
      nextAllowedAuthSyncAtRef.current = 0;
      if (!instantUser?.id || authSyncInFlightRef.current) {
        reportAuthError(null);
        return;
      }
      authSyncInFlightRef.current = true;
      void db.auth.signOut().finally(() => {
        authSyncInFlightRef.current = false;
        reportAuthError(null);
      });
      return;
    }

    const clerkUserId = user?.id ?? null;
    if (!clerkUserId) return;

    if (
      instantUser?.id &&
      lastSyncedClerkUserIdRef.current === clerkUserId
    ) {
      reportAuthError(null);
      return;
    }

    if (authSyncInFlightRef.current) return;
    if (Date.now() < nextAllowedAuthSyncAtRef.current) return;

    authSyncInFlightRef.current = true;
    nextAllowedAuthSyncAtRef.current = Date.now() + 3000;

    void (async () => {
      const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? "";
      if (hasAllowedDomain && email && !email.endsWith(`@${allowedDomain}`)) {
        onDomainError?.(
          `Only ${allowedDomain} accounts can access this workspace.`
        );
        await db.auth.signOut();
        await clerkSignOut();
        lastSyncedClerkUserIdRef.current = null;
        nextAllowedAuthSyncAtRef.current = Date.now() + 15000;
        return;
      }

      const idToken = await getToken(
        clerkTokenTemplate ? { template: clerkTokenTemplate } : undefined
      );
      if (!idToken) {
        reportAuthError(
          "Clerk token missing. Confirm the session token includes email."
        );
        lastSyncedClerkUserIdRef.current = null;
        nextAllowedAuthSyncAtRef.current = Date.now() + 15000;
        return;
      }
      try {
        await db.auth.signInWithIdToken({
          idToken,
          clientName: clerkClientName,
        });
        lastSyncedClerkUserIdRef.current = clerkUserId;
        nextAllowedAuthSyncAtRef.current = 0;
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
        lastSyncedClerkUserIdRef.current = null;
        nextAllowedAuthSyncAtRef.current = Date.now() + 15000;
      }
    })().finally(() => {
      authSyncInFlightRef.current = false;
    });
  }, [
    instantUser?.id,
    getToken,
    isLoaded,
    isSignedIn,
    clerkSignOut,
    onDomainError,
    reportAuthError,
    user?.id,
  ]);

  useEffect(() => {
    if (!instantAppId) return;
    if (!clerkEnabled) return;
    if (!instantUser?.id || !user) return;

    const email =
      user.primaryEmailAddress?.emailAddress?.trim().toLowerCase() ?? "";
    const imageUrl =
      user.imageUrl ||
      (typeof (user as { profileImageUrl?: string }).profileImageUrl === "string"
        ? (user as { profileImageUrl?: string }).profileImageUrl
        : "");
    const name =
      user.fullName ||
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.username ||
      email;

    const payload: { name?: string; imageUrl?: string } = {};
    if (name) payload.name = name;
    if (imageUrl) payload.imageUrl = imageUrl;

    if (!payload.name && !payload.imageUrl) return;
    const signature = `${instantUser.id}:${payload.name ?? ""}:${payload.imageUrl ?? ""}`;
    if (lastProfileSyncRef.current === signature) return;
    lastProfileSyncRef.current = signature;

    void db
      .transact(db.tx.$users[instantUser.id].update(payload))
      .catch(() => {
        lastProfileSyncRef.current = null;
      });
  }, [instantAppId, instantUser?.id, user, user?.id]);

  return null;
}
