import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CarrierCity {
  carrier_id?: string | null;
  carrier_city_id: string | null;
  city_name: string;
  province_name: string | null;
  carrier_code?: string;
}

export function useCarrierCities(carrierCode = "all") {
  return useQuery({
    queryKey: ["carrier-cities", carrierCode],
    queryFn: async () => {
      const carrierQuery = supabase
        .from("carriers" as any)
        .select("id, code")
        .eq("enabled", true);

      const { data: carrierRows, error: carrierError } =
        carrierCode === "all"
          ? await carrierQuery
          : await carrierQuery.eq("code", carrierCode);

      if (carrierError) throw carrierError;

      const carriers = (carrierRows || []).filter((carrier: any) => carrier?.id);
      if (carriers.length === 0) return [];

      const carrierIds = carriers.map((carrier: any) => carrier.id);
      const carrierCodeById = new Map<string, string>(
        carriers.map((carrier: any) => [carrier.id, carrier.code || carrierCode]),
      );

      const allCities: CarrierCity[] = [];
      const batchSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("carrier_city_cache" as any)
          .select("carrier_id, carrier_city_id, city_name, province_name")
          .in("carrier_id", carrierIds)
          .order("city_name")
          .range(from, from + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allCities.push(
          ...data.map((city: any) => ({
            ...city,
            carrier_code: carrierCodeById.get(city.carrier_id) || carrierCode,
          })),
        );
        if (data.length < batchSize) break;
        from += batchSize;
      }
      return allCities;
    },
    staleTime: 24 * 60 * 60 * 1000, // 24h cache
  });
}
