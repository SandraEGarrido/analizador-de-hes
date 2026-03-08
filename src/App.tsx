import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileUp, 
  AlertTriangle, 
  CheckCircle2, 
  Download, 
  FileText, 
  Settings2, 
  History,
  Trash2,
  FileSpreadsheet,
  ArrowRight,
  BarChart3,
  Files
} from 'lucide-react';
import { HESRecord, OrderGroup, DuplicateInfo } from './types';
import { generateOrderPDF, generateSummaryPDF, generateAllPDFsZip } from './services/pdfService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [hesData, setHesData] = useState<HESRecord[]>([]);
  const [billedOrders, setBilledOrders] = useState<Set<string>>(new Set());
  const [threshold, setThreshold] = useState<number>(3958316);
  const [invoiceNumbers, setInvoiceNumbers] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Process data into groups
  const orderGroups = useMemo(() => {
    if (hesData.length === 0) return [];

    const groups: Record<string, HESRecord[]> = {};
    const hesToOrder: Record<string, string[]> = {}; // HES -> [OrderID1, OrderID2, ...]
    
    hesData.forEach(record => {
      const orderId = String(record['N° Pedido']);
      const hesNum = String(record['N° HES']);
      
      if (!groups[orderId]) groups[orderId] = [];
      groups[orderId].push(record);
      
      if (!hesToOrder[hesNum]) hesToOrder[hesNum] = [];
      if (!hesToOrder[hesNum].includes(orderId)) {
        hesToOrder[hesNum].push(orderId);
      }
    });

    return Object.entries(groups).map(([orderId, records]) => {
      const totalAmount = records.reduce((sum, r) => sum + (Number(r['Importar HES']) || 0), 0);
      const totalWithIVA = totalAmount * 1.21;
      
      const duplicates: DuplicateInfo[] = [];
      const hesCountsInOrder: Record<string, number> = {};
      
      records.forEach(r => {
        const hesNum = String(r['N° HES']);
        hesCountsInOrder[hesNum] = (hesCountsInOrder[hesNum] || 0) + 1;
      });

      Object.entries(hesCountsInOrder).forEach(([hesNum, count]) => {
        // Internal duplicate
        if (count > 1) {
          duplicates.push({ hesNumber: hesNum, type: 'internal' });
        }
        
        // External duplicate
        const otherOrders = hesToOrder[hesNum].filter(id => id !== orderId);
        if (otherOrders.length > 0) {
          otherOrders.forEach(otherId => {
            duplicates.push({ hesNumber: hesNum, type: 'external', otherOrderId: otherId });
          });
        }
      });

      return {
        orderId,
        records,
        totalAmount,
        hesCount: records.length,
        invoiceType: totalWithIVA >= threshold ? 'Factura de crédito electrónica' : 'Factura electrónica',
        invoiceNumber: invoiceNumbers[orderId] || '',
        isDuplicate: billedOrders.has(orderId),
        hasExcessiveHES: records.length > 400,
        duplicates
      } as OrderGroup;
    });
  }, [hesData, billedOrders, threshold, invoiceNumbers]);

  const handleHesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];
        
        if (data.length === 0) {
          throw new Error('El archivo está vacío');
        }

        // Clean and validate data
        const cleanedData = data
          .filter(row => {
            // Ignore rows without N° HES
            if (!row['N° HES']) return false;
            
            // Ignore rows that contain "Importe Total" or "Importación Total" in any field
            const rowValues = Object.values(row).map(v => String(v).toLowerCase());
            if (rowValues.some(v => v.includes('importe total') || v.includes('importación total'))) return false;
            
            return true;
          })
          .map(row => {
            // Handle Argentine number format (e.g., 181.388.227,02)
            // We check both "Importar HES" and "Importe HES" as requested
            const rawAmount = row['Importar HES'] !== undefined ? row['Importar HES'] : row['Importe HES'];
            let amount = 0;
            if (typeof rawAmount === 'string') {
              // Remove thousands separator (.) and replace decimal comma (,) with dot (.)
              const cleaned = rawAmount.replace(/\./g, '').replace(',', '.');
              amount = parseFloat(cleaned) || 0;
            } else {
              amount = Number(rawAmount) || 0;
            }

            // Handle Excel serial dates (e.g., 46266)
            let dateVal = row['Fecha HES'];
            if (typeof dateVal === 'number') {
              // Convert Excel serial to JS Date (Excel starts at 1899-12-30)
              const date = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
              const day = String(date.getDate()).padStart(2, '0');
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const year = date.getFullYear();
              dateVal = `${day}/${month}/${year}`;
            }

            return {
              ...row,
              'N° Viaje': row['N° Viaje'] || '',
              'Provincia': row['Provincia'] || '',
              'Importar HES': amount,
              'Fecha HES': dateVal || ''
            };
          });

        // Validate columns
        const requiredColumns = ['N° Pedido', 'N° HES', 'Fecha HES'];
        // Note: N° Viaje, Provincia, and Contrato are now optional in the validation check
        
        if (cleanedData.length === 0) {
          throw new Error('No se encontraron registros válidos de HES en el archivo');
        }

        const firstRow = cleanedData[0];
        if (firstRow) {
          const missing = requiredColumns.filter(col => !(col in firstRow));
          if (missing.length > 0) {
            throw new Error(`Faltan columnas requeridas: ${missing.join(', ')}`);
          }
        }

        setHesData(cleanedData);
      } catch (err: any) {
        setError(err.message || 'Error al procesar el archivo Excel');
      } finally {
        setIsLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleBilledUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];
        
        const ids = new Set<string>();
        data.forEach(row => {
          const id = row['N° Pedido'] || row['Pedido'] || Object.values(row)[0];
          if (id) ids.add(String(id));
        });
        setBilledOrders(ids);
      } catch (err) {
        setError('Error al procesar el historial de pedidos');
      }
    };
    reader.readAsBinaryString(file);
  };

  const updateInvoiceNumber = (orderId: string, value: string) => {
    setInvoiceNumbers(prev => ({ ...prev, [orderId]: value }));
  };

  const resetAll = () => {
    setHesData([]);
    setBilledOrders(new Set());
    setInvoiceNumbers({});
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#1E293B] font-sans selection:bg-indigo-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg shadow-indigo-200 shadow-lg">
              <FileSpreadsheet className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              ANALIZADOR DE <span className="text-indigo-600">HES</span>
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            {orderGroups.length > 0 && (
              <>
                <button 
                  onClick={() => generateAllPDFsZip(orderGroups)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-200 transition-all active:scale-95"
                >
                  <Files size={16} />
                  Descargar todos los reportes
                </button>
                <button 
                  onClick={() => generateSummaryPDF(orderGroups)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-bold hover:bg-violet-700 hover:shadow-lg hover:shadow-violet-200 transition-all active:scale-95"
                >
                  <BarChart3 size={18} />
                  📊 Ver informe de control
                </button>
              </>
            )}
            <button 
              onClick={resetAll}
              className="text-slate-500 hover:text-red-600 transition-colors p-2 rounded-full hover:bg-red-50"
              title="Reiniciar todo"
            >
              <Trash2 size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Sidebar Controls */}
          <aside className="lg:col-span-4 space-y-6">
            {/* Threshold Settings */}
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <div className="flex items-center gap-2 mb-4">
                <Settings2 className="text-indigo-600 w-5 h-5" />
                <h2 className="font-semibold text-slate-800">Configuración</h2>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Límite Factura de Crédito (CLP)
                  </label>
                  <input 
                    type="number" 
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  />
                  <p className="mt-1 text-xs text-slate-400 italic">
                    El límite de 3.958.316 se compara contra el total con IVA incluido (21%).
                  </p>
                </div>
              </div>
            </section>

            {/* File Uploads */}
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <FileUp className="text-indigo-600 w-5 h-5" />
                <h2 className="font-semibold text-slate-800">Carga de Archivos</h2>
              </div>
              
              <div className="space-y-4">
                {/* Main HES File */}
                <div className="relative group">
                  <input 
                    type="file" 
                    accept=".xlsx, .xls"
                    onChange={handleHesUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div className={cn(
                    "border-2 border-dashed rounded-2xl p-6 text-center transition-all",
                    hesData.length > 0 ? "border-green-200 bg-green-50" : "border-slate-200 group-hover:border-indigo-300 group-hover:bg-indigo-50"
                  )}>
                    {hesData.length > 0 ? (
                      <div className="flex flex-col items-center gap-2">
                        <CheckCircle2 className="text-green-600 w-8 h-8" />
                        <span className="text-sm font-medium text-green-700">Archivo HES Cargado</span>
                        <span className="text-xs text-green-600">{hesData.length} registros</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <FileSpreadsheet className="text-slate-400 w-8 h-8" />
                        <span className="text-sm font-medium text-slate-600">Subir Archivo HES</span>
                        <span className="text-xs text-slate-400">Excel (.xlsx, .xls)</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* History File */}
                <div className="relative group">
                  <input 
                    type="file" 
                    accept=".xlsx, .xls"
                    onChange={handleBilledUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div className={cn(
                    "border-2 border-dashed rounded-2xl p-6 text-center transition-all",
                    billedOrders.size > 0 ? "border-indigo-200 bg-indigo-50" : "border-slate-200 group-hover:border-slate-300 group-hover:bg-slate-50"
                  )}>
                    {billedOrders.size > 0 ? (
                      <div className="flex flex-col items-center gap-2">
                        <History className="text-indigo-600 w-8 h-8" />
                        <span className="text-sm font-medium text-indigo-700">Historial Cargado</span>
                        <span className="text-xs text-indigo-600">{billedOrders.size} pedidos facturados</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <History className="text-slate-400 w-8 h-8" />
                        <span className="text-sm font-medium text-slate-600">Subir Historial (Opcional)</span>
                        <span className="text-xs text-slate-400">Para control de duplicados</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Quick Stats */}
            {orderGroups.length > 0 && (
              <section className="bg-indigo-900 rounded-2xl p-6 text-white shadow-xl shadow-indigo-200">
                <h3 className="text-indigo-200 text-xs font-bold uppercase tracking-wider mb-4">Resumen de Análisis</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-2xl font-bold">{orderGroups.length}</p>
                    <p className="text-indigo-300 text-xs">Pedidos Totales</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-red-400">
                      {orderGroups.filter(g => g.isDuplicate || g.hasExcessiveHES).length}
                    </p>
                    <p className="text-indigo-300 text-xs">Con Alertas</p>
                  </div>
                </div>
              </section>
            )}

            {/* Instructions */}
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <h3 className="text-slate-800 font-semibold mb-3 flex items-center gap-2">
                <FileText size={18} className="text-indigo-600" />
                Instrucciones
              </h3>
              <ul className="text-xs text-slate-500 space-y-2 list-disc pl-4">
                <li>Carga el archivo Excel con las columnas requeridas (Contrato, Pedido, etc).</li>
                <li>Opcionalmente, carga el historial para detectar pedidos ya facturados.</li>
                <li>Ajusta el límite de monto para la clasificación de facturas.</li>
                <li>Ingresa el número de factura manualmente para cada pedido.</li>
                <li>Descarga el PDF individual para cada pedido procesado.</li>
              </ul>
            </section>
          </aside>

          {/* Main Content Area */}
          <section className="lg:col-span-8">
            <AnimatePresence mode="wait">
              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6 flex items-start gap-3"
                >
                  <AlertTriangle className="text-red-600 shrink-0 mt-0.5" size={20} />
                  <div>
                    <h3 className="text-red-800 font-semibold text-sm">Error detectado</h3>
                    <p className="text-red-600 text-sm">{error}</p>
                  </div>
                </motion.div>
              )}

              {hesData.length === 0 ? (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-white rounded-3xl border border-slate-200 p-12 text-center flex flex-col items-center justify-center min-h-[400px]"
                >
                  <div className="bg-slate-50 p-6 rounded-full mb-6">
                    <FileText size={48} className="text-slate-300" />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-800 mb-2">Comienza cargando un archivo</h2>
                  <p className="text-slate-500 max-w-md mx-auto">
                    Sube tu archivo Excel con las HES para analizar los pedidos, verificar límites y generar los informes PDF.
                  </p>
                </motion.div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                      Pedidos Procesados
                      <span className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-full font-medium">
                        {orderGroups.length}
                      </span>
                    </h2>
                  </div>

                  <div className="grid gap-4">
                    {orderGroups.map((group) => (
                      <motion.div 
                        key={group.orderId}
                        layout
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={cn(
                          "bg-white rounded-2xl border p-5 transition-all shadow-sm hover:shadow-md",
                          group.isDuplicate ? "border-red-200 bg-red-50/30" : 
                          group.duplicates.length > 0 ? "border-red-200 bg-red-50/30" :
                          group.hasExcessiveHES ? "border-orange-200 bg-orange-50/30" : 
                          group.invoiceType === 'Factura electrónica' ? "border-emerald-100 bg-emerald-50/20" : "border-violet-100 bg-violet-50/20"
                        )}
                      >
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pedido</span>
                              <h3 className="text-lg font-bold text-slate-800">#{group.orderId}</h3>
                              <span className="bg-slate-100 text-slate-600 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">
                                {group.hesCount} HES
                              </span>
                              {group.isDuplicate && (
                                <span className="bg-red-100 text-red-700 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase flex items-center gap-1">
                                  <AlertTriangle size={10} /> Duplicado
                                </span>
                              )}
                              {group.duplicates.length > 0 && (
                                <span className="bg-red-100 text-red-700 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase flex items-center gap-1">
                                  <AlertTriangle size={10} /> HES Duplicadas
                                </span>
                              )}
                              {group.hasExcessiveHES && (
                                <span className="bg-orange-100 text-orange-700 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase flex items-center gap-1">
                                  <AlertTriangle size={10} /> Exceso HES
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              <p className="text-sm text-slate-500 flex items-center gap-1">
                                <span className="font-semibold text-slate-700">
                                  {group.totalAmount.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })} (Neto)
                                </span>
                                <ArrowRight size={12} className="text-slate-300" />
                                <span className={cn(
                                  "px-2 py-0.5 rounded-md text-[10px] font-bold uppercase",
                                  group.invoiceType === 'Factura electrónica' ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700"
                                )}>
                                  {group.invoiceType}
                                </span>
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <input 
                                type="text" 
                                placeholder="N° Factura"
                                value={group.invoiceNumber}
                                onChange={(e) => updateInvoiceNumber(group.orderId, e.target.value)}
                                className="w-32 px-3 py-2 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                              />
                            </div>
                            <button 
                              onClick={() => generateOrderPDF(group)}
                              disabled={group.isDuplicate}
                              className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95",
                                group.isDuplicate 
                                  ? "bg-slate-100 text-slate-400 cursor-not-allowed" 
                                  : group.invoiceType === 'Factura electrónica' 
                                    ? "bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow-emerald-100" 
                                    : "bg-violet-600 text-white hover:bg-violet-700 hover:shadow-violet-100"
                              )}
                            >
                              <Download size={16} />
                              PDF
                            </button>
                          </div>
                        </div>

                        {/* Alerts */}
                        {(group.isDuplicate || group.hasExcessiveHES || group.duplicates.length > 0) && (
                          <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                            {group.isDuplicate && (
                              <p className="text-xs text-red-600 flex items-center gap-1.5 font-medium">
                                <AlertTriangle size={14} />
                                Este pedido ya fue facturado anteriormente. No se puede generar el informe.
                              </p>
                            )}
                            {group.duplicates.map((dup, idx) => (
                              <p key={idx} className="text-xs text-red-600 flex items-center gap-1.5 font-medium">
                                <AlertTriangle size={14} />
                                {dup.type === 'internal' 
                                  ? `HES duplicada dentro del pedido: ${dup.hesNumber}` 
                                  : `HES ${dup.hesNumber} ya está registrada en el pedido ${dup.otherOrderId}`}
                              </p>
                            ))}
                            {group.hasExcessiveHES && (
                              <p className="text-xs text-orange-600 flex items-center gap-1.5 font-medium">
                                <AlertTriangle size={14} />
                                Cantidad de HES elevada ({group.hesCount}). El límite recomendado es 400.
                              </p>
                            )}
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        </div>
      </main>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-slate-600 font-medium animate-pulse">Procesando datos...</p>
          </div>
        </div>
      )}
    </div>
  );
}
