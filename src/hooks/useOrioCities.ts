import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CarrierCity {
  carrier_city_id: string | null;
  city_name: string;
  province_name: string | null;
  carrier_code?: string;
}

export function useCarrierCities(carrierCode = "orio") {
  return useQuery({
    queryKey: ["carrier-cities", carrierCode],
    queryFn: async () => {
      const { data: carrier, error: carrierError } = await supabase
        .from("carriers" as any)
        .select("id, code")
        .eq("code", carrierCode)
        .maybeSingle();
      if (carrierError) throw carrierError;
      if (!carrier?.id) return [];

      const allCities: CarrierCity[] = [];
      const batchSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("carrier_city_cache" as any)
          .select("carrier_city_id, city_name, province_name")
          .eq("carrier_id", carrier.id)
          .order("city_name")
          .range(from, from + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allCities.push(...data.map((city: any) => ({ ...city, carrier_code: carrierCode })));
        if (data.length < batchSize) break;
        from += batchSize;
      }
      return allCities;
    },
    staleTime: 24 * 60 * 60 * 1000, // 24h cache
  });
}

export type OrioCity = CarrierCity;

export function useOrioCities() {
  return useCarrierCities("orio");
}
