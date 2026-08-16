export type DateRangePreset = "today" | "yesterday" | "last7" | "last30" | "custom";

export interface DateRange {
  preset: DateRangePreset;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

// Presets are IST-relative regardless of the viewer's own browser
// timezone — this is an India-only tool and `date` in the DB is always
// IST, so "today"/"yesterday" must mean IST today, not local-machine today.
function istTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function presetRange(preset: Exclude<DateRangePreset, "custom">): DateRange {
  const today = istTodayISO();
  switch (preset) {
    case "today":
      return { preset, from: today, to: today };
    case "yesterday": {
      const y = addDaysISO(today, -1);
      return { preset, from: y, to: y };
    }
    case "last7":
      return { preset, from: addDaysISO(today, -6), to: today };
    case "last30":
      return { preset, from: addDaysISO(today, -29), to: today };
  }
}

export const PRESET_LABELS: Record<Exclude<DateRangePreset, "custom">, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 Days",
  last30: "Last 30 Days",
};

export const PRESET_ORDER: Exclude<DateRangePreset, "custom">[] = ["today", "yesterday", "last7", "last30"];
