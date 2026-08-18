import type { Worker as TesseractWorker } from "tesseract.js";

const PUBLIC_BASE_PATH = "/xiaohua-invoice";

export type RecognitionResult = {
  number: string;
  amount: string;
  category: InvoiceCategory;
  method: "pdf-text" | "ocr";
};

export const INVOICE_CATEGORIES = [
  "微信截图发票",
  "支付宝图片",
  "交通费",
  "餐饮费",
  "住宿费",
  "办公用品费",
  "平台服务费",
  "技术服务费",
  "咨询服务费",
  "维修费",
  "物业费",
  "通信费",
  "软件服务费",
  "广告服务费",
  "服务费",
  "其他",
] as const;

export type InvoiceCategory = string;

const CATEGORY_RULES: Array<{
  category: InvoiceCategory;
  keywords: string[];
}> = [
  {
    category: "住宿费",
    keywords: ["住宿", "酒店", "宾馆", "旅馆", "客房", "民宿"],
  },
  {
    category: "餐饮费",
    keywords: [
      "餐饮", "餐费", "饭店", "餐厅", "酒楼", "小吃", "食品", "外卖",
      "美团", "饿了么", "咖啡", "茶饮", "餐饮服务",
    ],
  },
  {
    category: "交通费",
    keywords: [
      "交通", "出行", "打车", "出租车", "客运", "铁路", "火车", "航空",
      "机票", "车票", "滴滴", "高德", "T3", "星徽", "AA出行", "加油",
    ],
  },
  {
    category: "平台服务费",
    keywords: ["平台服务费", "平台服务"],
  },
  {
    category: "技术服务费",
    keywords: ["技术服务费", "技术服务"],
  },
  {
    category: "咨询服务费",
    keywords: ["咨询服务费", "咨询服务", "咨询费"],
  },
  {
    category: "维修费",
    keywords: ["维修费", "维修服务", "修理费"],
  },
  {
    category: "物业费",
    keywords: ["物业费", "物业服务"],
  },
  {
    category: "通信费",
    keywords: ["通信费", "通讯费", "电信服务", "话费"],
  },
  {
    category: "软件服务费",
    keywords: ["软件服务费", "软件服务", "软件费"],
  },
  {
    category: "广告服务费",
    keywords: ["广告服务费", "广告服务", "广告费"],
  },
  {
    category: "办公用品费",
    keywords: [
      "办公", "文具", "打印", "耗材", "电脑", "电子设备", "办公用品",
      "日用品", "采购", "百货",
    ],
  },
  {
    category: "服务费",
    keywords: [
      "服务费", "生产生活服务", "服务项目", "信息服务",
    ],
  },
];

function matchCategory(text: string) {
  const normalized = text.replace(/\s+/g, "").toLowerCase();
  return CATEGORY_RULES.find((rule) =>
    rule.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())),
  )?.category;
}

