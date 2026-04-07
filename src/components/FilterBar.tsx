import { useState } from "react";
import { Check, ChevronsUpDown, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { sellerNames, productNames } from "@/lib/data";
import type { DateRange } from "react-day-picker";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";

const statusFilters = [
  "All", "New", "Confirmed", "No Answer", "Postponed", "Cancelled", "Returned",
] as const;

const countries = ["All", "Pakistan"] as const;

interface FilterBarProps {
  onFiltersChange?: (filters: {
    datePreset: DatePresetValue;
    dateRange?: DateRange;
    status: string;
    country: string;
    seller: string;
    product: string;
  }) => void;
  hideSeller?: boolean;
}

function SearchableDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border bg-card text-xs font-medium hover:bg-muted/40 transition-colors active:scale-[0.97]">
          {value === "All" ? label : value}
          <ChevronsUpDown className="w-3 h-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}...`} className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-3 text-xs text-center text-muted-foreground">No results.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o}
                  value={o}
                  onSelect={() => { onChange(o); setOpen(false); }}
                  className="text-xs"
                >
                  <Check className={cn("mr-2 h-3.5 w-3.5", value === o ? "opacity-100" : "opacity-0")} />
                  {o}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function FilterBar({ onFiltersChange, hideSeller = false }: FilterBarProps) {
  const [datePreset, setDatePreset] = useState<DatePresetValue>("today");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [status, setStatus] = useState("All");
  const [country, setCountry] = useState("All");
  const [seller, setSeller] = useState("All");
  const [product, setProduct] = useState("All");
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const handleReset = () => {
    setDatePreset("today");
    setDateRange(undefined);
    setStatus("All");
    setCountry("All");
    setSeller("All");
    setProduct("All");
  };

  const allSellers = ["All", ...sellerNames] as const;
  const allProducts = ["All", ...productNames] as const;
  const allStatuses = statusFilters;

  return (
    <div className="sticky top-0 z-30 -mx-4 px-4 py-2.5 bg-background/80 backdrop-blur-xl border-b">
      {/* Desktop */}
      <div className="hidden md:flex items-center gap-2 flex-wrap">
        <DatePresetFilter
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          preset={datePreset}
          onPresetChange={setDatePreset}
        />

        <div className="w-px h-5 bg-border" />

        {/* Searchable dropdowns */}
        <SearchableDropdown label="Status" value={status} options={allStatuses} onChange={setStatus} />
        {!hideSeller && <SearchableDropdown label="Seller" value={seller} options={allSellers} onChange={setSeller} />}
        <SearchableDropdown label="Product" value={product} options={allProducts} onChange={setProduct} />
        <SearchableDropdown label="Country" value={country} options={countries} onChange={setCountry} />

        <div className="flex-1" />

        <button
          onClick={handleReset}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors active:scale-[0.97]"
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
      </div>

      {/* Mobile */}
      <div className="md:hidden">
        <div className="flex items-center justify-between gap-2">
          <DatePresetFilter
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            preset={datePreset}
            onPresetChange={setDatePreset}
            className="flex-1"
          />
          <button
            onClick={() => setShowMobileFilters(!showMobileFilters)}
            className={cn(
              "p-2 rounded-xl border transition-colors flex-shrink-0",
              showMobileFilters ? "bg-foreground text-background" : "bg-card"
            )}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>

        {showMobileFilters && (
          <div className="mt-2 p-3 bg-card border rounded-xl space-y-3 animate-slide-up">
            <div className="flex gap-2 flex-wrap">
              <SearchableDropdown label="Status" value={status} options={allStatuses} onChange={setStatus} />
              {!hideSeller && <SearchableDropdown label="Seller" value={seller} options={allSellers} onChange={setSeller} />}
              <SearchableDropdown label="Product" value={product} options={allProducts} onChange={setProduct} />
              <SearchableDropdown label="Country" value={country} options={countries} onChange={setCountry} />
            </div>
            <div className="flex justify-end">
              <button onClick={handleReset} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
