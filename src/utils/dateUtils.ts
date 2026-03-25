/**
 * Utility functions for strict date parsing and formatting.
 * Avoids toLocaleDateString() and regional settings.
 */

/**
 * Parses a value from Excel (serial number or string) and returns it in MM/DD/YYYY format.
 * Strictly follows manual parsing and reordering as requested.
 */
export function parseExcelDate(dateVal: any): string {
  if (dateVal === null || dateVal === undefined || dateVal === '') {
    return '';
  }

  let day = '';
  let month = '';
  let year = '';

  // If it's a number (Excel serial date)
  if (typeof dateVal === 'number') {
    // Convert Excel serial to JS Date (Excel starts at 1899-12-30)
    // Using UTC to avoid any timezone/locale interference
    const date = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
    
    day = String(date.getUTCDate()).padStart(2, '0');
    month = String(date.getUTCMonth() + 1).padStart(2, '0');
    year = String(date.getUTCFullYear());
  } else if (typeof dateVal === 'string') {
    // Manual split by common separators (assuming source is DD/MM/YYYY)
    // We take the value EXACTLY as it comes and split it manually
    const parts = dateVal.split(/[/-]/);
    if (parts.length === 3) {
      // Extract parts manually assuming DD/MM/YYYY from source
      // This ensures we have the day, month, and year separately
      day = parts[0].trim().padStart(2, '0');
      month = parts[1].trim().padStart(2, '0');
      year = parts[2].trim();
      
      // Ensure year is 4 digits
      if (year.length === 2) {
        year = `20${year}`;
      }
    } else {
      return String(dateVal);
    }
  } else {
    return String(dateVal);
  }

  // REQUISITO OBLIGATORIO: Reordenar manualmente: mes / día / año (MM/DD/YYYY)
  // Asegurar que: el mes sea el primer valor, el día sea el segundo, el año sea el tercero.
  // Ejemplo: 05/03/2026 (DD/MM/YYYY) -> 03/05/2026 (MM/DD/YYYY)
  return `${month}/${day}/${year}`;
}

/**
 * Returns today's date in MM/DD/YYYY format.
 */
export function getTodayFormatted(): string {
  const date = new Date();
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}/${month}/${year}`;
}
