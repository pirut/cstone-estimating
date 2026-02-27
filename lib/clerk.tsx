"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  ClerkProvider,
  SignInButton,
  SignOutButton,
  UserButton,
  useAuth,
  useUser,
} from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { useTheme } from "next-themes";

export const clerkPublishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
export const clerkEnabled = Boolean(clerkPublishableKey);

export function OptionalClerkProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const appearance = useMemo(
    () => ({
      baseTheme: resolvedTheme === "dark" ? dark : undefined,
    }),
    [resolvedTheme]
  );

  if (!clerkEnabled) return <>{children}</>;
  return (
    <ClerkProvider publishableKey={clerkPublishableKey} appearance={appearance}>
      {children}
    </ClerkProvider>
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

export { SignInButton, SignOutButton, UserButton };
