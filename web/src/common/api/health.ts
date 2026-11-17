import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { queryKeys } from "./keys";

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: async () => {
      const res = await api.api.health.$get();
      if (!res.ok) throw new Error(`health ${res.status}`);
      return res.json();
    },
  });
}
