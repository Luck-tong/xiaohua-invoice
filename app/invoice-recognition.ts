import type { Worker as TesseractWorker } from "tesseract.js";

const PUBLIC_BASE_PATH = "/xiaohua-invoice";

export type RecognitionResult = {
  number: string;
  amount: string;
  buyerName: string;
  buyerTaxId: string;
  sellerName: string;
  sellerTaxId: string;
  itemName: string;
  subtotal: string;
  taxAmount: string;
  invoiceDate: string;
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
    keywords: ["平台服务费", "平台服务", "平台使用费", "平台使用"],
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
  const compactText = text.replace(/\s+/g, "");
  const fullItemName = extractInvoiceItemName(text);
  if (fullItemName) return matchCategory(fullItemName) ?? "其他";

  if (isAlipayScreenshot(text, filename)) {
    return "支付宝图片";
  }
  const isOfficialInvoice = /电子发票|发票号码|价税合计/.test(compactText) ||
    (/(?<!\d)\d{20}(?!\d)/.test(compactText) &&
      /项目名称|税率|征收率|开票日期/.test(compactText));
  if (!isOfficialInvoice && isWeChatScreenshot(text, filename)) {
    return "微信截图发票";
  }

  return (
    matchCategory(extractInvoiceItemText(text)) ??
    matchCategory(text) ??
    matchCategory(compactText) ??
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
    filename.match(/\d{8,20}（(\d+(?:\.\d{1,2})?)）/)?.[1] ??
    filename.match(/-(\d+(?:\.\d{1,2})?)元(?:-|】)/)?.[1] ??
    "";
  return { number, amount: amount ? cleanAmount(amount) : "" };
}

function closeAmount(left: number, right: number) {
  return Math.abs(left - right) <= 0.011;
}

function verifiedSumAmount(text: string) {
  const values = [...text.matchAll(
    /(?<![\d.])-?[0-9][\d,]*\.\d{1,2}(?!\d)/g,
  )].map((match) => Number(match[0].replace(/,/g, "")))
    .filter((value) =>
      Number.isFinite(value) && Math.abs(value) <= 999_999_999_999
    );

  const verifiedTotals = values.filter((target, targetIndex) =>
    target > 0 && values.some((left, leftIndex) =>
      leftIndex !== targetIndex && values.some((right, rightIndex) =>
        rightIndex !== targetIndex &&
        rightIndex !== leftIndex &&
        closeAmount(left + right, target)
      )
    )
  );
  return verifiedTotals.length > 0 ? String(Math.max(...verifiedTotals)) : "";
}

function invoiceTotalAmount(text: string) {
  const compact = text
    .replace(/(?<=\d)\s+(?=\d)/g, "|")
    .replace(/\s+/g, "");
  const totalIndex = Math.max(
    compact.indexOf("价税合计"),
    compact.indexOf("价税含计"),
  );
  if (totalIndex < 0) return "";

  const totalArea = compact.slice(
    Math.max(0, totalIndex - 320),
    totalIndex + 520,
  );
  const beforeSmall = totalArea.match(
    /(-?[0-9][\d,]*(?:\.\d{1,2})?)[（(]?小写[）)]?/,
  )?.[1];
  const cleanedBeforeSmall = beforeSmall ? cleanPositiveAmount(beforeSmall) : "";
  if (cleanedBeforeSmall) return cleanedBeforeSmall;

  const directAfterSmall = totalArea.match(
    /小写[）)》]?[:：]?[¥￥]?(-?[0-9][\d,]*(?:\.\d{1,2})?)/,
  )?.[1];
  if (directAfterSmall) return cleanPositiveAmount(directAfterSmall);

  const verifiedTotal = verifiedSumAmount(totalArea);
  if (verifiedTotal) return verifiedTotal;

  const labelledAfterSmall = totalArea.match(
    /小写[）)》]?[^0-9]{0,140}[¥￥]?(-?[0-9][\d,]*(?:\.\d{1,2})?)/,
  )?.[1];
  if (labelledAfterSmall) return cleanPositiveAmount(labelledAfterSmall);

  return "";
}

function cleanPartyName(value: string) {
  return value
    .replace(/^(?:名称|名\s*称)[:：]?/g, "")
    .replace(/(?:统一社会信用代码|纳税人识别号).*$/g, "")
    .replace(/^[：:\s]+|[：:\s]+$/g, "")
    .slice(0, 100);
}

