import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useOrioCities } from "@/hooks/useOrioCities";

interface CitySelectProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  triggerClassName?: string;
  highlightInvalid?: boolean;
}

export function CitySelect({ value, onValueChange, className, triggerClassName, highlightInvalid }: CitySelectProps) {
  const [open, setOpen] = React.useState(false);
  const { data: cities = [], isLoading } = useOrioCities();

  const isInvalid = React.useMemo(() => {
    if (!highlightInvalid || !value || isLoading || cities.length === 0) return false;
    const v = value.trim().toLowerCase().replace(/\s+/g, "");
    return !cities.some((c) => (c.city_name || "").trim().toLowerCase().replace(/\s+/g, "") === v);
  }, [highlightInvalid, value, cities, isLoading]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "justify-between font-normal",
            triggerClassName || "h-9 text-sm",
            isInvalid && "border-destructive text-destructive"
          )}
          title={isInvalid ? `"${value}" is not a valid ORIO city — pick one from the list` : undefined}
        >
          <span className="truncate">{value || (isLoading ? "Loading cities..." : "Select city")}</span>
          <ChevronsUpDown className="ml-1.5 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-[260px] p-0", className)} align="start">
        <Command>
          <CommandInput placeholder="Search city..." className="h-9 text-sm" />
          <CommandList className="max-h-[250px]">
            <CommandEmpty className="py-3 text-xs text-center text-muted-foreground">
              {isLoading ? "Loading..." : "No city found."}
            </CommandEmpty>
            <CommandGroup>
              {cities.map((city) => (
                <CommandItem
                  key={city.city_id}
                  value={city.city_name}
                  onSelect={() => {
                    onValueChange(city.city_name);
                    setOpen(false);
                  }}
                  className="text-sm"
                >
                  <Check className={cn("mr-2 h-3.5 w-3.5", value === city.city_name ? "opacity-100" : "opacity-0")} />
                  {city.city_name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
