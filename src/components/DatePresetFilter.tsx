import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import type { DateRange } from "react-day-picker";

export type DatePresetValue = "today" | "yesterday" | "7d" | "this_month" | "last_month" | "maximum" | "custom";

const datePresets: { label: string; value: DatePresetValue }[] = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 days", value: "7d" },
  { label: "This month", value: "this_month" },
  { label: "Last month", value: "last_month" },
  { label: "Maximum", value: "maximum" },
];

export function getDateRangeFromPreset(preset: DatePresetValue): DateRange | undefined {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": {
      const y = subDays(now, 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "7d":
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case "this_month":
      return { from: startOfMonth(now), to: endOfDay(now) };
    case "last_month": {
      const lm = subMonths(now, 1);
      return { from: startOfMonth(lm), to: endOfMonth(lm) };
    }
    case "maximum":
      return undefined;
    case "custom":
      return undefined;
    default:
      return undefined;
  }
}

interface DatePresetFilterProps {
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
  preset: DatePresetValue;
  onPresetChange: (preset: DatePresetValue) => void;
  className?: string;
}

export function DatePresetFilter({ dateRange, onDateRangeChange, preset, onPresetChange, className }: DatePresetFilterProps) {
  const [open, setOpen] = useState(false);

  const handlePresetClick = (value: DatePresetValue) => {
    onPresetChange(value);
    if (value !== "custom") {
      onDateRangeChange(getDateRangeFromPreset(value));
      setOpen(false);
    }
  };

  const displayLabel = preset === "custom" && dateRange?.from
    ? `${format(dateRange.from, "MMM d, yyyy")}${dateRange.to ? ` → ${format(dateRange.to, "MMM d, yyyy")}` : ""}`
    : datePresets.find(p => p.value === preset)?.label || "Select date";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-9 text-xs justify-start gap-2 min-w-[180px]",
            !dateRange && preset === "maximum" && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5" />
          {displayLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" sideOffset={8}>
        <div className="flex">
          {/* Sidebar presets */}
          <div className="border-r w-[140px] p-2 space-y-0.5">
            {datePresets.map((p) => (
              <button
                key={p.value}
                onClick={() => handlePresetClick(p.value)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                  preset === p.value
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-muted"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Calendar */}
          <div className="p-1">
            <div className="flex items-center gap-2 px-3 pt-2 pb-1 text-xs text-muted-foreground">
              <div className="flex-1 rounded-md border px-2.5 py-1.5 text-foreground text-[11px] tabular-nums">
                {dateRange?.from ? format(dateRange.from, "MMM d, yyyy") : "Start date"}
              </div>
              <span>→</span>
              <div className="flex-1 rounded-md border px-2.5 py-1.5 text-foreground text-[11px] tabular-nums">
                {dateRange?.to ? format(dateRange.to, "MMM d, yyyy") : "End date"}
              </div>
            </div>
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={(range) => {
                onDateRangeChange(range);
                onPresetChange("custom");
              }}
              numberOfMonths={2}
              className="p-3 pointer-events-auto"
            />
            <div className="flex justify-end gap-2 px-3 pb-3">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  onPresetChange("maximum");
                  onDateRangeChange(undefined);
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => setOpen(false)}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