function invoiceParties(text: string) {
  const partyArea = text.split(/项目\s*名\s*称|货物或应税劳务/)[0] ?? text;
  const taxIds = [...text.matchAll(/(?<![0-9A-Z])[0-9A-Z]{15,20}(?![0-9A-Z])/gi)]
    .map((match) => match[0].toUpperCase())
    .filter((value) => value.length === 15 || value.length === 18);
  const names = [...partyArea.matchAll(
    /(?:名称|名\s*称)\s*[:：]\s*([^\n]{2,100}?)(?=\s+(?:购买方信息|销售方信息|统一社会信用代码(?:\s*\/\s*纳税人识别号)?|纳税人识别号|名称|名\s*称)\s*[:：]?|$)/gi,
  )]
    .map((match) => cleanPartyName(match[1]))
    .filter(Boolean);

  const buyerName = partyArea.match(
    /购买方信息[\s\S]{0,40}?(?:名称|名\s*称)\s*[:：]\s*([\s\S]{2,100}?)(?=\s*(?:销售方信息|统一社会信用代码|纳税人识别号|项目\s*名\s*称))/i,
  )?.[1];
  const sellerName = partyArea.match(
    /销售方信息[\s\S]{0,40}?(?:名称|名\s*称)\s*[:：]\s*([\s\S]{2,100}?)(?=\s*(?:购买方信息|统一社会信用代码|纳税人识别号|项目\s*名\s*称|$))/i,
  )?.[1];

  const invoiceNumberMatch = text.match(/(?<!\d)\d{20}(?!\d)/);
  let flattenedBuyerName = "";
  let flattenedSellerName = "";
  if (invoiceNumberMatch?.index !== undefined && taxIds.length >= 2) {
    const valuesArea = text.slice(invoiceNumberMatch.index + invoiceNumberMatch[0].length);
    const withoutDate = valuesArea.replace(
      /^\s*\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*/,
      "",
    );
    const buyerTaxIndex = withoutDate.indexOf(taxIds[0]);
    const sellerTaxIndex = withoutDate.indexOf(taxIds[1], buyerTaxIndex + taxIds[0].length);
    if (buyerTaxIndex > 0 && sellerTaxIndex > buyerTaxIndex) {
      flattenedBuyerName = cleanPartyName(withoutDate.slice(0, buyerTaxIndex));
      flattenedSellerName = cleanPartyName(
        withoutDate.slice(buyerTaxIndex + taxIds[0].length, sellerTaxIndex),
      );
    }
  }

  return {
    buyerName: cleanPartyName(buyerName ?? names[0] ?? flattenedBuyerName),
    buyerTaxId: taxIds[0] ?? "",
    sellerName: cleanPartyName(sellerName ?? names[1] ?? flattenedSellerName),
    sellerTaxId: taxIds[1] ?? "",
  };
}

function invoiceSubtotalAndTax(text: string, totalAmount: string) {
  const total = Number(totalAmount);
  if (!Number.isFinite(total) || total <= 0) {
    return { subtotal: "", taxAmount: "" };
  }

  const compact = text.replace(/(?<=\d)\s+(?=\d)/g, "").replace(/\s+/g, "");
  const totalIndex = Math.max(compact.lastIndexOf("价税合计"), compact.lastIndexOf("价税含计"));
  const beforeTotal = compact.slice(Math.max(0, totalIndex - 260), Math.max(0, totalIndex));
  const labelled = beforeTotal.match(
    /合计[^0-9-]{0,30}(-?[0-9][\d,]*\.\d{1,2})[^0-9-]{0,30}(-?[0-9][\d,]*\.\d{1,2})[^0-9-]*$/,
  );
  const candidates = labelled
    ? [labelled[1], labelled[2]].map((value) => Number(value.replace(/,/g, "")))
    : [...beforeTotal.matchAll(/(?<![\d.])-?[0-9][\d,]*\.\d{1,2}(?!\d)/g)]
      .map((match) => Number(match[0].replace(/,/g, "")))
      .slice(-12);

  const currencyCandidates = [...text.matchAll(
    /[¥￥]\s*(-?[0-9][\d,]*\.\d{1,2})/g,
  )].map((match) => Number(match[1].replace(/,/g, "")));

  for (let right = 1; right < currencyCandidates.length; right += 1) {
    for (let left = 0; left < right; left += 1) {
      const subtotal = currencyCandidates[left];
      const taxAmount = currencyCandidates[right];
      if (subtotal >= 0 && taxAmount >= 0 && closeAmount(subtotal + taxAmount, total)) {
        return { subtotal: String(subtotal), taxAmount: String(taxAmount) };
      }
    }
  }

  for (let right = candidates.length - 1; right >= 1; right -= 1) {
    for (let left = right - 1; left >= 0; left -= 1) {
      const subtotal = candidates[left];
      const taxAmount = candidates[right];
      if (subtotal >= 0 && taxAmount >= 0 && closeAmount(subtotal + taxAmount, total)) {
        return { subtotal: String(subtotal), taxAmount: String(taxAmount) };
      }
    }
  }
  return { subtotal: "", taxAmount: "" };
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

  if (!amount) amount = invoiceTotalAmount(normalized);
  if (!amount && number) {
    const amountText = normalized
      .replace(/(?<=\d)\s+(?=\d)/g, "|")
      .replace(/\s+/g, "");
    amount = verifiedSumAmount(amountText);
  }

  const amountPatterns = [
    /(?:票价|退票费)\s*:?\s*[¥￥]?\s*([\d,]+(?:\.\d{1,2})?)/,
    /(?:小写)[）)]?\s*[¥￥]\s*([\d,]+(?:\.\d{1,2})?)/,
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

  const finalAmount = amount || hints.amount;
  const dateMatch = normalized.match(
    /(?:开票日期|日期)\s*[:：]?\s*(\d{4})\s*[年\-/]\s*(\d{1,2})\s*[月\-/]\s*(\d{1,2})\s*日?/,
  );
  const invoiceDate = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`
    : "";
  const parties = invoiceParties(normalized);
  const totals = invoiceSubtotalAndTax(normalized, finalAmount);
  return {
    number,
    amount: finalAmount,
    ...parties,
    itemName: extractInvoiceItemName(normalized),
    invoiceDate,
    ...totals,
  };
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
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
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
