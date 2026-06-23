/**
 * Extrait et télécharge un tableau d'objets au format CSV
 * @template T Le type d'objet à exporter
 * @param data Le tableau de données
 * @param filename Le nom du fichier final (ex: 'metriques_cpu.csv')
 * @param headers Un objet optionnel pour renommer proprement les colonnes du CSV { clef: 'Nom Propre' }
 */
export function exportToCSV<T extends Record<string, any>>(
  data: T[],
  filename: string,
  headers?: Partial<Record<keyof T, string>>
): void {
  if (!data || data.length === 0) {
    return;
  }

  // 1. Détermination des clés (colonnes) à partir du premier objet
  const keys = Object.keys(data[0]) as (keyof T)[];

  // 2. Génération de la ligne d'en-tête (Header)
  const headerLine = keys
    .map((key) => {
      const displayHeader = headers?.[key] || String(key);
      // Échappement des guillemets pour éviter de casser la structure du CSV
      return `"${String(displayHeader).replace(/"/g, '""')}"`;
    })
    .join(',');

  // 3. Transformation des lignes de données
  const dataLines = data.map((row) =>
    keys
      .map((key) => {
        let value = row[key];
        
        // Gestion des valeurs nulles ou indéfinies
        if (value === null || value === undefined) {
          value = '';
        }
        
        // Convertit en chaîne propre et échappe les guillemets
        return `"${String(value).replace(/"/g, '""')}"`;
      })
      .join(',')
  );

  // 4. Assemblage final avec encodage UTF-8 (pour supporter les accents français)
  const csvContent = [headerLine, ...dataLines].join('\n');
  const blob = new Blob([`\ufeff${csvContent}`], { type: 'text/csv;charset=utf-8;' });

  // 5. Création du lien de téléchargement temporaire dans le DOM
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click(); // Déclenche le téléchargement
  
  // Nettoyage de la mémoire du navigateur
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
