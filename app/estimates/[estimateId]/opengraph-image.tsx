import { ImageResponse } from "next/og";

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

function decodeEstimateId(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function formatEstimatePreviewId(estimateId: string) {
  if (!estimateId) return "Unknown";
  if (estimateId.length <= 34) return estimateId;
  return `${estimateId.slice(0, 18)}...${estimateId.slice(-12)}`;
}

export default function OpenGraphImage({ params }: OpenGraphImageProps) {
  const estimateId = decodeEstimateId(params.estimateId);
  const previewId = formatEstimatePreviewId(estimateId);

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
            "linear-gradient(140deg, rgb(15, 23, 42) 0%, rgb(30, 41, 59) 45%, rgb(15, 118, 110) 100%)",
          color: "white",
          fontFamily: "Work Sans, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              fontSize: 28,
              letterSpacing: 2.2,
              textTransform: "uppercase",
              opacity: 0.82,
            }}
          >
            Cornerstone Proposal Generator
          </div>
          <div style={{ fontSize: 82, fontWeight: 700, lineHeight: 1.05 }}>
            Shared Estimate
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "22px 26px",
            borderRadius: 22,
            background: "rgba(255, 255, 255, 0.14)",
            border: "1px solid rgba(255, 255, 255, 0.28)",
          }}
        >
          <div style={{ fontSize: 28, opacity: 0.92 }}>Estimate ID</div>
          <div
            style={{
              fontSize: 44,
              fontWeight: 700,
              lineHeight: 1.12,
              wordBreak: "break-word",
            }}
          >
            {previewId}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
