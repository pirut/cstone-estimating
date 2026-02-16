export type DocumentGenerationProvider = "local_pdf" | "pandadoc";

const DEFAULT_PROVIDER: DocumentGenerationProvider = "local_pdf";

export function getDocumentGenerationProvider(): DocumentGenerationProvider {
  const raw = String(process.env.DOCUMENT_GENERATION_PROVIDER ?? "")
    .trim()
    .toLowerCase();

  if (raw === "pandadoc") {
    return "pandadoc";
  }

  return DEFAULT_PROVIDER;
}

