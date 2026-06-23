import React from 'react';
import { Download } from 'lucide-react';
import { exportToCSV } from '@/utils/exportToCSV';


interface ExportCsvButtonProps<T> {
  data: T[] | undefined;
  filename?: string;
  headers?: Partial<Record<keyof T, string>>;
}

export default function ExportCsvButton<T extends Record<string, any>>({
  data,
  filename = 'export_saas.csv',
  headers,
}: ExportCsvButtonProps<T>): React.JSX.Element {
  
  const handleExport = () => {
    if (!data || data.length === 0) return;
    exportToCSV(data, filename, headers);
  };

  // Le bouton reste désactivé si aucune donnée n'est chargée en mémoire
  const isDisabled = !data || data.length === 0;

  return (
    <button
      onClick={handleExport}
      disabled={isDisabled}
      className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border transition-all ${
        isDisabled
          ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'
          : 'bg-gray-800 border-gray-700 text-gray-200 hover:text-white hover:bg-gray-700 hover:border-gray-600 shadow-sm'
      }`}
    >
      <Download size={14} />
      Exporter en CSV
    </button>
  );
}
