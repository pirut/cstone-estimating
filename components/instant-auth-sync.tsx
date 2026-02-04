"use client";

import { useEffect } from "react";
import { clerkEnabled, useOptionalAuth, useOptionalUser } from "@/lib/clerk";
import { db, instantAppId } from "@/lib/instant";

const clerkClientName = process.env.NEXT_PUBLIC_CLERK_CLIENT_NAME;
const allowedDomain = (
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "cornerstonecompaniesfl.com"
)
  .trim()
  .toLowerCase();
const hasAllowedDomain = allowedDomain.length > 0;

type InstantAuthSyncProps = {
  onDomainError?: (message: string) => void;
};

export function InstantAuthSync({ onDomainError }: InstantAuthSyncProps) {
  const { isSignedIn, getToken, signOut: clerkSignOut } = useOptionalAuth();
  const { user } = useOptionalUser();

  useEffect(() => {
    if (!instantAppId) return;
    if (!clerkClientName) return;
    if (!clerkEnabled) return;

    const sync = async () => {
      if (!isSignedIn) {
        await db.auth.signOut();
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

      const idToken = await getToken();
      if (!idToken) return;
      try {
        await db.auth.signInWithIdToken({
          idToken,
          clientName: clerkClientName,
        });
      } catch (err) {
        console.error("InstantDB auth sync failed", err);
      }
    };

    void sync();
  }, [getToken, isSignedIn, clerkSignOut, onDomainError, user?.id]);

  return null;
}
