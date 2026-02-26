import type { Metadata } from "next";
import HomePage from "@/app/home-page";

type EstimatePageProps = {
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
  if (estimateId.length <= 26) return estimateId;
  return `${estimateId.slice(0, 12)}...${estimateId.slice(-8)}`;
}

export function generateMetadata({ params }: EstimatePageProps): Metadata {
  const estimateId = decodeEstimateId(params.estimateId);
  const encodedEstimateId = encodeURIComponent(estimateId);
  const previewId = formatEstimatePreviewId(estimateId);
  const title = `Estimate ${previewId}`;
  const description =
    "Open this shared Cornerstone estimate link to review and manage the project.";
  const estimatePath = `/estimates/${encodedEstimateId}`;
  const ogImagePath = `${estimatePath}/opengraph-image`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      url: estimatePath,
      images: [
        {
          url: ogImagePath,
          alt: `Cornerstone estimate ${previewId}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImagePath],
    },
  };
}

export default function EstimatePage({ params }: EstimatePageProps) {
  const estimateId = decodeEstimateId(params.estimateId);

  return <HomePage routeEstimateId={estimateId} />;
}
