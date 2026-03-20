import XLSX from 'xlsx-js-style';
import JSZip from 'jszip';
import { OrderGroup } from '../types';

const formatAR = (num: number) => {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

const createOrderExcelWorkbook = (order: OrderGroup) => {
  const data = order.records.map(r => ({
    'Contrato': r.Contrato,
    'N° Pedido': r['N° Pedido'],
    'N° Viaje': r['N° Viaje'],
    'Provincia': r.Provincia,
    'N° HES': r['N° HES'],
    'Fecha HES': String(r['Fecha HES'] ?? ''),
    'Importe HES': r['Importar HES'] // Use number for right-alignment
  }));

  // Add total row
  data.push({
    'Contrato': '',
    'N° Pedido': '',
    'N° Viaje': '',
    'Provincia': '',
    'N° HES': '',
    'Fecha HES': 'Importe total:',
    'Importe HES': order.totalAmount
  });

  const ws = XLSX.utils.json_to_sheet(data);

  // Forzar la columna "Fecha HES" (F) como texto para que Numbers no la reinterprete
  const fechaColIndex = 5; // A=0, B=1, C=2, D=3, E=4, F=5

  for (let rowIndex = 1; rowIndex <= data.length; rowIndex++) {
    const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: fechaColIndex });
    const cell = ws[cellRef];

    if (cell) {
      cell.t = 's'; // texto
      cell.v = String(cell.v ?? '');
      delete cell.w;
      delete cell.z;
    }
  }

  // Apply styles to headers (A1 to G1)
  const headerStyle = {
    font: { bold: true },
    border: {
      top: { style: 'medium', color: { rgb: '000000' } },
      bottom: { style: 'medium', color: { rgb: '000000' } },
      left: { style: 'medium', color: { rgb: '000000' } },
      right: { style: 'medium', color: { rgb: '000000' } }
    },
    alignment: { horizontal: 'center' }
  };

  const headerRange = ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1'];
  headerRange.forEach(cellId => {
    if (ws[cellId]) {
      ws[cellId].s = headerStyle;
    }
  });

  // Apply bold to "Importe total:" label (Column F, last row)
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const lastRowIndex = range.e.r;
  const totalLabelCellId = XLSX.utils.encode_cell({ r: lastRowIndex, c: 5 });
  if (ws[totalLabelCellId]) {
    ws[totalLabelCellId].s = { font: { bold: true } };
  }

  // Set number format for the amount column (column G, index 6)
  for (let R = range.s.r + 1; R <= range.e.r; ++R) {
    const cell = ws[XLSX.utils.encode_cell({ r: R, c: 6 })];
    if (cell && typeof cell.v === 'number') {
      cell.z = '#,##0.00';
    }
  }

  // Auto-adjust column widths
  const colWidths = [
    { wch: 10 }, // Contrato
    { wch: 12 }, // N° Pedido
    { wch: 10 }, // N° Viaje
    { wch: 15 }, // Provincia
    { wch: 12 }, // N° HES
    { wch: 12 }, // Fecha HES
    { wch: 15 }, // Importe HES
  ];

  // Calculate max width for each column
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
  rows.forEach((row) => {
    row.forEach((cell, i) => {
      if (i < colWidths.length) {
        const value = cell ? String(cell) : '';
        if (value.length + 2 > colWidths[i].wch) {
          colWidths[i].wch = value.length + 2;
        }
      }
    });
  });
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reporte HES');
  return wb;
};

export const generateOrderExcel = (order: OrderGroup) => {
  const wb = createOrderExcelWorkbook(order);
  const fileName = order.invoiceNumber
    ? `Factura_${order.invoiceNumber}.xlsx`
    : `Factura_${order.orderId}.xlsx`;

  XLSX.writeFile(wb, fileName);
};

export const generateAllExcelZip = async (orders: OrderGroup[]) => {
  const zip = new JSZip();

  // NO sorting as per requirement: "NO reordenar los datos bajo ninguna circunstancia"
  const fe = orders.filter(o => o.invoiceType === 'Factura electrónica');
  const fce = orders.filter(o => o.invoiceType === 'Factura de crédito electrónica');

  // Add FE to zip
  for (let i = 0; i < fe.length; i++) {
    const order = fe[i];
    const wb = createOrderExcelWorkbook(order);
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const fileName = order.invoiceNumber
      ? `Factura_${order.invoiceNumber}.xlsx`
      : `01_FE_${String(i + 1).padStart(3, '0')}_Pedido_${order.orderId}.xlsx`;
    zip.file(fileName, wbout);
  }

  // Add FCE to zip
  for (let i = 0; i < fce.length; i++) {
    const order = fce[i];
    const wb = createOrderExcelWorkbook(order);
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const fileName = order.invoiceNumber
      ? `Factura_${order.invoiceNumber}.xlsx`
      : `02_FCE_${String(i + 1).padStart(3, '0')}_Pedido_${order.orderId}.xlsx`;
    zip.file(fileName, wbout);
  }

  const content = await zip.generateAsync({ type: 'blob' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(content);
  link.download = 'reportes_facturacion_HES_Excel.zip';
  link.click();
};
