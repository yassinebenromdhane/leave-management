// Fixed 8-colour palette for leave types (spec 2.3). One hue per type, used for timeline
// bars, legend chips and report columns. Status is never expressed by hue (solid vs hatched).

export const LEAVE_TYPE_PALETTE = [
  { key: "blue", hex: "#3B82F6" },
  { key: "rose", hex: "#E11D48" },
  { key: "slate", hex: "#64748B" },
  { key: "violet", hex: "#8B5CF6" },
  { key: "teal", hex: "#0D9488" },
  { key: "orange", hex: "#EA580C" },
  { key: "lime", hex: "#65A30D" },
  { key: "pink", hex: "#DB2777" },
] as const;

export type PaletteKey = (typeof LEAVE_TYPE_PALETTE)[number]["key"];

export const PALETTE_KEYS = LEAVE_TYPE_PALETTE.map((c) => c.key) as unknown as readonly [
  PaletteKey,
  ...PaletteKey[],
];

export const paletteHex = (key: PaletteKey): string =>
  LEAVE_TYPE_PALETTE.find((c) => c.key === key)?.hex ?? LEAVE_TYPE_PALETTE[0].hex;
