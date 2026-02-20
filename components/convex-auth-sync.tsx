"use client";

import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { clerkEnabled, useOptionalAuth, useOptionalUser } from "@/lib/clerk";

const allowedDomain = (
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "cornerstonecompaniesfl.com"
)
  .trim()
  .toLowerCase();
const hasAllowedDomain = allowedDomain.length > 0;
const convexConfigured = Boolean(
  String(process.env.NEXT_PUBLIC_CONVEX_URL ?? "").trim()
);

type ConvexAuthSyncProps = {
  onDomainError?: (message: string) => void;
  onAuthError?: (message: string | null) => void;
};

export function ConvexAuthSync({ onDomainError, onAuthError }: ConvexAuthSyncProps) {
  const { isLoaded, isSignedIn, signOut } = useOptionalAuth();
  const { user } = useOptionalUser();
  const upsertUser = useMutation(api.app.upsertUser);
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!convexConfigured) {
      onAuthError?.("Missing NEXT_PUBLIC_CONVEX_URL.");
      return;
    }
    if (!clerkEnabled) {
      onAuthError?.(null);
      return;
    }
    if (!isLoaded) return;

    if (!isSignedIn || !user?.id) {
      onAuthError?.(null);
      lastSignatureRef.current = null;
      return;
    }

    const email = user.primaryEmailAddress?.emailAddress?.trim().toLowerCase() ?? "";
    if (hasAllowedDomain && email && !email.endsWith(`@${allowedDomain}`)) {
      onDomainError?.(`Only ${allowedDomain} accounts can access this workspace.`);
      void signOut();
      return;
    }

    const name =
      user.fullName ||
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.username ||
      email;
    const imageUrl = user.imageUrl || "";

    const signature = [user.id, email, name, imageUrl].join(":");
    if (lastSignatureRef.current === signature) {
      onAuthError?.(null);
      return;
    }

    lastSignatureRef.current = signature;
    void upsertUser({
      id: user.id,
      email: email || undefined,
      name: name || undefined,
      imageUrl: imageUrl || undefined,
    })
      .then(() => {
        onAuthError?.(null);
      })
      .catch((error) => {
        lastSignatureRef.current = null;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to sync user profile with Convex.";
        onAuthError?.(message);
      });
  }, [
    isLoaded,
    isSignedIn,
    onAuthError,
    onDomainError,
    signOut,
    upsertUser,
    user,
    user?.id,
  ]);

  return null;
}
