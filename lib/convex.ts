"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { clerkEnabled, useOptionalAuth, useOptionalUser } from "@/lib/clerk";

type TxOperationInput = {
  table: string;
  id: string;
  operation: "create" | "update" | "delete";
  data?: any;
  links?: any;
  link?: (links: Record<string, any>) => TxOperationInput;
};

type TxRecordBuilder = {
  create: (data: Record<string, any>) => TxOperationInput;
  update: (data: Record<string, any>) => TxOperationInput;
  delete: () => TxOperationInput;
};

type ConvexAuthUser = {
  id: string;
  email?: string;
  name?: string;
  imageUrl?: string;
};

type QueryResult<T> = {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
};

function createOperation(
  table: string,
  id: string,
  operation: "create" | "update" | "delete",
  data?: Record<string, any>
): TxOperationInput {
  const base: TxOperationInput = {
    table,
    id,
    operation,
    ...(data ? { data } : {}),
  };
  return Object.assign(base, {
    link: (links: Record<string, any>) => ({ ...base, links }),
  });
}

function buildTxProxy() {
  return new Proxy(
    {},
    {
      get: (_, rawTable: string) => {
        const table = String(rawTable);
        return new Proxy(
          {},
          {
            get: (_target, rawId: string): TxRecordBuilder => {
              const id = String(rawId);
              return {
                create: (data) => createOperation(table, id, "create", data),
                update: (data) => createOperation(table, id, "update", data),
                delete: () => createOperation(table, id, "delete"),
              };
            },
          }
        );
      },
    }
  );
}

function extractTeamDomainFromQuery(queryConfig: unknown) {
  if (!queryConfig || typeof queryConfig !== "object") return "";
  const teams = (queryConfig as { teams?: { $?: { where?: { domain?: string } } } }).teams;
  const domain = teams?.$?.where?.domain;
  return typeof domain === "string" ? domain : "";
}

async function requestJson(path: string, payload: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (data && typeof data.error === "string" && data.error) ||
      `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
}

function useConvexAuthState(): {
  isLoading: boolean;
  user: ConvexAuthUser | null;
  error: Error | null;
} {
  const { isLoaded, isSignedIn } = useOptionalAuth();
  const optionalUser = useOptionalUser() as { user: any; isLoaded?: boolean };
  const userLoaded = optionalUser?.isLoaded ?? true;
  const user = optionalUser?.user ?? null;

  if (!clerkEnabled) {
    return { isLoading: false, user: null, error: null };
  }

  if (!isLoaded || !userLoaded) {
    return { isLoading: true, user: null, error: null };
  }

  if (!isSignedIn || !user?.id) {
    return { isLoading: false, user: null, error: null };
  }

  const email = user.primaryEmailAddress?.emailAddress ?? undefined;
  const name =
    user.fullName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    email;

  return {
    isLoading: false,
    user: {
      id: user.id,
      email,
      name: name || undefined,
      imageUrl: user.imageUrl || undefined,
    },
    error: null,
  };
}

const tx = buildTxProxy();

export const convexAppUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

export function id() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export const db = {
  tx,

  useAuth() {
    return useConvexAuthState();
  },

  useQuery(queryConfig: unknown): QueryResult<{ teams: Array<any> }> {
    const domain = extractTeamDomainFromQuery(queryConfig).trim().toLowerCase();
    const skip = !convexAppUrl || !domain || domain === "__none__";
    const result = useQuery(
      api.app.teamGraphByDomain,
      skip ? "skip" : { domain }
    ) as Array<any> | undefined;

    if (skip) {
      return {
        data: { teams: [] },
        error: null,
        isLoading: false,
      };
    }

    if (result === undefined) {
      return {
        data: undefined,
        error: null,
        isLoading: true,
      };
    }

    return {
      data: { teams: result },
      error: null,
      isLoading: false,
    };
  },

  async queryOnce(queryConfig: unknown) {
    const domain = extractTeamDomainFromQuery(queryConfig).trim().toLowerCase();
    if (!convexAppUrl || !domain || domain === "__none__") {
      return { teams: [] };
    }
    const data = await requestJson("/api/convex/team-graph", { domain });
    return {
      teams: Array.isArray(data?.teams) ? data.teams : [],
    };
  },

  async transact(operations: TxOperationInput | Array<TxOperationInput>) {
    const operationList = Array.isArray(operations) ? operations : [operations];
    const compact = operationList.map((entry) => {
      const output: Record<string, any> = {
        table: entry.table,
        id: entry.id,
        operation: entry.operation,
      };
      if (entry.data !== undefined) {
        output.data = entry.data;
      }
      if (entry.links !== undefined) {
        output.links = entry.links;
      }
      return output;
    });

    await requestJson("/api/convex/transact", {
      operations: compact,
    });
  },
};
