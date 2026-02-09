type DownloadOptions = {
  baseUrl?: string;
  timeoutMs?: number;
};

const DEFAULT_MAX_DOWNLOAD_MB = 50;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_ALLOWED_HOSTS = ["uploadthing.com", "utfs.io", "ufs.sh"];
const DEFAULT_ALLOWED_SUFFIXES = ["uploadthing.com", "utfs.io", "ufs.sh"];

const MAX_DOWNLOAD_MB = parsePositiveNumber(
  process.env.MAX_DOWNLOAD_MB,
  DEFAULT_MAX_DOWNLOAD_MB
);
const MAX_DOWNLOAD_BYTES = MAX_DOWNLOAD_MB * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = parsePositiveNumber(
  process.env.DOWNLOAD_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS
);
const ALLOW_PRIVATE_DOWNLOADS =
  process.env.ALLOW_PRIVATE_DOWNLOADS === "true" ||
  process.env.NODE_ENV !== "production";

export async function downloadJson<T = unknown>(
  url: string,
  label: string,
  options?: DownloadOptions
) {
  const buffer = await downloadBuffer(url, label, options);
  try {
    return JSON.parse(buffer.toString("utf-8")) as T;
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${
        error instanceof Error ? error.message : "Unknown error."
      }`
    );
  }
}

export async function downloadBuffer(
  url: string,
  label: string,
  options?: DownloadOptions
) {
  const resolvedUrl = resolveDownloadUrl(url, options?.baseUrl);
  const allowedHosts = buildAllowedHosts(options?.baseUrl);
  validateDownloadUrl(resolvedUrl, allowedHosts);

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(resolvedUrl.toString(), {
      headers: { "User-Agent": "cstone-estimating/1.0" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${label} download failed (${response.status}).`);
    }

    const length = response.headers.get("content-length");
    if (length && Number(length) > MAX_DOWNLOAD_BYTES) {
      throw new Error(`${label} exceeds ${MAX_DOWNLOAD_MB} MB limit.`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`${label} exceeds ${MAX_DOWNLOAD_MB} MB limit.`);
    }

    return Buffer.from(arrayBuffer);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label} download timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function resolveDownloadUrl(url: string, baseUrl?: string) {
  try {
    if (baseUrl) {
      return new URL(url, baseUrl);
    }
    return new URL(url);
  } catch {
    throw new Error("Invalid download URL.");
  }
}

function buildAllowedHosts(baseUrl?: string) {
  const allowed = [
    ...DEFAULT_ALLOWED_HOSTS,
    ...parseList(process.env.DOWNLOAD_ALLOWLIST),
  ];
  const allowedSuffixes = [
    ...DEFAULT_ALLOWED_SUFFIXES,
    ...parseList(process.env.DOWNLOAD_ALLOWLIST_SUFFIXES),
  ];
  if (baseUrl) {
    try {
      allowed.push(new URL(baseUrl).hostname);
    } catch {
      // ignore malformed base URL
    }
  }
  const normalized = allowed.map((host) => host.toLowerCase());
  for (const suffix of allowedSuffixes) {
    const trimmed = suffix.trim();
    if (!trimmed) continue;
    const normalizedSuffix = trimmed.toLowerCase();
    if (normalizedSuffix.startsWith("*.")) {
      normalized.push(normalizedSuffix);
    } else if (normalizedSuffix.includes(".")) {
      normalized.push(`*.${normalizedSuffix}`);
    } else {
      normalized.push(normalizedSuffix);
    }
  }
  return normalized;
}

function validateDownloadUrl(url: URL, allowedHosts: string[]) {
  const protocol = url.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error("Only http(s) downloads are allowed.");
  }

  const hostname = url.hostname.toLowerCase();
  const matchesAllowed = isHostAllowed(hostname, allowedHosts);

  if (isPrivateHost(hostname)) {
    if (!matchesAllowed && !ALLOW_PRIVATE_DOWNLOADS) {
      throw new Error("Private network downloads are not allowed.");
    }
  } else if (!matchesAllowed) {
    throw new Error("Download host is not allowed.");
  }
}

function isHostAllowed(hostname: string, allowedHosts: string[]) {
  return allowedHosts.some((allowed) => {
    if (!allowed) return false;
    if (allowed === hostname) return true;
    if (allowed.startsWith("*.") && allowed.length > 2) {
      const suffix = allowed.slice(2);
      return hostname === suffix || hostname.endsWith(`.${suffix}`);
    }
    return false;
  });
}

function isPrivateHost(hostname: string) {
  if (hostname === "localhost") return true;
  if (hostname.includes(":")) return isPrivateIpv6(hostname);
  return isPrivateIpv4(hostname);
}

function isPrivateIpv4(hostname: string) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map((value) => Number(value));
  if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return false;
  }
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80")
  );
}

function parseList(value?: string) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parsePositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}
