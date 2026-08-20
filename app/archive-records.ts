export type InvoiceArchiveRecord = {
  id: string;
  importedAt: string;
  invoiceDate?: string;
  originalName: string;
  generatedName: string;
  source: string;
  number: string;
  amount: string;
  buyerName?: string;
  buyerTaxId?: string;
  sellerName?: string;
  sellerTaxId?: string;
  itemName?: string;
  category: string;
  status: string;
  issues: string[];
};

export type ArchiveFilters = {
  query?: string;
  dateField?: "importedAt" | "invoiceDate";
  from?: string;
  to?: string;
};

const DB_NAME = "flower-invoice-archive";
const STORE_NAME = "records";

function openArchiveDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => void,
) {
  const db = await openArchiveDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    action(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function loadArchiveRecords() {
  const db = await openArchiveDb();
  return new Promise<InvoiceArchiveRecord[]>((resolve, reject) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      db.close();
      resolve((request.result as InvoiceArchiveRecord[]).sort(
        (left, right) => right.importedAt.localeCompare(left.importedAt),
      ));
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export function upsertArchiveRecords(records: InvoiceArchiveRecord[]) {
  return transact("readwrite", (store) => records.forEach((record) => store.put(record)));
}

export function deleteArchiveRecord(id: string) {
  return transact("readwrite", (store) => store.delete(id));
}

export function clearArchiveRecords() {
  return transact("readwrite", (store) => store.clear());
}

export function importArchiveRecords(records: InvoiceArchiveRecord[]) {
  return upsertArchiveRecords(records.filter(
    (record) => Boolean(record.id && record.importedAt && record.originalName),
  ));
}

export function filterArchiveRecords(
  records: InvoiceArchiveRecord[],
  filters: ArchiveFilters,
) {
  const query = (filters.query ?? "").trim().toLocaleLowerCase("zh-CN");
  const field = filters.dateField ?? "invoiceDate";
  return records.filter((record) => {
    const searchable = [
      record.originalName, record.generatedName, record.source, record.number,
      record.amount, record.buyerName, record.buyerTaxId, record.sellerName,
      record.sellerTaxId, record.itemName, record.category, ...record.issues,
    ].join(" ").toLocaleLowerCase("zh-CN");
    if (query && !searchable.includes(query)) return false;

    const value = record[field] ?? "";
    if (field === "importedAt") {
      const valueTime = Date.parse(value);
      const fromTime = filters.from ? Date.parse(filters.from) : Number.NEGATIVE_INFINITY;
      const toTime = filters.to ? Date.parse(filters.to) : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(valueTime) || valueTime < fromTime || valueTime > toTime) return false;
    } else {
      if (filters.from && (!value || value < filters.from)) return false;
      if (filters.to && (!value || value > filters.to)) return false;
    }
    return true;
  });
}
