import type { Metadata } from "next";
import { ProposalSignClient } from "./proposal-sign-client";

type ProposalSignPageProps = {
  params: {
    token: string;
  };
};

export const metadata: Metadata = {
  title: "Cornerstone Proposal Signing",
  robots: {
    index: false,
    follow: false,
  },
};

export default function ProposalSignPage({ params }: ProposalSignPageProps) {
  return <ProposalSignClient token={params.token} />;
}
