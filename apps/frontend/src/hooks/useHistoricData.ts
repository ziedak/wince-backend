import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { apiClient } from '../lib/axios-client';

interface UseHistoricDataOptions {
  url: string;
  params?: Record<string, unknown>;
  enabled?: boolean;
}

/**
 * Hook générique pour récupérer des données historiques du SaaS.
 * @template T Le type de structure de données attendu du serveur (ex: MetricPoint[])
 */
export function useHistoricData<T>({ 
  url, 
  params = {}, 
  enabled = true 
}: UseHistoricDataOptions): UseQueryResult<T, Error> {
  
  return useQuery<T, Error>({
    // La clé de cache combine l'URL et les paramètres pour éviter les collisions de cache
    queryKey: [url, params], 
    
    queryFn: async () => {
      const { data } = await apiClient.get<T>(url, { params });
      return data;
    },
    
    // Configurations de performance pour la data historique de masse
    staleTime: 5 * 60 * 1000,    // Les données restent considérées comme fraîches pendant 5 min
    gcTime: 15 * 60 * 1000,       // Conserve le cache en mémoire 15 min avant Garbage Collection
    refetchOnWindowFocus: false, // Évite de re-télécharger les données si l'utilisateur change d'onglet
    enabled: enabled,            // Permet de désactiver le hook si une condition n'est pas remplie
  });
}