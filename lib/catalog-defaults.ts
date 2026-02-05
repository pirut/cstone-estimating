export type VendorDefault = {
  id?: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type UnitTypeDefault = {
  code: string;
  label: string;
  price: number;
  sortOrder: number;
  isActive: boolean;
};

export const DEFAULT_VENDORS: VendorDefault[] = [
  { name: "ES Windows & Doors", sortOrder: 1, isActive: true },
  {
    name: "Viewscapes Luxury Aluminum Windows and Doors",
    sortOrder: 2,
    isActive: true,
  },
  { name: "ES Garage Doors", sortOrder: 3, isActive: true },
  { name: "Brombal Steel Windows & Doors", sortOrder: 4, isActive: true },
  {
    name: "ēWood Luxury Wood Windows and Doors",
    sortOrder: 5,
    isActive: true,
  },
  { name: "Kolbe Windows and Doors", sortOrder: 6, isActive: true },
  { name: "Oikos Doors", sortOrder: 7, isActive: true },
  { name: "Subcontractor Bucking", sortOrder: 8, isActive: true },
  { name: "Subcontractor Waterproofing", sortOrder: 9, isActive: true },
  { name: "Subcontractor Installation", sortOrder: 10, isActive: true },
  { name: "Subcontractor Covers & Hardware", sortOrder: 11, isActive: true },
  {
    name: "General Pre-planned Rental Equipment",
    sortOrder: 12,
    isActive: true,
  },
  { name: "Subcontractor Punch Out", sortOrder: 13, isActive: true },
];

export const DEFAULT_UNIT_TYPES: UnitTypeDefault[] = [
  { code: "SH", label: "SH", price: 300, sortOrder: 1, isActive: true },
  { code: "HR", label: "HR", price: 300, sortOrder: 2, isActive: true },
  { code: "CA", label: "CA", price: 440, sortOrder: 3, isActive: true },
  {
    code: "SF Medium",
    label: "SF Medium",
    price: 450,
    sortOrder: 4,
    isActive: true,
  },
  {
    code: "SF Large",
    label: "SF Large",
    price: 700,
    sortOrder: 5,
    isActive: true,
  },
  { code: "FD", label: "FD", price: 600, sortOrder: 6, isActive: true },
  { code: "SGD", label: "SGD", price: 550, sortOrder: 7, isActive: true },
  {
    code: "Pivot",
    label: "Pivot",
    price: 770,
    sortOrder: 8,
    isActive: true,
  },
  {
    code: "Bifold",
    label: "Bifold",
    price: 715,
    sortOrder: 9,
    isActive: true,
  },
  {
    code: "Mull Bar",
    label: "Mull Bar",
    price: 100,
    sortOrder: 10,
    isActive: true,
  },
];
