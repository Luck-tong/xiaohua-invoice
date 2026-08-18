"use client";

import {
  ChangeEvent,
  DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  classifyInvoice,
  INVOICE_CATEGORIES,
  recognizeInvoice,
  unpackInvoiceZip,
} from "./invoice-recognition";
import type { InvoiceCategory } from "./invoice-recognition";
import { filterFilesByCategories } from "./category-selection";
import { summarizeInvoiceAmounts } from "./invoice-amount-summary";
import { buildInvoiceNames } from "./invoice-naming";
import {
  completedInvoiceFilterCategory,
  invoiceNamePrefix,
  isDownloadableInvoice,
} from "./invoice-readiness";
import { createTaskQueue } from "./task-queue";

type FileStatus =
  | "queued"
  | "unzipping"
  | "reading"
  | "ocr"
  | "ready"
  | "review"
  | "error";

type InvoiceFile = {
  id: string;
  file: File;
  number: string;
  amount: string;
  category: InvoiceCategory;
  status: FileStatus;
  progress: number;
  method?: "pdf-text" | "ocr";
  source?: string;
  errorMessage?: string;
};

type HistoryEntry = {
  id: string;
  createdAt: string;
  files: string[];
  location?: string;
  action?: "save" | "zip" | "excel" | "merge";
};

type PreviewDialog = {
  title: string;
  items: InvoiceFile[];
  mode: "single" | "duplicates" | "amounts";
  activeId?: string;
  duplicateKey?: string;
  showGeneratedNames?: boolean;
  categoryFilter?: string;
};

const HISTORY_KEY = "piaoli-download-history";

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

function isZipFile(file: File) {
  return /\.zip$/i.test(file.name);
}

function fileType(file: File) {
  const extension = extensionOf(file.name).replace(".", "").toUpperCase();
  return extension === "JPEG" ? "JPG" : extension || "FILE";
}

function readHints(name: string) {
  const number = name.match(/(?:^|\D)(\d{20})(?:\D|$)/)?.[1] ?? "";
  const amount =
    name.match(/[（(](\d+(?:\.\d{1,2})?)[）)]/)?.[1] ??
    name.match(/-(\d+(?:\.\d{1,2})?)元(?:-|】)/)?.[1] ??
    "";

  return { number, amount: amount.replace(/\.?0+$/, "") };
}

function renamedFile(item: InvoiceFile) {
  const prefix = invoiceNamePrefix(item);
  if (!prefix || !item.amount) return "等待识别后生成";
  return `${prefix}（${item.amount}）${extensionOf(item.file.name)}`;
}

function invoiceDuplicateKey(item: InvoiceFile) {
  if (!item.number || !item.amount) return "";
  const amount = Number(item.amount);
  return `${item.number}::${Number.isFinite(amount) ? amount.toFixed(2) : item.amount}`;
}

function incompleteReason(item: InvoiceFile) {
  if (["queued", "unzipping", "reading", "ocr"].includes(item.status)) {
    return statusText(item);
  }
  if (item.status === "error") {
    return `处理失败：${item.errorMessage || "无法读取该文件"}`;
  }
  if (
    ["微信截图发票", "支付宝图片"].includes(item.category) &&
    !item.amount
  ) return "缺少交易金额";
  if (!item.number && !item.amount) return "缺少发票号码和金额";
  if (!item.number) return "缺少发票号码";
  if (!item.amount) return "缺少发票金额";
  return "需要人工核对";
}

async function availableName(
  directory: FileSystemDirectoryHandle,
  desired: string,
) {
  const extension = extensionOf(desired);
  const stem = extension ? desired.slice(0, -extension.length) : desired;

  for (let index = 1; index < 1000; index += 1) {
    const candidate =
      index === 1 ? desired : `${stem}（${index}）${extension}`;
    try {
      await directory.getFileHandle(candidate);
    } catch (error) {
      if ((error as { name?: string }).name === "NotFoundError") {
        return candidate;
      }
      throw error;
    }
  }

  return `${stem}（${Date.now()}）${extension}`;
}

function uniqueArchiveName(name: string, usedNames: Map<string, number>) {
  const count = usedNames.get(name) ?? 0;
  usedNames.set(name, count + 1);
  if (count === 0) return name;

  const extension = extensionOf(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  return `${stem}（${count + 1}）${extension}`;
}

function statusText(item: InvoiceFile) {
  if (item.status === "unzipping") return "正在解压";
  if (item.status === "reading") return `读取PDF ${item.progress}%`;
  if (item.status === "ocr") return `OCR识别 ${item.progress}%`;
  if (item.status === "ready") return "识别完成";
  if (item.status === "review") return "需要核对";
  if (item.status === "error") return `失败：${item.errorMessage || "未知错误"}`;
  return "排队中";
}

function recognitionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/password|encrypted/i.test(message)) return "PDF已加密，请先解除密码";
  if (/invalid pdf|bad xref|format/i.test(message)) return "PDF文件损坏或格式异常";
  if (/memory|allocation|out of memory/i.test(message)) return "浏览器内存不足";
  return message.trim().slice(0, 80) || "无法读取该文件";
}

function InvoiceDocumentPreview({ item }: { item: InvoiceFile }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    const nextUrl = URL.createObjectURL(item.file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [item]);

  if (!url) return <div className="invoice-preview-loading">正在打开原票…</div>;
  if (/\.pdf$/i.test(item.file.name)) {
    return <iframe src={url} title={`查看 ${item.file.name}`} />;
  }
  return <img src={url} alt={item.file.name} />;
}

function formatHistoryTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function historyActionText(entry: HistoryEntry) {
  if (entry.action === "zip") return `打包了 ${entry.files.length} 份发票`;
  if (entry.action === "excel") return `导出了 ${entry.files.length} 条台账`;
  if (entry.action === "merge") return `合并了 ${entry.files.length} 份 PDF`;
  return `保存了 ${entry.files.length} 份发票`;
}

export default function Home() {
  const [files, setFiles] = useState<InvoiceFile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busyAction, setBusyAction] = useState<
    "folder" | "zip" | "excel" | "merge" | null
  >(null);
  const [saveNotice, setSaveNotice] = useState("");
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderCategories, setFolderCategories] = useState<Set<string>>(
    () => new Set(),
  );
  const [previewDialog, setPreviewDialog] = useState<PreviewDialog | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const processingQueueRef = useRef(createTaskQueue(3));

  const invoiceFiles = useMemo(
    () => files.filter((item) => !isZipFile(item.file)),
    [files],
  );

  const downloadableFiles = useMemo(
    () => invoiceFiles.filter(isDownloadableInvoice),
    [invoiceFiles],
  );

  const incompleteFiles = useMemo(
    () => invoiceFiles.filter((item) => !isDownloadableInvoice(item)),
    [invoiceFiles],
  );

  const errorFiles = incompleteFiles;

  const selectedReadyFiles = useMemo(
    () => downloadableFiles.filter((item) => selectedIds.has(item.id)),
    [downloadableFiles, selectedIds],
  );

  const selectedPdfFiles = useMemo(
    () => selectedReadyFiles.filter((item) => /\.pdf$/i.test(item.file.name)),
    [selectedReadyFiles],
  );

  const groupedInvoiceFiles = useMemo(
    () => {
      const groups = new Map<InvoiceCategory, InvoiceFile[]>();
      invoiceFiles.forEach((item) => {
        groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
      });
      return [...groups].map(([category, groupFiles]) => ({
        category,
        files: groupFiles,
      }));
    },
    [invoiceFiles],
  );

  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    invoiceFiles.forEach((item) => {
      const key = invoiceDuplicateKey(item);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([number]) => number),
    );
  }, [invoiceFiles]);

  const duplicateGroups = useMemo(
    () =>
      [...duplicateKeys].map((key) => ({
        key,
        items: invoiceFiles.filter((item) => invoiceDuplicateKey(item) === key),
      })),
    [duplicateKeys, invoiceFiles],
  );
  const duplicateFileCount = useMemo(
    () => duplicateGroups.reduce((total, group) => total + group.items.length, 0),
    [duplicateGroups],
  );

  const generatedNames = useMemo(() => {
    return buildInvoiceNames(
      downloadableFiles.map((item) => ({
        id: item.id,
        number: invoiceNamePrefix(item),
        amount: item.amount,
        fileName: item.file.name,
      })),
    );
  }, [downloadableFiles]);

  function generatedName(item: InvoiceFile) {
    return generatedNames.get(item.id) || renamedFile(item);
  }

  const historyNumbers = useMemo(() => {
    const numbers = new Set<string>();
    history.forEach((entry) =>
      entry.files.forEach((name) => {
        const number = name.match(/^\d{20}/)?.[0];
        if (number) numbers.add(number);
      }),
    );
    return numbers;
  }, [history]);

  const selectedAmountTotal = useMemo(
    () =>
      selectedReadyFiles
        .reduce((total, item) => total + (Number(item.amount) || 0), 0)
        .toFixed(2),
    [selectedReadyFiles],
  );

  const allReadySelected =
    downloadableFiles.length > 0 &&
    downloadableFiles.every((item) => selectedIds.has(item.id));

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(HISTORY_KEY);
      // Local history only exists after the browser has mounted.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setHistory(JSON.parse(saved) as HistoryEntry[]);
    } catch {
      setHistory([]);
    }
  }, []);

  function saveHistory(entries: HistoryEntry[]) {
    setHistory(entries);
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    } catch {
      // The download still succeeds if the browser blocks local history.
    }
  }

  function clearHistory() {
    if (!window.confirm("确定清空当前浏览器中的全部处理日志吗？")) return;
    setHistory([]);
    window.localStorage.removeItem(HISTORY_KEY);
  }

  function updateItem(id: string, patch: Partial<InvoiceFile>) {
    setFiles((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function createItem(file: File, source?: string): InvoiceFile {
    return {
      id: crypto.randomUUID(),
      file,
      ...readHints(file.name),
      category: classifyInvoice("", file.name),
      status: "queued",
      progress: 0,
      source,
    };
  }

  function processItem(item: InvoiceFile) {
    processingQueueRef.current.add(async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        updateItem(item.id, {
          status: "reading",
          progress: 1,
          errorMessage: undefined,
        });
        try {
          const result = await recognizeInvoice(item.file, (progress, stage) => {
            updateItem(item.id, {
              status: stage,
              progress: Math.max(1, Math.min(100, progress)),
            });
          });
          const number = result.number || item.number;
          const amount = result.amount || item.amount;
          updateItem(item.id, {
            number,
            amount,
            category: result.category,
            method: result.method,
            progress: 100,
            status: isDownloadableInvoice({
              number,
              amount,
              category: result.category,
            }) ? "ready" : "review",
          });
          return;
        } catch (error) {
          if (attempt === 1) {
            updateItem(item.id, {
              status: "error",
              progress: 0,
              errorMessage: recognitionErrorMessage(error),
            });
          }
        }
      }
    });
  }

  function processZip(item: InvoiceFile) {
    updateItem(item.id, { status: "unzipping", progress: 1 });
    unpackInvoiceZip(item.file)
      .then((extracted) => {
        if (extracted.length === 0) {
          updateItem(item.id, { status: "error", progress: 0 });
          return;
        }

        const children = extracted.map(({ file, sourcePath }) =>
          createItem(
            file,
            sourcePath ? `${item.file.name} › ${sourcePath}` : item.file.name,
          ),
        );
        setFiles((current) => {
          const index = current.findIndex((candidate) => candidate.id === item.id);
          if (index < 0) return current;
          const next = [...current];
          next.splice(index, 1, ...children);
          return next;
        });
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          children.forEach((child) => next.add(child.id));
          return next;
        });
        children.forEach(processItem);
      })
      .catch(() => {
        updateItem(item.id, { status: "error", progress: 0 });
      });
  }

  function addFiles(list: FileList | File[]) {
    const accepted = Array.from(list).filter((file) =>
      /(\.pdf|\.png|\.jpe?g|\.webp|\.zip)$/i.test(file.name),
    );
    const items = accepted.map((file) => createItem(file));

    setFiles((current) => [...current, ...items]);
    setSelectedIds((current) => {
      const next = new Set(current);
      items
        .filter((item) => !isZipFile(item.file))
        .forEach((item) => next.add(item.id));
      return next;
    });
    items.forEach((item) => {
      if (isZipFile(item.file)) processZip(item);
      else processItem(item);
    });
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  function updateFile(id: string, field: "number" | "amount", value: string) {
    const cleaned =
      field === "number" ? value.replace(/\D/g, "") : value.replace(/[^\d.]/g, "");
    setFiles((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              [field]: cleaned,
              status:
                (field === "number" ? cleaned : item.number) &&
                (field === "amount" ? cleaned : item.amount)
                  ? "ready"
                  : "review",
            }
          : item,
      ),
    );
  }

  function updateCategory(id: string, category: InvoiceCategory) {
    updateItem(id, { category });
  }

  function removeFile(id: string) {
    setFiles((current) => current.filter((item) => item.id !== id));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  function clearFiles() {
    setFiles([]);
    setSelectedIds(new Set());
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllReady() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allReadySelected) {
        downloadableFiles.forEach((item) => next.delete(item.id));
      } else {
        downloadableFiles.forEach((item) => next.add(item.id));
      }
      return next;
    });
  }

  function openFolderDialog() {
    setFolderCategories(
      new Set(downloadableFiles.map((item) => item.category)),
    );
    setFolderDialogOpen(true);
  }

  function toggleFolderCategory(category: string) {
    setFolderCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  async function saveFilesToFolder(ready: InvoiceFile[]) {
    if (ready.length === 0) return;

    if (!window.showDirectoryPicker) {
      setBusyAction("folder");
      setSaveNotice("");
      const usedNames = new Map<string, number>();
      const savedNames = ready.map((item) =>
        uniqueArchiveName(generatedName(item), usedNames),
      );

      ready.forEach((item, index) => {
        const url = URL.createObjectURL(item.file);
        const link = document.createElement("a");
        link.href = url;
        link.download = savedNames[index];
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      });

      const entry: HistoryEntry = {
        id: `${Date.now()}-${Math.random()}`,
        createdAt: new Date().toISOString(),
        files: savedNames,
        location: "浏览器默认下载位置",
        action: "save",
      };
      saveHistory([entry, ...history]);
      setSaveNotice(`已发送 ${savedNames.length} 份发票到浏览器下载。`);
      setBusyAction(null);
      return;
    }

    setBusyAction("folder");
    setSaveNotice("");
    try {
      const directory = await window.showDirectoryPicker({ mode: "readwrite" });
      const savedNames: string[] = [];

      for (const item of ready) {
        const name = await availableName(directory, generatedName(item));
        const handle = await directory.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(item.file);
        await writable.close();
        savedNames.push(name);
      }

      const entry: HistoryEntry = {
        id: `${Date.now()}-${Math.random()}`,
        createdAt: new Date().toISOString(),
        files: savedNames,
        location: directory.name,
        action: "save",
      };
      saveHistory([entry, ...history]);
      setSaveNotice(`已保存 ${savedNames.length} 份发票到“${directory.name}”文件夹。`);
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") {
        setSaveNotice("保存失败，请重新选择一个可写入的文件夹。");
      }
    } finally {
      setBusyAction(null);
    }
  }

  function confirmFolderCategories() {
    const ready = filterFilesByCategories(downloadableFiles, folderCategories);
    if (ready.length === 0) return;
    setFolderDialogOpen(false);
    void saveFilesToFolder(ready);
  }

  async function downloadSelectedZip() {
    const ready = selectedReadyFiles;
    if (ready.length < 2) {
      setSaveNotice("请至少勾选 2 份发票再打包 ZIP。");
      return;
    }

    setBusyAction("zip");
    setSaveNotice("");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const usedNames = new Map<string, number>();
      const savedNames = ready.map((item) =>
        uniqueArchiveName(generatedName(item), usedNames),
      );

      ready.forEach((item, index) => {
        zip.file(savedNames[index], item.file);
      });

      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
      });
      downloadBlob(blob, `已选发票（${ready.length}份）.zip`);

      const entry: HistoryEntry = {
        id: `${Date.now()}-${Math.random()}`,
        createdAt: new Date().toISOString(),
        files: savedNames,
        location: "ZIP下载（浏览器默认下载位置）",
        action: "zip",
      };
      saveHistory([entry, ...history]);
      setSaveNotice(`已将 ${ready.length} 份发票打包为 ZIP。`);
    } catch {
      setSaveNotice("ZIP 打包失败，请重试。");
    } finally {
      setBusyAction(null);
    }
  }

  async function exportSelectedExcel() {
    const ready = selectedReadyFiles;
    if (ready.length === 0) return;

    setBusyAction("excel");
    setSaveNotice("");
    try {
      const XLSX = await import("xlsx");
      const rows: Array<Record<string, string | number>> = ready.map((item, index) => ({
        序号: index + 1,
        发票分类: item.category,
        发票号码: item.number,
        发票金额: Number(item.amount),
        原文件名: item.file.name,
        新文件名: generatedName(item),
        识别方式: item.method === "ocr" ? "OCR识别" : "PDF文字读取",
        重复提醒: duplicateKeys.has(invoiceDuplicateKey(item))
          ? "本批次号码重复"
          : historyNumbers.has(item.number)
            ? "历史记录中已处理"
            : "",
      }));
      rows.push({
        序号: "",
        发票分类: "",
        发票号码: "合计",
        发票金额: Number(selectedAmountTotal),
        原文件名: "",
        新文件名: "",
        识别方式: "",
        重复提醒: "",
      });
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = [
        { wch: 8 },
        { wch: 14 },
        { wch: 24 },
        { wch: 14 },
        { wch: 42 },
        { wch: 36 },
        { wch: 16 },
        { wch: 22 },
      ];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "发票台账");
      const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      downloadBlob(
        new Blob([data], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `发票台账（${ready.length}份）.xlsx`,
      );

      const entry: HistoryEntry = {
        id: `${Date.now()}-${Math.random()}`,
        createdAt: new Date().toISOString(),
        files: ready.map(renamedFile),
        location: "Excel下载（浏览器默认下载位置）",
        action: "excel",
      };
      saveHistory([entry, ...history]);
      setSaveNotice(`已导出 ${ready.length} 条发票记录，合计 ¥${selectedAmountTotal}。`);
    } catch {
      setSaveNotice("Excel 导出失败，请重试。");
    } finally {
      setBusyAction(null);
    }
  }

  async function mergeSelectedPdfs() {
    const ready = selectedPdfFiles;
    if (ready.length < 2) {
      setSaveNotice("请至少勾选 2 份 PDF 发票再合并。");
      return;
    }

    setBusyAction("merge");
    setSaveNotice("");
    try {
      const { PDFDocument } = await import("pdf-lib");
      const merged = await PDFDocument.create();
      for (const item of ready) {
        const source = await PDFDocument.load(await item.file.arrayBuffer());
        const pages = await merged.copyPages(source, source.getPageIndices());
        pages.forEach((page) => merged.addPage(page));
      }
      const bytes = await merged.save();
      downloadBlob(
        new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        `合并发票（${ready.length}份）.pdf`,
      );

      const entry: HistoryEntry = {
        id: `${Date.now()}-${Math.random()}`,
        createdAt: new Date().toISOString(),
        files: ready.map(renamedFile),
        location: "合并PDF（浏览器默认下载位置）",
        action: "merge",
      };
      saveHistory([entry, ...history]);
      setSaveNotice(`已按当前顺序合并 ${ready.length} 份 PDF。`);
    } catch {
      setSaveNotice("PDF 合并失败，请确认文件未加密或损坏。");
    } finally {
      setBusyAction(null);
    }
  }

  const showPreviewSelectors = Boolean(
    previewDialog?.showGeneratedNames &&
    (previewDialog.mode === "single" || previewDialog.mode === "amounts"),
  );
  const previewCategories = showPreviewSelectors && previewDialog
    ? [...new Set(previewDialog.items.map(completedInvoiceFilterCategory))].sort(
        (left, right) => left.localeCompare(right, "zh-CN"),
      )
    : [];
  const filteredPreviewItems = showPreviewSelectors && previewDialog?.categoryFilter
    ? previewDialog.items.filter(
        (item) => completedInvoiceFilterCategory(item) === previewDialog.categoryFilter,
      )
    : previewDialog?.items ?? [];
  const activePreviewItem = filteredPreviewItems.find(
    (item) => item.id === previewDialog?.activeId,
  ) ?? filteredPreviewItems[0];
  const previewDuplicateKeys = previewDialog?.mode === "duplicates"
    ? [...new Set(previewDialog.items.map(invoiceDuplicateKey))]
    : [];
  const comparedPreviewItems = previewDialog?.mode === "duplicates"
    ? previewDialog.items.filter(
        (item) => invoiceDuplicateKey(item) === previewDialog.duplicateKey,
      )
    : [];
  const amountPreviewSummary = summarizeInvoiceAmounts(
    previewDialog?.mode === "amounts" ? filteredPreviewItems : [],
  );

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#" aria-label="花签首页">
          <span className="brand-mark">花</span>
          <span>花签</span>
        </a>
        <nav aria-label="主导航">
          <a href="#tool">工作台</a>
          <a href="#results">核对结果</a>
          <a href="#history">处理记录</a>
          <a href="#help">使用帮助</a>
        </nav>
        <div className="header-actions">
          <a className="header-action start-action" href="#tool">
            开始处理
            <span>→</span>
          </a>
          <a className="header-action save-action" href="#save-actions">
            保存下载
            <span>↓</span>
          </a>
        </div>
      </header>

      <section className="workspace-shell">
        <div className="workspace-main">

      <section className="hero" id="tool">
        <h1 className="hero-wordmark">Flower</h1>
        <p>
          读取发票号码与价税合计，一次完成多份文件整理。
          <br />
          不用逐张打开，也不用复制粘贴。
        </p>

        <div
          className={`upload-panel ${files.length ? "has-files" : ""} ${
            dragging ? "dragging" : ""
          }`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setDragging(false);
          }}
          onDrop={handleDrop}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp,.zip"
            onChange={handleInput}
          />
          {files.length === 0 ? (
            <>
              <div className="upload-symbol" aria-hidden="true">
                <span className="paper paper-back" />
                <span className="paper paper-front">↑</span>
              </div>
              <h2>拖放发票到这里</h2>
              <p>可同时选择多份PDF、图片或ZIP压缩包</p>
              <button
                className="select-button"
                onClick={() => inputRef.current?.click()}
              >
                选择发票文件
              </button>
              <div className="upload-meta">
                <span>支持 PDF、JPG、PNG、WEBP、ZIP</span>
                <span className="meta-divider" />
                <span>文件不会上传</span>
              </div>
            </>
          ) : (
            <>
              <div className="queue-header">
                <div>
                  <span>已放入</span>
                  <h2>{files.length} 个文件</h2>
                </div>
                <div className="queue-actions">
                  <button onClick={() => inputRef.current?.click()}>＋ 继续添加</button>
                  <button onClick={clearFiles}>清空</button>
                </div>
              </div>
              <div className="upload-queue">
                {files.map((item) => {
                  const zip = isZipFile(item.file);
                  return (
                    <div className="queue-item" key={`queue-${item.id}`}>
                      <span className={`type-badge ${zip ? "zip" : ""}`}>
                        {fileType(item.file)}
                      </span>
                      <div className="queue-file">
                        <strong title={item.file.name}>{item.file.name}</strong>
                        <span>
                          {formatSize(item.file.size)}
                          {item.source ? ` · 来自 ${item.source}` : ""}
                        </span>
                      </div>
                      <span
                        className={`queue-status ${item.status}`}
                        title={item.errorMessage}
                      >
                        <i />
                        {statusText(item)}
                      </span>
                      <button
                        className="queue-remove"
                        onClick={() => removeFile(item.id)}
                        aria-label={`移除 ${item.file.name}`}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="queue-footer">
                <span>还可以继续拖入文件</span>
                <span>PDF · 图片 · ZIP</span>
              </div>
            </>
          )}
        </div>

      </section>

      {invoiceFiles.length > 0 && (
        <section className="results-section" id="results" aria-label="发票处理结果">
          <div className="section-heading result-heading">
            <div>
              <span className="kicker">识别记录</span>
              <h2>核对处理结果</h2>
              <p>号码或金额不准确时，可以直接在下方修改。</p>
            </div>
            <div className="result-tools">
              <label className="select-all">
                <input
                  type="checkbox"
                  checked={allReadySelected}
                  onChange={toggleAllReady}
                  disabled={downloadableFiles.length === 0}
                />
                <span>全选可下载发票</span>
              </label>
              <span className="selected-summary">
                已选 {selectedReadyFiles.length}/{downloadableFiles.length}
              </span>
              <button className="text-button" onClick={clearFiles}>
                清空全部
              </button>
            </div>
          </div>

          <div className="file-groups">
            {groupedInvoiceFiles.map((group) => {
              const groupAmount = group.files
                .reduce((total, item) => total + (Number(item.amount) || 0), 0)
                .toFixed(2);
              return (
                <section className="category-group" key={group.category}>
                  <div className="category-heading">
                    <div>
                      <span className="category-mark">{group.category.slice(0, 1)}</span>
                      <div>
                        <h3>{group.category}</h3>
                        <small>{group.files.length} 份发票</small>
                      </div>
                    </div>
                    <strong>¥{groupAmount}</strong>
                  </div>
                  <div className="file-list">
                    {group.files.map((item) => {
                      const index = invoiceFiles.findIndex(
                        (candidate) => candidate.id === item.id,
                      );
                      const isReady = Boolean(item.number && item.amount);
                      const processing =
                        item.status === "reading" || item.status === "ocr";
                      const duplicateInBatch = duplicateKeys.has(
                        invoiceDuplicateKey(item),
                      );
                      const duplicateInHistory =
                        Boolean(item.number) && historyNumbers.has(item.number);
                      return (
                        <article
                          className={`file-card ${duplicateInBatch ? "duplicate" : ""}`}
                          key={item.id}
                        >
                          <label className="file-selector">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              onChange={() => toggleSelected(item.id)}
                              disabled={!isReady}
                              aria-label={`选择 ${item.file.name}`}
                            />
                            <span>{index + 1}</span>
                          </label>
                          <div className="file-main">
                            <div className="file-name">
                              <strong title={item.file.name}>{item.file.name}</strong>
                              <div className="file-origin-actions">
                                <span>
                                  {item.method === "pdf-text"
                                    ? "PDF文字读取"
                                    : item.method === "ocr"
                                      ? "OCR识别"
                                      : statusText(item)}
                                  {" · "}
                                  {formatSize(item.file.size)}
                                  {" · 来源："}
                                  {item.source || "直接添加"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreviewDialog({
                                      title: "查看发票原件",
                                      items: [item],
                                      mode: "single",
                                      activeId: item.id,
                                    })
                                  }
                                >
                                  查看原票
                                </button>
                              </div>
                            </div>
                            {(duplicateInBatch || duplicateInHistory) && (
                              <div className="duplicate-alert" role="status">
                                <span>!</span>
                                {duplicateInBatch
                                  ? "本批次发现相同发票号码，请核对是否重复上传。"
                                  : "这个发票号码在当前浏览器的处理日志中出现过。"}
                              </div>
                            )}
                            <div className="field-grid">
                              <label>
                                发票号码
                                <input
                                  inputMode="numeric"
                                  placeholder="等待识别或手动输入"
                                  value={item.number}
                                  onChange={(event) =>
                                    updateFile(item.id, "number", event.target.value)
                                  }
                                />
                              </label>
                              <label>
                                发票金额
                                <div className="amount-input">
                                  <span>¥</span>
                                  <input
                                    inputMode="decimal"
                                    placeholder="0.00"
                                    value={item.amount}
                                    onChange={(event) =>
                                      updateFile(item.id, "amount", event.target.value)
                                    }
                                  />
                                </div>
                              </label>
                              <label>
                                发票分类
                                <select
                                  value={item.category}
                                  onChange={(event) =>
                                    updateCategory(
                                      item.id,
                                      event.target.value as InvoiceCategory,
                                    )
                                  }
                                >
                                  {!INVOICE_CATEGORIES.includes(
                                    item.category as (typeof INVOICE_CATEGORIES)[number],
                                  ) && (
                                    <option value={item.category}>{item.category}</option>
                                  )}
                                  {INVOICE_CATEGORIES.map((category) => (
                                    <option key={category} value={category}>
                                      {category}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <div
                              className={`rename-result ${isReady ? "ready" : ""} ${
                                processing ? "processing" : ""
                              }`}
                            >
                              <span>
                                {processing
                                  ? "正在处理"
                                  : isReady
                                    ? "生成文件名"
                                    : "还需补充"}
                              </span>
                              <strong>
                                {processing
                                  ? statusText(item)
                                  : isReady
                                    ? generatedName(item)
                                    : incompleteReason(item)}
                              </strong>
                            </div>
                          </div>
                          <button
                            className="remove-button"
                            onClick={() => removeFile(item.id)}
                            aria-label={`移除 ${item.file.name}`}
                          >
                            ×
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>

        </section>
      )}

        </div>

        <aside className="batch-sidebar" id="batch-actions" aria-label="当前批次操作">
          <div className="batch-panel">
            <div className="batch-heading">
              <div><span className="status-dot" />当前批次</div>
              <small>{invoiceFiles.length ? `${invoiceFiles.length} 份文件` : "等待添加文件"}</small>
            </div>
            <div className="batch-stats">
              <button
                type="button"
                disabled={downloadableFiles.length === 0}
                onClick={() =>
                  setPreviewDialog({
                    title: "查看已识别发票",
                    items: downloadableFiles,
                    mode: "single",
                    activeId: downloadableFiles[0]?.id,
                  })
                }
              ><span>已识别 · 点击查看</span><strong>{downloadableFiles.length}</strong></button>
              <button
                type="button"
                className={incompleteFiles.length ? "incomplete-stat" : ""}
                disabled={incompleteFiles.length === 0}
                onClick={() =>
                  setPreviewDialog({
                    title: "查看未完成发票",
                    items: incompleteFiles,
                    mode: "single",
                    activeId: incompleteFiles[0]?.id,
                  })
                }
              ><span>未完成 · 点击查看</span><strong>{incompleteFiles.length}</strong></button>
              <button
                type="button"
                disabled={selectedReadyFiles.length === 0}
                onClick={() =>
                  setPreviewDialog({
                    title: "查看已勾选发票",
                    items: selectedReadyFiles,
                    mode: "single",
                    activeId: selectedReadyFiles[0]?.id,
                  })
                }
              ><span>已勾选 · 点击查看</span><strong>{selectedReadyFiles.length}</strong></button>
              <button
                type="button"
                className="completed-stat"
                disabled={downloadableFiles.length === 0}
                onClick={() => {
                  const completedByCategory = [...downloadableFiles].sort((left, right) =>
                    left.category.localeCompare(right.category, "zh-CN"),
                  );
                  setPreviewDialog({
                    title: "已完成发票 · 按分类查看",
                    items: completedByCategory,
                    mode: "single",
                    activeId: completedByCategory[0]?.id,
                    showGeneratedNames: true,
                  });
                }}
              ><span>已完成 · 查看分类</span><strong>{downloadableFiles.length}</strong></button>
              <button
                type="button"
                className="amount-stat"
                disabled={selectedReadyFiles.length === 0}
                onClick={() =>
                  setPreviewDialog({
                    title: "已选金额 · 金额排行",
                    items: selectedReadyFiles,
                    mode: "amounts",
                    activeId: selectedReadyFiles[0]?.id,
                    showGeneratedNames: true,
                  })
                }
              ><span>已选金额 · 点击查看</span><strong>¥{selectedAmountTotal}</strong></button>
              <button
                type="button"
                className={duplicateKeys.size ? "warning-stat" : ""}
                disabled={duplicateKeys.size === 0}
                onClick={() =>
                  setPreviewDialog({
                    title: "重复发票对比",
                    items: duplicateGroups.flatMap((group) => group.items),
                    mode: "duplicates",
                    duplicateKey: duplicateGroups[0]?.key,
                  })
                }
              >
                <span>重复组数 · 已含在识别数中</span>
                <strong>{duplicateKeys.size} 组</strong>
                <small>涉及 {duplicateFileCount} 份 · 点击对比</small>
              </button>
              <button
                type="button"
                className={errorFiles.length ? "error-stat" : ""}
                disabled={errorFiles.length === 0}
                onClick={() =>
                  setPreviewDialog({
                    title: "查看错误与未完成发票",
                    items: errorFiles,
                    mode: "single",
                    activeId: errorFiles[0]?.id,
                  })
                }
              >
                <span>错误组数 · 不含在已识别中</span>
                <strong>{errorFiles.length} 组</strong>
                <small>属于未完成 · 点击查看原因</small>
              </button>
            </div>
            {groupedInvoiceFiles.length > 0 && (
              <div className="category-summary" aria-label="发票分类汇总">
                <span>分类汇总</span>
                <div>
                  {groupedInvoiceFiles.map((group) => (
                    <button
                      type="button"
                      key={group.category}
                      onClick={() =>
                        setPreviewDialog({
                          title: group.category,
                          items: group.files,
                          mode: "single",
                          activeId: group.files[0]?.id,
                        })
                      }
                    >
                      {group.category}<strong>{group.files.length}</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {duplicateGroups.length > 0 && (
              <div className="duplicate-summary" aria-label="重复发票">
                <span>重复发票</span>
                <div>
                  {duplicateGroups.map((group) => {
                    const item = group.items[0];
                    return (
                      <button
                        type="button"
                        key={group.key}
                        onClick={() =>
                          setPreviewDialog({
                            title: "重复发票对比",
                            items: duplicateGroups.flatMap((entry) => entry.items),
                            mode: "duplicates",
                            duplicateKey: group.key,
                          })
                        }
                      >
                        <span>{item.number}（{item.amount}）</span>
                        <strong>{group.items.length} 份 · 对比</strong>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="batch-notice">
              {saveNotice ||
                (duplicateKeys.size
                  ? "发现重复号码，请先在中间结果区核对。"
                  : "勾选发票后，可在这里统一导出或保存。")}
            </div>
            <div className="batch-actions" id="save-actions">
              <button
                className="download-button"
                disabled={downloadableFiles.length === 0 || busyAction !== null}
                onClick={openFolderDialog}
              >
                {busyAction === "folder" ? "正在保存" : "选择保存文件夹"}<span>→</span>
              </button>
              <button
                className="utility-button"
                disabled={selectedReadyFiles.length === 0 || busyAction !== null}
                onClick={exportSelectedExcel}
              >
                {busyAction === "excel" ? "正在导出" : "导出 Excel 台账"}
              </button>
              <button
                className="utility-button"
                disabled={selectedPdfFiles.length < 2 || busyAction !== null}
                onClick={mergeSelectedPdfs}
              >
                {busyAction === "merge" ? "正在合并" : `合并 PDF${selectedPdfFiles.length ? ` · ${selectedPdfFiles.length}份` : ""}`}
              </button>
              <button
                className="utility-button"
                disabled={selectedReadyFiles.length < 2 || busyAction !== null}
                onClick={downloadSelectedZip}
              >
                {busyAction === "zip" ? "正在打包" : "打包下载 ZIP"}
              </button>
            </div>
          </div>

          <div className="side-history" id="history">
            <div className="side-history-heading">
              <div><span className="kicker">本机日志</span><strong>最近处理</strong></div>
              {history.length > 0 && <button onClick={clearHistory}>清空</button>}
            </div>
            {history.length === 0 ? (
              <p className="side-history-empty">完成第一次下载后，记录会显示在这里。</p>
            ) : (
              <div className="side-history-list">
                {history.slice(0, 6).map((entry) => (
                  <article key={entry.id}>
                    <span>{formatHistoryTime(entry.createdAt)}</span>
                    <strong>{historyActionText(entry)}</strong>
                    {entry.location && <small>{entry.location}</small>}
                  </article>
                ))}
              </div>
            )}
          </div>
        </aside>
      </section>

      {folderDialogOpen && (
        <div
          className="category-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFolderDialogOpen(false);
          }}
        >
          <section
            className="category-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-dialog-title"
          >
            <div className="category-dialog-heading">
              <div>
                <span>分类保存</span>
                <h2 id="category-dialog-title">选择要下载的发票类型</h2>
              </div>
              <button
                type="button"
                aria-label="关闭分类选择"
                onClick={() => setFolderDialogOpen(false)}
              >
                ×
              </button>
            </div>

            <label className="category-dialog-all">
              <input
                type="checkbox"
                checked={
                  groupedInvoiceFiles.length > 0 &&
                  groupedInvoiceFiles.every((group) =>
                    folderCategories.has(group.category),
                  )
                }
                onChange={(event) =>
                  setFolderCategories(
                    event.target.checked
                      ? new Set(groupedInvoiceFiles.map((group) => group.category))
                      : new Set(),
                  )
                }
              />
              <span>全选所有分类</span>
              <strong>{downloadableFiles.length} 份</strong>
            </label>

            <div className="category-dialog-list">
              {groupedInvoiceFiles.map((group) => {
                const readyCount = group.files.filter(
                  (item) => item.number && item.amount,
                ).length;
                if (readyCount === 0) return null;
                return (
                  <label key={group.category}>
                    <input
                      type="checkbox"
                      checked={folderCategories.has(group.category)}
                      onChange={() => toggleFolderCategory(group.category)}
                    />
                    <span>{group.category}</span>
                    <strong>{readyCount} 份</strong>
                  </label>
                );
              })}
            </div>

            <div className="category-dialog-footer">
              <span>
                已选择 {filterFilesByCategories(downloadableFiles, folderCategories).length} 份
              </span>
              <div>
                <button type="button" onClick={() => setFolderDialogOpen(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="confirm"
                  disabled={folderCategories.size === 0}
                  onClick={confirmFolderCategories}
                >
                  选择文件夹并保存
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {previewDialog && (
        <div
          className="invoice-preview-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewDialog(null);
          }}
        >
          <section
            className="invoice-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-preview-title"
          >
            <div className="invoice-preview-heading">
              <div>
                <span>原票核对</span>
                <h2 id="invoice-preview-title">{previewDialog.title}</h2>
              </div>
              {showPreviewSelectors && (
                <div className="invoice-preview-filters">
                  <label className="invoice-preview-filter">
                    <span>分类筛选</span>
                    <select
                      value={previewDialog.categoryFilter ?? ""}
                      onChange={(event) => {
                        const categoryFilter = event.target.value;
                        const firstItem = categoryFilter
                          ? previewDialog.items.find(
                              (item) => completedInvoiceFilterCategory(item) === categoryFilter,
                            )
                          : previewDialog.items[0];
                        setPreviewDialog((current) => current ? {
                          ...current,
                          categoryFilter,
                          activeId: firstItem?.id,
                        } : current);
                      }}
                    >
                      <option value="">全部分类（{previewDialog.items.length}）</option>
                      {previewCategories.map((category) => (
                        <option value={category} key={category}>
                          {category}（{previewDialog.items.filter(
                            (item) => completedInvoiceFilterCategory(item) === category,
                          ).length}）
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="invoice-preview-current-file">
                    <span>当前发票</span>
                    <strong title={activePreviewItem ? generatedName(activePreviewItem) : ""}>
                      {activePreviewItem ? generatedName(activePreviewItem) : "暂无发票"}
                    </strong>
                  </div>
                </div>
              )}
              <button
                type="button"
                aria-label="关闭发票预览"
                onClick={() => setPreviewDialog(null)}
              >×</button>
            </div>

            {previewDialog.mode === "duplicates" ? (
              <>
                <div className="duplicate-number-tabs">
                  {previewDuplicateKeys.map((key) => {
                    const item = previewDialog.items.find(
                      (candidate) => invoiceDuplicateKey(candidate) === key,
                    );
                    return (
                    <button
                      type="button"
                      className={key === previewDialog.duplicateKey ? "active" : ""}
                      key={key}
                      onClick={() =>
                        setPreviewDialog((current) =>
                          current ? { ...current, duplicateKey: key } : current,
                        )
                      }
                    >
                      {item?.number}（{item?.amount}）
                    </button>
                    );
                  })}
                </div>
                <div className="duplicate-preview-grid">
                  {comparedPreviewItems.map((item) => (
                    <article key={item.id}>
                      <div className="invoice-preview-meta">
                        <strong title={item.file.name}>{item.file.name}</strong>
                        <span>来源：{item.source || "直接添加"}</span>
                        {!isDownloadableInvoice(item) && (
                          <span className="incomplete-reason">原因：{incompleteReason(item)}</span>
                        )}
                      </div>
                      <InvoiceDocumentPreview item={item} />
                    </article>
                  ))}
                </div>
              </>
            ) : previewDialog.mode === "amounts" ? (
              <div className="single-preview-layout">
                <div className="invoice-preview-list amount-preview-list">
                  <h3>金额最高 5 份</h3>
                  {amountPreviewSummary.highest.map((item, index) => (
                    <button
                      type="button"
                      className={item.id === activePreviewItem?.id ? "active" : ""}
                      key={`highest-${item.id}`}
                      onClick={() =>
                        setPreviewDialog((current) => current ? { ...current, activeId: item.id } : current)
                      }
                    >
                      <strong>{index + 1}. {generatedName(item)}</strong>
                      <span>{item.category} · ¥{Number(item.amount).toFixed(2)}</span>
                    </button>
                  ))}
                  <h3>金额最低 5 份</h3>
                  {amountPreviewSummary.lowest.map((item, index) => (
                    <button
                      type="button"
                      className={item.id === activePreviewItem?.id ? "active" : ""}
                      key={`lowest-${item.id}`}
                      onClick={() =>
                        setPreviewDialog((current) => current ? { ...current, activeId: item.id } : current)
                      }
                    >
                      <strong>{index + 1}. {generatedName(item)}</strong>
                      <span>{item.category} · ¥{Number(item.amount).toFixed(2)}</span>
                    </button>
                  ))}
                </div>
                <div className="single-preview-document">
                  {activePreviewItem && <InvoiceDocumentPreview item={activePreviewItem} />}
                </div>
              </div>
            ) : (
              <div className="single-preview-layout">
                <div className="invoice-preview-list">
                  {filteredPreviewItems.map((item) => (
                    <button
                      type="button"
                      className={item.id === activePreviewItem?.id ? "active" : ""}
                      key={item.id}
                      onClick={() =>
                        setPreviewDialog((current) =>
                          current ? { ...current, activeId: item.id } : current,
                        )
                      }
                    >
                      <strong title={previewDialog.showGeneratedNames ? generatedName(item) : item.file.name}>
                        {previewDialog.showGeneratedNames ? generatedName(item) : item.file.name}
                      </strong>
                      <span>分类：{item.category}</span>
                      <span>来源：{item.source || "直接添加"}</span>
                      {!isDownloadableInvoice(item) && (
                        <span className="incomplete-reason">原因：{incompleteReason(item)}</span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="single-preview-document">
                  {activePreviewItem && <InvoiceDocumentPreview item={activePreviewItem} />}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      <section className="compact-help" id="help" aria-label="使用说明">
        <div><span>01</span><strong>放入文件</strong><small>支持 PDF、图片和 ZIP</small></div>
        <i />
        <div><span>02</span><strong>核对结果</strong><small>号码和金额都可以修改</small></div>
        <i />
        <div><span>03</span><strong>完成归档</strong><small>保存、ZIP、Excel 或合并 PDF</small></div>
      </section>

      <footer className="site-footer">
        <a className="footer-name" href="#">
          <span className="footer-mark">花</span>
          <strong>花签</strong>
        </a>
        <div className="footer-note">
          <span>智能发票整理工具</span>
          <span className="footer-dot" />
          <span>本地处理，不保存文件</span>
        </div>
      </footer>
    </main>
  );
}
