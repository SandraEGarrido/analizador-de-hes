import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { OrderGroup } from '../types';
import { getTodayFormatted } from '../utils/dateUtils';

const formatAR = (num: number) => {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

export const createOrderPDFDoc = (order: OrderGroup) => {
  const doc = new jsPDF();

  // Table
  const tableData = order.records.map(r => [
    r.Contrato,
    r['N° Pedido'],
    r['N° Viaje'],
    r.Provincia,
    r['N° HES'],
    String(r['Fecha HES'] ?? ''),
    formatAR(r['Importar HES'])
  ]);

  autoTable(doc, {
    startY: 10, // Start directly with the table
    head: [['Contrato', 'N° Pedido', 'N° Viaje', 'Provincia', 'N° HES', 'Fecha HES', 'Importar HES']],
    body: tableData,
    foot: [[
      '', '', '', '', '', 
      'Importe total:', 
      formatAR(order.totalAmount)
    ]],
    showFoot: 'lastPage',
    showHead: 'firstPage',
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', lineWidth: 0.4, lineColor: [0, 0, 0] },
    footStyles: { fillColor: [245, 245, 245], textColor: [0, 0, 0], fontStyle: 'normal', lineWidth: 0.1 },
    columnStyles: {
      6: { halign: 'right' }
    },
    didParseCell: (data) => {
      if (data.section === 'foot' && data.column.index === 5) {
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });

  return doc;
};

export const generateOrderPDF = (order: OrderGroup) => {
  const doc = createOrderPDFDoc(order);
  const fileName = order.invoiceNumber 
    ? `Factura_${order.invoiceNumber}.pdf` 
    : `Factura_${order.orderId}.pdf`;
  doc.save(fileName);
};

export const generateAllPDFsZip = async (orders: OrderGroup[]) => {
  const zip = new JSZip();
  
  // NO sorting as per requirement: "NO reordenar los datos bajo ninguna circunstancia"
  const fe = orders.filter(o => o.invoiceType === 'Factura electrónica');
  const fce = orders.filter(o => o.invoiceType === 'Factura de crédito electrónica');

  // Add FE to zip
  for (let i = 0; i < fe.length; i++) {
    const order = fe[i];
    const doc = createOrderPDFDoc(order);
    const pdfBlob = doc.output('blob');
    const fileName = order.invoiceNumber 
      ? `Factura_${order.invoiceNumber}.pdf` 
      : `01_FE_${String(i + 1).padStart(3, '0')}_Pedido_${order.orderId}.pdf`;
    zip.file(fileName, pdfBlob);
  }

  // Add FCE to zip
  for (let i = 0; i < fce.length; i++) {
    const order = fce[i];
    const doc = createOrderPDFDoc(order);
    const pdfBlob = doc.output('blob');
    const fileName = order.invoiceNumber 
      ? `Factura_${order.invoiceNumber}.pdf` 
      : `02_FCE_${String(i + 1).padStart(3, '0')}_Pedido_${order.orderId}.pdf`;
    zip.file(fileName, pdfBlob);
  }

  const content = await zip.generateAsync({ type: 'blob' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(content);
  link.download = 'reportes_facturacion_HES.zip';
  link.click();
};

export const generateSummaryPDF = (orders: OrderGroup[]) => {
  const doc = new jsPDF();
  
  const fe = orders.filter(o => o.invoiceType === 'Factura electrónica');
  const fce = orders.filter(o => o.invoiceType === 'Factura de crédito electrónica');
  
  const totalFE = fe.reduce((sum, o) => sum + o.totalAmount, 0);
  const totalFCE = fce.reduce((sum, o) => sum + o.totalAmount, 0);

  doc.setFontSize(18);
  doc.text('Resumen de facturación', 14, 20);
  
  doc.setFontSize(10);
  doc.text(`Fecha de generación: ${getTodayFormatted()}`, 14, 30);

  autoTable(doc, {
    startY: 40,
    head: [['Concepto', 'Valor']],
    body: [
      ['Cantidad de Facturas Electrónicas', fe.length],
      ['Importe total de Facturas Electrónicas', formatAR(totalFE)],
      ['Cantidad de Facturas de Crédito Electrónico', fce.length],
      ['Importe total de Facturas de Crédito Electrónicas', formatAR(totalFCE)],
      ['Total de Pedidos Procesados', orders.length],
      ['Importe Total General', formatAR(totalFE + totalFCE)]
    ],
    theme: 'grid',
    headStyles: { fillColor: [41, 128, 185], textColor: [255, 255, 255] },
    columnStyles: {
      1: { halign: 'right' }
    },
    styles: { fontStyle: 'bold' }
  });

  doc.save('Reporte_Control_Facturacion.pdf');
};