export function extractInvoiceItemText(text: string) {
  const normalized = text.replace(/\s+/g, "");
  const headers = [
    "货物或应税劳务、服务名称",
    "货物或应税劳务服务名称",
    "应税劳务、服务名称",
    "项目名称",
  ];
  const header = headers
    .map((value) => ({ value, index: normalized.indexOf(value) }))
    .filter((item) => item.index >= 0)
    .sort((left, right) => left.index - right.index)[0];
  if (!header) return "";

  const start = header.index + header.value.length;
  const remaining = normalized.slice(start, start + 500);
  const end = ["价税合计", "合计"]
    .map((marker) => remaining.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  return end === undefined ? remaining : remaining.slice(0, end);
}

export function extractInvoiceItemName(text: string) {
  const itemText = extractInvoiceItemText(text);
  const standardized = [itemText, text.replace(/\s+/g, "")]
    .map((source) =>
      source.match(
        /[*＊]([^*＊\d¥￥]{2,30})[*＊]([^\d¥￥]{2,40}?)(?=\d|税率|征收率|价税合计|合计|$)/,
      ),
    )
    .find(Boolean);
  if (!standardized) return "";

  const category = standardized[1].replace(/[：:，,、-]+$/g, "");
  let name = standardized[2]
    .replace(/^(规格型号|单位|数量|单价|金额|税率|征收率|税额)+/g, "")
    .replace(/[：:，,、-]+$/g, "");
  if (/规格型号/.test(itemText.slice(0, 80))) {
    name = name.replace(/无$/, "");
  }
  return category && name ? `${category}-${name}` : "";
}

function isAlipayScreenshot(text: string, filename = "") {
  return /支付宝/i.test(filename) ||
    /支付宝|花呗|收单机构|清算机构|全部账单|百次立减/.test(text);
}

function isWeChatScreenshot(text: string, filename = "") {
  return /微信图片|微信截图/i.test(filename) ||
    /微信支付/.test(text) ||
    (/账单详情/.test(text) && !isAlipayScreenshot(text, filename));
}

export function classifyInvoice(text: string, filename = ""): InvoiceCategory {
  const fullItemName = extractInvoiceItemName(text);
  if (fullItemName) return fullItemName;

  if (isAlipayScreenshot(text, filename)) {
    return "支付宝图片";
  }
  const isOfficialInvoice = /电子发票|发票号码|价税合计/.test(text);
  if (!isOfficialInvoice && isWeChatScreenshot(text, filename)) {
    return "微信截图发票";
  }

  return (
    matchCategory(extractInvoiceItemText(text)) ??
    matchCategory(text) ??
    matchCategory(filename) ??
    "其他"
  );
}

type ProgressCallback = (progress: number, stage: "reading" | "ocr") => void;

let ocrWorkerPromise: Promise<TesseractWorker> | null = null;
let ocrQueue: Promise<unknown> = Promise.resolve();
let activeOcrProgress: ProgressCallback | null = null;

function cleanAmount(value: string) {
  const parsed = Number.parseFloat(value.replace(/,/g, "").replace("，", "."));
  if (!Number.isFinite(parsed) || Math.abs(parsed) > 999_999_999_999) return "";
  return String(parsed);
}

function cleanPositiveAmount(value: string) {
  const amount = cleanAmount(value);
  return amount ? String(Math.abs(Number(amount))) : "";
}

function compactDigits(value: string) {
  return value.replace(/\D/g, "");
}

function validInvoiceNumber(value: string) {
  return [8, 10, 12, 20].includes(value.length);
}

function filenameHints(filename: string) {
  const number = filename.match(/(?:^|\D)(\d{20})(?:\D|$)/)?.[1] ?? "";
  const amount =
    filename.match(/[（(](\d+(?:\.\d{1,2})?)[）)]/)?.[1] ??
    filename.match(/-(\d+(?:\.\d{1,2})?)元(?:-|】)/)?.[1] ??
    "";
  return { number, amount: amount ? cleanAmount(amount) : "" };
}

export function parseInvoiceText(text: string, filename = "") {
  const normalized = text
    .replace(/\u00a0/g, " ")
    .replace(/[：﹕]/g, ":")
    .replace(/[，]/g, ",");
  const hints = filenameHints(filename);
  const compact = normalized.replace(/\s+/g, "");

  const labelledNumber = normalized.match(
    /发票号码\s*:?\s*([0-9\s]{8,30})/,
  )?.[1];
  const labelledDigits = labelledNumber ? compactDigits(labelledNumber) : "";
  const spacedTwentyDigit = normalized.match(
    /(?<!\d)(\d(?:\s?\d){19})(?!\d)/,
  )?.[1];
  const fallbackNumber = spacedTwentyDigit
    ? compactDigits(spacedTwentyDigit)
    : normalized.match(/(?<!\d)\d{20}(?!\d)/)?.[0] ??
      compact.match(/(?<!\d)\d{20}(?!\d)/)?.[0] ??
      "";
  const number = validInvoiceNumber(labelledDigits)
    ? labelledDigits
    : fallbackNumber || hints.number;

  let amount = "";

  if (
    isAlipayScreenshot(compact, filename) ||
    isWeChatScreenshot(compact, filename)
  ) {
    const paidAmount = compact.match(
      /(-?[\d,]+(?:\.\d{1,2})?)交易成功/,
    )?.[1];
    const orderAmount = compact.match(
      /订单金额[:：]?(-?[\d,]+(?:\.\d{1,2})?)/,
    )?.[1];
    amount = cleanPositiveAmount(paidAmount || orderAmount || "");
  }

  const ticketAmount = !amount ? compact.match(
    /(?:票价|退票费):?[¥￥]?([\d,]+(?:\.\d{1,2})?)/,
  )?.[1] : "";
  if (ticketAmount) amount = cleanAmount(ticketAmount);

  if (!amount && /(?:铁路电子客票|电子客票)/.test(compact)) {
    const currencyAmount = compact.match(/[¥￥]([\d,]+(?:\.\d{1,2})?)/)?.[1];
    if (currencyAmount) amount = cleanAmount(currencyAmount);
  }

  if (!amount) {
    const directSmallTotal = compact.match(
      /小写[）)》]?[:：]?[¥￥]?([0-9][\d,]*(?:\.\d{1,2})?)/,
    )?.[1];
    if (directSmallTotal) amount = cleanAmount(directSmallTotal);
  }

  if (!amount) {
    const totalStart = compact.indexOf("价税合计");
    if (totalStart >= 0) {
      const totalArea = compact.slice(totalStart, totalStart + 600);
      const currencyAmounts = [...totalArea.matchAll(/[¥￥]([\d,]+(?:\.\d{1,2})?)/g)];
      const lastAmount = currencyAmounts.at(-1)?.[1];
      if (lastAmount) amount = cleanAmount(lastAmount);
    }
  }

  if (!amount) {
    const smallTotal = compact.match(
      /小写[）)》]?[^0-9]{0,20}([0-9][\d,]*(?:\.\d{1,2})?)/,
    )?.[1];
    if (smallTotal) amount = cleanAmount(smallTotal);
  }

  const amountPatterns = [
    /(?:票价|退票费)\s*:?\s*[¥￥]?\s*([\d,]+(?:\.\d{1,2})?)/,
    /[零壹贰叁肆伍陆柒捌玖拾佰仟万亿圆元角分整]{2,}[\s\S]{0,40}?[¥￥]\s*([\d,]+(?:\.\d{1,2})?)/,
    /(?:小写)[）)]?\s*[¥￥]\s*([\d,]+(?:\.\d{1,2})?)/,
    /价税合计[\s\S]{0,80}?[¥￥]\s*([\d,]+(?:\.\d{1,2})?)/,
  ];

  if (!amount) {
    for (const pattern of amountPatterns) {
      const match = normalized.match(pattern)?.[1];
      if (match) {
        amount = cleanAmount(match);
        break;
      }
    }
  }

  return { number, amount: amount || hints.amount };
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = import("tesseract.js").then(({ createWorker }) =>
      createWorker(["chi_sim", "eng"], undefined, {
        logger(message) {
          if (!activeOcrProgress) return;
          const progress = Number.isFinite(message.progress)
            ? Math.round(message.progress * 100)
            : 0;
          activeOcrProgress(progress, "ocr");
        },
      }),
    );
  }
  return ocrWorkerPromise;
}

