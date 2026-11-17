// Work pattern bitmask, stored in company_settings.work_days and employee.work_days_override.
// Bit order: bit 0 = Monday … bit 6 = Sunday (ISO weekday - 1). This file is the only place
// that knows the bit order.

export type WeekMask = number;

/** ISO weekday: 1 = Monday … 7 = Sunday (date-fns `getISODay`). */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const weekdayBit = (isoWeekday: IsoWeekday): number => 1 << (isoWeekday - 1);

export const isWorkWeekday = (mask: WeekMask, isoWeekday: IsoWeekday): boolean =>
  (mask & weekdayBit(isoWeekday)) !== 0;

export const maskFromWeekdays = (days: readonly IsoWeekday[]): WeekMask =>
  days.reduce((m, d) => m | weekdayBit(d), 0);

/** Common presets offered by the Company settings tab (spec 1.5). */
export const WEEK_PRESETS = {
  monFri: maskFromWeekdays([1, 2, 3, 4, 5]),
  monSat: maskFromWeekdays([1, 2, 3, 4, 5, 6]),
  sunThu: maskFromWeekdays([7, 1, 2, 3, 4]),
} as const;

export const isValidWeekMask = (mask: number): boolean =>
  Number.isInteger(mask) && mask > 0 && mask <= 0b1111111;
