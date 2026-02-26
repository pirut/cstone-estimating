import type { Metadata } from "next";
import HomePage from "@/app/home-page";
import {
  formatEstimatePreviewId,
  formatEstimateStatus,
  parseEstimateId,
  resolveEstimateSharePreview,
} from "@/app/estimates/[estimateId]/estimate-share-preview";

type EstimatePageProps = {
  params: {
    estimateId: string;
  };
};

export async function generateMetadata({
  params,
}: EstimatePageProps): Promise<Metadata> {
  const estimateId = parseEstimateId(params.estimateId);
  const encodedEstimateId = encodeURIComponent(estimateId);
  const previewId = formatEstimatePreviewId(estimateId);
  const preview = await resolveEstimateSharePreview(estimateId);
  const customerLabel = preview?.customerName || "Customer not set";
  const projectLabel = preview?.projectName || preview?.title || `Estimate ${previewId}`;
  const statusLabel = preview ? formatEstimateStatus(preview.status) : "Draft";
  const title = `${projectLabel} — ${customerLabel} | Cornerstone`;
  const description = `Cornerstone shared estimate. Project: ${projectLabel}. Customer: ${customerLabel}. Status: ${statusLabel}.`;
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
  const estimateId = parseEstimateId(params.estimateId);

  return <HomePage routeEstimateId={estimateId} />;
}
