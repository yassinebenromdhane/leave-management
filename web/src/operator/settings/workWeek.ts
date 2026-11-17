// Working-week toggles over the shared bitmask (bit 0 = Monday ... bit 6 = Sunday).
import { isWorkWeekday, weekdayBit, type IsoWeekday } from "@leave/shared";

export const ISO_DAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

/** Flip one weekday. The last working day cannot be switched off (the server rejects an empty week). */
export function toggleWeekday(mask: number, day: IsoWeekday): number {
  const next = mask ^ weekdayBit(day);
  return next === 0 ? mask : next;
}

export const workdaysOf = (mask: number): IsoWeekday[] => ISO_DAYS.filter((d) => isWorkWeekday(mask, d));
