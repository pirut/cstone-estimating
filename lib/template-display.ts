export function stripTemplateVersionSuffixes(name: string) {
  return name.replace(/(?:\s*\(v\d+\))+$/gi, "").trim();
}

export function formatTemplateDisplayName(
  name: string,
  templateVersion?: number
) {
  const baseName = stripTemplateVersionSuffixes(name);
  if (
    typeof templateVersion === "number" &&
    Number.isFinite(templateVersion) &&
    templateVersion > 0
  ) {
    return `${baseName} (v${Math.trunc(templateVersion)})`;
  }
  return baseName;
}
