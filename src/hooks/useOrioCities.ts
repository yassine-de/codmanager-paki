import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OrioCity {
  city_id: number;
  city_name: string;
  province_id: number | null;
}

export function useOrioCities() {
  return useQuery({
    queryKey: ["orio-cities"],
    queryFn: async () => {
      const allCities: OrioCity[] = [];
      const batchSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("orio_cities_cache")
          .select("city_id, city_name, province_id")
          .order("city_name")
          .range(from, from + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allCities.push(...data);
        if (data.length < batchSize) break;
        from += batchSize;
      }
      return allCities;
    },
    staleTime: 24 * 60 * 60 * 1000, // 24h cache
  });
}
