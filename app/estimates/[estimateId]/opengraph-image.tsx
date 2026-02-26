import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  formatEstimatePreviewId,
  formatEstimateStatus,
  parseEstimateId,
  resolveEstimateSharePreview,
} from "@/app/estimates/[estimateId]/estimate-share-preview";

export const runtime = "nodejs";
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

let logoDataUrlPromise: Promise<string | null> | null = null;

function clampText(value: string, maxLength: number) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

async function getLogoDataUrl() {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = (async () => {
      try {
        const absolutePath = join(
          process.cwd(),
          "public",
          "brand",
          "cornerstone-logo.png"
        );
        const file = await readFile(absolutePath);
        return `data:image/png;base64,${file.toString("base64")}`;
      } catch {
        return null;
      }
    })();
  }
  return logoDataUrlPromise;
}

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
  const logoDataUrl = await getLogoDataUrl();
  const previewId = formatEstimatePreviewId(estimateId);
  const customerName = clampText(preview?.customerName || "Customer not set", 54);
  const projectName = clampText(
    preview?.projectName || preview?.title || `Estimate ${previewId}`,
    62
  );
  const workspaceLabel = preview?.workspaceProjectName || preview?.teamName || "Cornerstone";
  const statusLabel = formatEstimateStatus(preview?.status || "draft");
  const updatedOnLabel = formatEstimateUpdatedAt(preview?.updatedAt ?? null);
  const estimateNumberLabel = `EST • ${previewId}`;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "46px 56px",
          background:
            "radial-gradient(circle at 80% 12%, rgba(214, 176, 112, 0.22), transparent 32%), radial-gradient(circle at 6% 98%, rgba(176, 132, 72, 0.2), transparent 34%), linear-gradient(140deg, rgb(27, 21, 13) 0%, rgb(18, 14, 10) 45%, rgb(56, 40, 22) 100%)",
          color: "rgb(248, 241, 230)",
          fontFamily: "Work Sans, Arial, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "linear-gradient(90deg, rgb(242, 214, 165), rgb(170, 126, 66))",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 28,
            right: 28,
            width: 260,
            height: 260,
            borderRadius: 30,
            border: "1px solid rgba(241, 216, 174, 0.2)",
            opacity: 0.45,
            transform: "rotate(12deg)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {logoDataUrl ? (
            <div
              style={{
                width: 66,
                height: 66,
                borderRadius: 18,
                overflow: "hidden",
                border: "1px solid rgba(244, 214, 166, 0.42)",
                background: "rgba(13, 11, 8, 0.65)",
                display: "flex",
              }}
            >
              <img
                src={logoDataUrl}
                alt="Cornerstone"
                width={66}
                height={66}
                style={{ width: 66, height: 66, objectFit: "cover" }}
              />
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                fontSize: 20,
                letterSpacing: 2.2,
                textTransform: "uppercase",
                opacity: 0.92,
                color: "rgb(244, 214, 166)",
              }}
            >
              Cornerstone Proposal Generator
            </div>
            <div
              style={{
                fontSize: 14,
                letterSpacing: 1.8,
                textTransform: "uppercase",
                opacity: 0.84,
                color: "rgb(219, 195, 154)",
              }}
            >
              Shared Estimate Preview
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              fontSize: 22,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: "rgb(244, 214, 166)",
              opacity: 0.9,
            }}
          >
            Project
          </div>
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.04,
              fontFamily: "Georgia, 'Times New Roman', serif",
            }}
          >
            {projectName}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 20,
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: "1.2 1 0%",
              gap: 12,
              padding: "22px 24px",
              borderRadius: 22,
              background: "rgba(10, 9, 7, 0.46)",
              border: "1px solid rgba(244, 214, 166, 0.35)",
            }}
          >
            <div
              style={{
                fontSize: 20,
                letterSpacing: 1.4,
                textTransform: "uppercase",
                color: "rgb(244, 214, 166)",
              }}
            >
              Customer
            </div>
            <div
              style={{
                fontSize: 40,
                lineHeight: 1.12,
                fontWeight: 700,
                wordBreak: "break-word",
              }}
            >
              {customerName}
            </div>
            <div
              style={{
                display: "flex",
                gap: 18,
                fontSize: 21,
                opacity: 0.94,
              }}
            >
              <div>{`Status: ${statusLabel}`}</div>
              <div>{`Updated: ${updatedOnLabel}`}</div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: "0.8 1 0%",
              justifyContent: "space-between",
              gap: 14,
              padding: "22px 24px",
              borderRadius: 22,
              background: "rgba(244, 214, 166, 0.12)",
              border: "1px solid rgba(244, 214, 166, 0.38)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                  color: "rgb(244, 214, 166)",
                }}
              >
                Workspace
              </div>
              <div
                style={{
                  fontSize: 30,
                  lineHeight: 1.18,
                  fontWeight: 700,
                }}
              >
                {clampText(workspaceLabel, 28)}
              </div>
            </div>
            <div
              style={{
                paddingTop: 10,
                borderTop: "1px solid rgba(244, 214, 166, 0.35)",
                fontSize: 17,
                letterSpacing: 1.4,
                textTransform: "uppercase",
                color: "rgb(222, 197, 153)",
              }}
            >
              {estimateNumberLabel}
            </div>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: 56,
            bottom: 16,
            fontSize: 12,
            letterSpacing: 1.1,
            textTransform: "uppercase",
            color: "rgba(241, 223, 191, 0.68)",
          }}
        >
          estimating.jrbussard.com
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
