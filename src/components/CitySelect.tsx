import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCarrierCities } from "@/hooks/useCarrierCities";

const pakistanCities = [
  "Abbottabad",
  "Ahmedpur East",
  "Arifwala",
  "Attock",
  "Bahawalnagar",
  "Bahawalpur",
  "Bannu",
  "Bhakkar",
  "Bhalwal",
  "Burewala",
  "Chakwal",
  "Chaman",
  "Charsadda",
  "Chiniot",
  "Chishtian",
  "Dadu",
  "Daska",
  "Dera Ghazi Khan",
  "Dera Ismail Khan",
  "Faisalabad",
  "Ghotki",
  "Gojra",
  "Gujranwala",
  "Gujrat",
  "Hafizabad",
  "Haripur",
  "Hyderabad",
  "Islamabad",
  "Jacobabad",
  "Jaranwala",
  "Jhang",
  "Jhelum",
  "Kamalia",
  "Kamoke",
  "Karachi",
  "Kasur",
  "Khairpur",
  "Khanewal",
  "Khanpur",
  "Khushab",
  "Kohat",
  "Kot Addu",
  "Lahore",
  "Larkana",
  "Layyah",
  "Lodhran",
  "Mandi Bahauddin",
  "Mardan",
  "Mianwali",
  "Mirpur Khas",
  "Multan",
  "Muzaffargarh",
  "Nawabshah",
  "Nowshera",
  "Okara",
  "Pakpattan",
  "Peshawar",
  "Quetta",
  "Rahim Yar Khan",
  "Rawalpindi",
  "Sadiqabad",
  "Sahiwal",
  "Sargodha",
  "Sheikhupura",
  "Sialkot",
  "Sukkur",
  "Swabi",
  "Swat",
  "Toba Tek Singh",
  "Vehari",
  "Wah Cantt",
  "Wazirabad",
];

interface CitySelectProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  triggerClassName?: string;
  highlightInvalid?: boolean;
  /** Set true when rendered inside a Dialog so the popover gets its own focus/pointer layer. */
  modal?: boolean;
}

export function CitySelect({ value, onValueChange, className, triggerClassName, highlightInvalid, modal }: CitySelectProps) {
  const [open, setOpen] = React.useState(false);
  const { data: cities = [], isLoading } = useCarrierCities();
  const cityOptions = React.useMemo(() => {
    const cityMap = new Map<string, { carrier_city_id: string | null; city_name: string; province_name: string | null }>();
    pakistanCities.forEach((city) => cityMap.set(city.trim().toLowerCase(), { carrier_city_id: null, city_name: city, province_name: null }));
    cities.forEach((city) => {
      const name = (city.city_name || "").trim();
      if (name) cityMap.set(name.toLowerCase(), city);
    });
    return Array.from(cityMap.values()).sort((a, b) => a.city_name.localeCompare(b.city_name));
  }, [cities]);

  const isInvalid = React.useMemo(() => {
    if (!highlightInvalid || !value || isLoading || cityOptions.length === 0) return false;
    const v = value.trim().toLowerCase().replace(/\s+/g, "");
    return !cityOptions.some((c) => (c.city_name || "").trim().toLowerCase().replace(/\s+/g, "") === v);
  }, [highlightInvalid, value, cityOptions, isLoading]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
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
          title={isInvalid ? `"${value}" is not a valid carrier city. Pick one from the list` : undefined}
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
              {cityOptions.map((city) => (
                <CommandItem
                  key={city.carrier_city_id || city.city_name}
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
