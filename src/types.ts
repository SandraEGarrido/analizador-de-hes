export interface HESRecord {
  Contrato: string | number;
  'N° Pedido': string | number;
  'N° Viaje': string | number;
  Provincia: string;
  'N° HES': string | number;
  'Fecha HES': string | number;
  'Importar HES': number;
}

export interface DuplicateInfo {
  hesNumber: string | number;
  type: 'internal' | 'external';
  otherOrderId?: string;
}

export interface OrderGroup {
  orderId: string;
  records: HESRecord[];
  totalAmount: number;
  hesCount: number;
  invoiceType: 'Factura electrónica' | 'Factura de crédito electrónica';
  invoiceNumber: string;
  isDuplicate: boolean;
  hasExcessiveHES: boolean;
  duplicates: DuplicateInfo[];
}

export interface BilledOrder {
  orderId: string;
}
