import { create } from 'zustand';

// Interface pour chaque point de données reçu
export interface DataPoint {
  time: string;
  value: number;
}

// Interface pour l'état du store Zustand
interface DataState {
  timeSeriesData: DataPoint[];
  maxPoints: number;
  addDataPoint: (newPoint: DataPoint) => void;
  getRawData: () => DataPoint[];
}

export const useDataStore = create<DataState>((set, get) => ({
  timeSeriesData: [],
  maxPoints: 500,

  // Ajout d'un point avec typage strict
  addDataPoint: (newPoint: DataPoint) => set((state) => {
    const updatedData = [...state.timeSeriesData, newPoint];
    
    // Stratégie FIFO (First In, First Out) pour la mémoire
    if (updatedData.length > state.maxPoints) {
      updatedData.shift();
    }
    
    return { timeSeriesData: updatedData };
  }),

  // Permet de lire les données sans déclencher de re-render React
  getRawData: () => get().timeSeriesData
}));