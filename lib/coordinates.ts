export type CoordSpec = {
  x?: number;
  y?: number;
  size?: number;
  line_height?: number;
  lineHeight?: number;
  align?: string;
  max_width?: number;
  min_size?: number;
  font?: string;
  font_url?: string;
  color?: string | number[];
  opacity?: number;
  background?: {
    color?: string | number[];
    opacity?: number;
    padding?: number;
    padding_x?: number;
    padding_y?: number;
    width?: number;
    height?: number;
    offset_x?: number;
    offset_y?: number;
  };
};

export type CoordsConfig = Record<string, unknown>;

export function isPageKey(value: string) {
  return /^page_[1-9]\d*$/.test(value);
}

export function parsePageKey(value: string) {
  if (!isPageKey(value)) return null;
  const pageNumber = Number(value.slice(5));
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;
  return pageNumber;
}

export function toPageKey(pageNumber: number) {
  const normalized = Math.max(1, Math.trunc(pageNumber));
  return `page_${normalized}`;
}

export function getSortedPageKeys(config: CoordsConfig) {
  return Object.keys(config)
    .filter((key) => parsePageKey(key) !== null)
    .sort((left, right) => {
      const leftNumber = parsePageKey(left) ?? 0;
      const rightNumber = parsePageKey(right) ?? 0;
      return leftNumber - rightNumber;
    });
}

export function getPageFields<T extends CoordSpec = CoordSpec>(
  config: CoordsConfig,
  pageKey: string
) {
  const page = config[pageKey];
  if (!page || typeof page !== "object" || Array.isArray(page)) {
    return {} as Record<string, T>;
  }
  return page as Record<string, T>;
}
