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
const hasBlockingIssues = (order: OrderGroup) => {
  return order.isDuplicate || order.duplicates.length > 0 || order.hasExcessiveHES;
};

const getBlockingReason = (order: OrderGroup) => {
  const reasons: string[] = [];

  if (order.isDuplicate) {
    reasons.push('Ya facturado en historial');
  }

  if (order.duplicates.length > 0) {
    reasons.push('HES duplicadas');
  }

  if (order.hasExcessiveHES) {
    reasons.push(`Exceso de HES (${order.hesCount})`);
  }

  return reasons.join(' | ');
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

  const validOrders = orders.filter(order => !hasBlockingIssues(order));
  const blockedOrders = orders.filter(order => hasBlockingIssues(order));

  const fe = validOrders.filter(order => order.invoiceType === 'Factura electrónica');
  const fce = validOrders.filter(order => order.invoiceType === 'Factura de crédito electrónica');

  const totalFE = fe.reduce((sum, order) => sum + order.totalAmount, 0);
  const totalFCE = fce.reduce((sum, order) => sum + order.totalAmount, 0);

  doc.setFillColor(79, 70, 229); // índigo
  doc.roundedRect(14, 12, 182, 24, 3, 3, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.text('Resumen de facturación', 20, 24);

  doc.setFontSize(10);
  doc.text('Analizador de HES', 20, 31);

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  doc.text(`Fecha de generación: ${getTodayFormatted()}`, 14, 42);

  autoTable(doc, {
    startY: 48,
    head: [['Concepto', 'Valor']],
    body: [
      ['Cantidad de Facturas Electrónicas', fe.length],
      ['Importe total de Facturas Electrónicas', formatAR(totalFE)],
      ['Cantidad de Facturas de Crédito Electrónicas', fce.length],
      ['Importe total de Facturas de Crédito Electrónicas', formatAR(totalFCE)],
      ['Total de Pedidos Procesados', orders.length],
      ['Pedidos válidos para descarga', validOrders.length],
      ['Pedidos bloqueados / con errores', blockedOrders.length],
      ['Importe Total General válido', formatAR(totalFE + totalFCE)]
    ],
    theme: 'grid',
    headStyles: {
      fillColor: [79, 70, 229],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center'
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    columnStyles: {
      1: { halign: 'right' }
    },
    styles: {
      fontStyle: 'bold',
      fontSize: 10,
      cellPadding: 3,
      textColor: [51, 65, 85],
      lineColor: [226, 232, 240],
      lineWidth: 0.2
    }
  });

  if (blockedOrders.length > 0) {
    doc.setFontSize(13);
    doc.setTextColor(192, 57, 43);
    doc.text('Pedidos bloqueados y motivo', 14, (doc as any).lastAutoTable.finalY + 8);
    const blockedRows = blockedOrders.map(order => [
      order.orderId,
      getBlockingReason(order)
    ]);

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 12,
      head: [['Pedido bloqueado', 'Motivo']],
      body: blockedRows,
      theme: 'grid',
      headStyles: {
        fillColor: [220, 38, 38],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center'
      },
      alternateRowStyles: {
        fillColor: [254, 242, 242]
      },
      styles: {
        fontSize: 9,
        cellPadding: 3,
        textColor: [68, 64, 60],
        lineColor: [254, 202, 202],
        lineWidth: 0.2
      },
      columnStyles: {
        0: { cellWidth: 45 },
        1: { cellWidth: 130 }
      }});
  }

  doc.save('Reporte_Control_Facturacion.pdf');
};
