"use client";

import type { ReactNode } from "react";
import {
  ClerkProvider,
  SignInButton,
  SignOutButton,
  useAuth,
  useUser,
} from "@clerk/nextjs";

export const clerkPublishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
export const clerkEnabled = Boolean(clerkPublishableKey);

export function OptionalClerkProvider({ children }: { children: ReactNode }) {
  if (!clerkEnabled) return <>{children}</>;
  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>{children}</ClerkProvider>
  );
}

export function useOptionalAuth() {
  if (!clerkEnabled) {
    return {
      isLoaded: true,
      isSignedIn: false,
      getToken: async () => null,
      signOut: async () => {},
    } as const;
  }
  return useAuth();
}

export function useOptionalUser() {
  if (!clerkEnabled) {
    return { user: null } as const;
  }
  return useUser();
}

export { SignInButton, SignOutButton };
