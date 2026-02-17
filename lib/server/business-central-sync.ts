export type BusinessCentralSyncPreview = {
  system: "business_central";
  status: "pending";
  reason: string;
  queueKey: string;
  payload: {
    documentId: string;
    estimateName: string;
    customerName: string;
    proposalDate: string;
    totalContractPrice: string;
    projectType: string;
  };
};

function coerce(value: unknown) {
  return String(value ?? "").trim();
}

export function buildBusinessCentralSyncPreview(options: {
  documentId: string;
  fieldValues: Record<string, string>;
}): BusinessCentralSyncPreview {
  const { documentId, fieldValues } = options;

  return {
    system: "business_central",
    status: "pending",
    reason: "Business Central sync is not implemented yet.",
    queueKey: `bc-sync:${documentId}`,
    payload: {
      documentId,
      estimateName: coerce(fieldValues.project_name) || "Cornerstone Proposal",
      customerName: coerce(fieldValues.prepared_for),
      proposalDate: coerce(fieldValues.proposal_date),
      totalContractPrice: coerce(fieldValues.total_contract_price),
      projectType: coerce(fieldValues.project_type),
    },
  };
}
