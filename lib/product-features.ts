export const PRODUCT_FEATURE_CATEGORIES = [
  { id: "interior_frame_color", label: "Interior frame color" },
  { id: "exterior_frame_color", label: "Exterior frame color" },
  { id: "glass_type", label: "Glass type" },
  { id: "glass_makeup", label: "Glass make up" },
  { id: "door_hardware_color", label: "Door hardware color" },
  { id: "door_hinge_color", label: "Door hinge color" },
  { id: "window_hardware_color", label: "Window hardware color" },
] as const;

export type ProductFeatureCategory =
  (typeof PRODUCT_FEATURE_CATEGORIES)[number]["id"];

export type ProductFeatureOption = {
  id?: string;
  category: ProductFeatureCategory;
  label: string;
  vendorId?: string;
  sortOrder?: number;
  isActive?: boolean;
};

export const PRODUCT_FEATURE_CATEGORY_LABELS: Record<
  ProductFeatureCategory,
  string
> = PRODUCT_FEATURE_CATEGORIES.reduce((map, item) => {
  map[item.id] = item.label;
  return map;
}, {} as Record<ProductFeatureCategory, string>);

export const PRODUCT_FEATURE_SELECT_FIELDS = [
  {
    key: "interior_frame_color",
    category: "interior_frame_color",
    label: "Interior frame color",
  },
  {
    key: "exterior_frame_color",
    category: "exterior_frame_color",
    label: "Exterior frame color",
  },
  {
    key: "glass_type",
    category: "glass_type",
    label: "Glass type",
  },
  {
    key: "glass_makeup",
    category: "glass_makeup",
    label: "Glass make up",
  },
  {
    key: "door_hardware_color",
    category: "door_hardware_color",
    label: "Door hardware color",
  },
  {
    key: "door_hinge_color",
    category: "door_hinge_color",
    label: "Door hinge color",
  },
  {
    key: "window_hardware_color",
    category: "window_hardware_color",
    label: "Window hardware color",
  },
] as const;

export type ProductFeatureSelectFieldKey =
  (typeof PRODUCT_FEATURE_SELECT_FIELDS)[number]["key"];

export type ProductFeatureSelection = {
  interior_frame_color: string;
  exterior_frame_color: string;
  glass_type: string;
  glass_makeup: string;
  stainless_operating_hardware: boolean;
  has_screens: boolean;
  door_hardware_color: string;
  door_hinge_color: string;
  window_hardware_color: string;
};

export const EMPTY_PRODUCT_FEATURE_SELECTION: ProductFeatureSelection = {
  interior_frame_color: "",
  exterior_frame_color: "",
  glass_type: "",
  glass_makeup: "",
  stainless_operating_hardware: false,
  has_screens: false,
  door_hardware_color: "",
  door_hinge_color: "",
  window_hardware_color: "",
};

export function isProductFeatureCategory(
  value: string
): value is ProductFeatureCategory {
  return PRODUCT_FEATURE_CATEGORIES.some((category) => category.id === value);
}
