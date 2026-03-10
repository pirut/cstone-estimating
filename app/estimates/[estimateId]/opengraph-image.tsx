import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  formatEstimatePreviewId,
  formatEstimatePreviewStatus,
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
  const statusLabel = formatEstimatePreviewStatus(preview);
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
          padding: "42px 48px",
          background:
            "radial-gradient(circle at 88% 16%, rgba(209, 163, 90, 0.18), transparent 26%), radial-gradient(circle at 0% 100%, rgba(52, 61, 66, 0.12), transparent 34%), linear-gradient(135deg, rgb(248, 244, 228) 0%, rgb(243, 237, 218) 52%, rgb(236, 229, 205) 100%)",
          color: "rgb(18, 18, 18)",
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
            height: 6,
            background: "linear-gradient(90deg, rgb(209, 163, 90), rgb(111, 86, 49))",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 34,
            right: 40,
            width: 292,
            height: 292,
            borderRadius: 44,
            border: "1px solid rgba(52, 61, 66, 0.12)",
            background:
              "linear-gradient(145deg, rgba(255,255,255,0.5), rgba(209,163,90,0.08))",
            opacity: 0.85,
            transform: "rotate(10deg)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: -110,
            bottom: -138,
            width: 340,
            height: 340,
            borderRadius: 999,
            background: "rgba(52, 61, 66, 0.08)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 78,
              height: 78,
              borderRadius: 22,
              overflow: "hidden",
              border: "1px solid rgba(52, 61, 66, 0.14)",
              background: "rgba(255,255,255,0.72)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 18px 34px rgba(52, 61, 66, 0.08)",
            }}
          >
            {logoDataUrl ? (
              <img
                src={logoDataUrl}
                alt="Cornerstone"
                width={54}
                height={54}
                style={{ width: 54, height: 54, objectFit: "contain" }}
              />
            ) : (
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: "rgb(52, 61, 66)",
                }}
              >
                C
              </div>
            )}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 7,
            }}
          >
            <div
              style={{
                fontSize: 19,
                letterSpacing: 3.4,
                textTransform: "uppercase",
                color: "rgba(52, 61, 66, 0.72)",
              }}
            >
              Cornerstone
            </div>
            <div
              style={{
                fontSize: 44,
                lineHeight: 1,
                fontWeight: 500,
                fontFamily: "Georgia, 'Times New Roman', serif",
                color: "rgb(20, 24, 26)",
              }}
            >
              Proposal Studio
            </div>
            <div
              style={{
                fontSize: 14,
                letterSpacing: 2.1,
                textTransform: "uppercase",
                color: "rgb(209, 163, 90)",
              }}
            >
              Shared Estimate Preview
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 24,
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: "1.3 1 0%",
              gap: 22,
              padding: "28px 30px",
              borderRadius: 30,
              background: "rgba(255,255,255,0.7)",
              border: "1px solid rgba(52, 61, 66, 0.1)",
              boxShadow: "0 18px 44px rgba(52, 61, 66, 0.08)",
            }}
          >
            <div
              style={{
                fontSize: 20,
                letterSpacing: 2.1,
                textTransform: "uppercase",
                color: "rgb(209, 163, 90)",
              }}
            >
              Project
            </div>
            <div
              style={{
                fontSize: 62,
                lineHeight: 1.02,
                fontWeight: 700,
                fontFamily: "Georgia, 'Times New Roman', serif",
                wordBreak: "break-word",
                color: "rgb(20, 24, 26)",
              }}
            >
              {projectName}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                paddingTop: 22,
                borderTop: "1px solid rgba(52, 61, 66, 0.12)",
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  letterSpacing: 1.8,
                  textTransform: "uppercase",
                  color: "rgba(52, 61, 66, 0.68)",
                }}
              >
                Prepared For
              </div>
              <div
                style={{
                  fontSize: 34,
                  lineHeight: 1.12,
                  fontWeight: 700,
                  color: "rgb(20, 24, 26)",
                }}
              >
                {customerName}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: "0.9 1 0%",
              justifyContent: "space-between",
              gap: 18,
              padding: "28px 28px 24px",
              borderRadius: 30,
              background:
                "linear-gradient(160deg, rgb(52, 61, 66) 0%, rgb(32, 39, 43) 100%)",
              border: "1px solid rgba(209, 163, 90, 0.26)",
              color: "rgb(248, 244, 228)",
              boxShadow: "0 20px 48px rgba(33, 39, 43, 0.2)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: "rgba(248, 244, 228, 0.66)",
                }}
              >
                Workspace
              </div>
              <div
                style={{
                  fontSize: 30,
                  lineHeight: 1.16,
                  fontWeight: 700,
                }}
              >
                {clampText(workspaceLabel, 28)}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "16px 18px",
                  borderRadius: 20,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(209, 163, 90, 0.24)",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    letterSpacing: 1.8,
                    textTransform: "uppercase",
                    color: "rgba(248, 244, 228, 0.58)",
                  }}
                >
                  Status
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: "rgb(209, 163, 90)",
                  }}
                >
                  {statusLabel}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 18,
                  fontSize: 18,
                  color: "rgba(248, 244, 228, 0.88)",
                }}
              >
                <div>{`Updated ${updatedOnLabel}`}</div>
              </div>
            </div>

            <div
              style={{
                paddingTop: 16,
                borderTop: "1px solid rgba(209, 163, 90, 0.26)",
                fontSize: 17,
                letterSpacing: 1.6,
                textTransform: "uppercase",
                color: "rgba(248, 244, 228, 0.78)",
              }}
            >
              {estimateNumberLabel}
            </div>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: 48,
            bottom: 18,
            fontSize: 12,
            letterSpacing: 1.3,
            textTransform: "uppercase",
            color: "rgba(52, 61, 66, 0.6)",
          }}
        >
          estimating.cornerstonecompaniesfl.com
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