function recognizeWithOcr(
  image: File | HTMLCanvasElement,
  onProgress: ProgressCallback,
) {
  const task = ocrQueue.then(async () => {
    activeOcrProgress = onProgress;
    const worker = await getOcrWorker();
    const result = await worker.recognize(image);
    activeOcrProgress = null;
    return result.data.text;
  });

  ocrQueue = task.catch(() => undefined);
  return task;
}

async function loadPdf(file: File) {
  const pdfjs = await import("pdfjs-dist/legacy/webpack.mjs");
  return pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${PUBLIC_BASE_PATH}/pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PUBLIC_BASE_PATH}/pdfjs/standard_fonts/`,
  }).promise;
}

async function extractPdfText(file: File, onProgress: ProgressCallback) {
  const pdf = await loadPdf(file);
  const texts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress(Math.round((pageNumber / pdf.numPages) * 70), "reading");
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    texts.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter(Boolean)
        .join(" "),
    );
  }
  return { pdf, text: texts.join("\n") };
}

async function renderFirstPdfPage(
  pdf: Awaited<ReturnType<typeof loadPdf>>,
) {
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

export async function recognizeInvoice(
  file: File,
  onProgress: ProgressCallback,
): Promise<RecognitionResult> {
  if (/\.pdf$/i.test(file.name)) {
    onProgress(5, "reading");
    const { pdf, text } = await extractPdfText(file, onProgress);
    const parsed = parseInvoiceText(text, file.name);
    if (parsed.number && parsed.amount) {
      onProgress(100, "reading");
      return {
        ...parsed,
        category: classifyInvoice(text, file.name),
        method: "pdf-text",
      };
    }

    const canvas = await renderFirstPdfPage(pdf);
    const ocrText = await recognizeWithOcr(canvas, onProgress);
    const ocrParsed = parseInvoiceText(`${text}\n${ocrText}`, file.name);
    return {
      ...ocrParsed,
      category: classifyInvoice(`${text}\n${ocrText}`, file.name),
      method: "ocr",
    };
  }

  onProgress(1, "ocr");
  const text = await recognizeWithOcr(file, onProgress);
  return {
    ...parseInvoiceText(text, file.name),
    category: classifyInvoice(text, file.name),
    method: "ocr",
  };
}

function mimeForName(name: string) {
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "image/jpeg";
}

export async function unpackInvoiceZip(file: File) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter(
    (entry) =>
      !entry.dir && /\.(pdf|png|jpe?g|webp)$/i.test(entry.name),
  );

  const files: Array<{ file: File; sourcePath: string }> = [];
  for (const entry of entries) {
    const blob = await entry.async("blob");
    const name = entry.name.split("/").pop() || entry.name;
    const sourcePath = entry.name.split("/").slice(0, -1).join(" › ");
    files.push({
      file: new File([blob], name, {
        type: mimeForName(name),
        lastModified: file.lastModified,
      }),
      sourcePath,
    });
  }
  return files;
}
