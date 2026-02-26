"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import HomePage from "@/app/home-page";

export default function EstimatePage() {
  const params = useParams<{ estimateId?: string | string[] }>();
  const estimateId = useMemo(() => {
    const raw = Array.isArray(params?.estimateId)
      ? params.estimateId[0]
      : params?.estimateId;
    if (typeof raw !== "string") return null;
    return decodeURIComponent(raw);
  }, [params?.estimateId]);

  return <HomePage routeEstimateId={estimateId} />;
}
