import { ImageResponse } from "next/og";
import {
  formatEstimatePreviewId,
  formatEstimateStatus,
  parseEstimateId,
  resolveEstimateSharePreview,
} from "@/app/estimates/[estimateId]/estimate-share-preview";

export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

type OpenGraphImageProps = {
  params: {
    estimateId: string;
  };
};

function formatEstimateUpdatedAt(updatedAt: number | null) {
  if (!updatedAt || !Number.isFinite(updatedAt)) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(updatedAt));
}

export default async function OpenGraphImage({ params }: OpenGraphImageProps) {
  const estimateId = parseEstimateId(params.estimateId);
  const preview = await resolveEstimateSharePreview(estimateId);
  const previewId = formatEstimatePreviewId(estimateId);
  const customerName = preview?.customerName || "Customer not set";
  const projectName = preview?.projectName || preview?.title || `Estimate ${previewId}`;
  const workspaceLabel = preview?.workspaceProjectName || preview?.teamName || "Cornerstone";
  const statusLabel = formatEstimateStatus(preview?.status || "draft");
  const updatedOnLabel = formatEstimateUpdatedAt(preview?.updatedAt ?? null);

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 64px",
          background:
            "linear-gradient(140deg, rgb(32, 24, 14) 0%, rgb(20, 16, 11) 45%, rgb(72, 52, 28) 100%)",
          color: "white",
          fontFamily: "Work Sans, Arial, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -120,
            right: -80,
            width: 380,
            height: 380,
            borderRadius: "999px",
            background: "rgba(214, 176, 112, 0.26)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -160,
            left: -90,
            width: 380,
            height: 380,
            borderRadius: "999px",
            background: "rgba(152, 112, 62, 0.2)",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              fontSize: 24,
              letterSpacing: 2.2,
              textTransform: "uppercase",
              opacity: 0.9,
              color: "rgb(244, 214, 166)",
            }}
          >
            Cornerstone Proposal Generator
          </div>
          <div style={{ fontSize: 74, fontWeight: 700, lineHeight: 1.05 }}>
            Shared Estimate
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 30,
              fontWeight: 500,
              opacity: 0.93,
            }}
          >
            {projectName}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: "22px 26px",
            borderRadius: 22,
            background: "rgba(12, 10, 8, 0.42)",
            border: "1px solid rgba(244, 214, 166, 0.45)",
          }}
        >
          <div style={{ fontSize: 24, opacity: 0.92, color: "rgb(244, 214, 166)" }}>
            Customer
          </div>
          <div
            style={{
              fontSize: 42,
              fontWeight: 700,
              lineHeight: 1.12,
              wordBreak: "break-word",
            }}
          >
            {customerName}
          </div>
          <div
            style={{
              display: "flex",
              gap: 26,
              fontSize: 24,
              opacity: 0.94,
            }}
          >
            <div>Status: {statusLabel}</div>
            <div>Updated: {updatedOnLabel}</div>
          </div>
          <div
            style={{
              display: "flex",
              gap: 26,
              fontSize: 22,
              opacity: 0.82,
              color: "rgb(244, 214, 166)",
            }}
          >
            <div>{workspaceLabel}</div>
            <div>#{previewId}</div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
