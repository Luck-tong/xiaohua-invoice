import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyInvoice,
  extractInvoiceItemName,
  extractInvoiceItemText,
  parseInvoiceText,
} from "../app/invoice-recognition.ts";

test("prioritizes the invoice item name over company-name keywords", () => {
  const text = `
    购买方名称：上海某酒店管理有限公司
    销售方名称：北京某交通科技有限公司
    项目名称 规格型号 单位 数量 单价 金额
    *生产生活服务*技术服务费 12 74.52 894.34
    合计 894.34
  `;

  assert.match(extractInvoiceItemText(text), /生产生活服务.*技术服务费/);
  assert.equal(extractInvoiceItemName(text), "生产生活服务-技术服务费");
  assert.equal(
    classifyInvoice(text, "普通发票.pdf"),
    "生产生活服务-技术服务费",
  );
});

test("falls back to the full invoice text when no item header is available", () => {
  assert.equal(classifyInvoice("上海云庭酒店 客房服务", "普通发票.pdf"), "住宿费");
});

test("keeps the full standardized platform-service item name", () => {
  const text = `项目名称 规格型号 单位 数量 单价 金额
    *生产生活服务*平台服务费 1 200.00 200.00 合计 200.00`;
  assert.equal(
    classifyInvoice(text, "普通发票.pdf"),
    "生产生活服务-平台服务费",
  );
});

test("keeps the exact platform usage item name from the full invoice text", () => {
  const text = `电子发票（普通发票）
    购买方名称：上海市建纬律师事务所
    *生产生活服务*平台使用费
    价税合计（小写）¥800.00`;
  assert.equal(
    classifyInvoice(text, "26442000007749106261.pdf"),
    "生产生活服务-平台使用费",
  );
});

test("reads a spaced railway ticket price from OCR text", () => {
  const result = parseInvoiceText(
    "发票号码：26469151444000199953 票 价： ￥ 68.00",
    "26469151444000199953-电子发票.pdf",
  );
  assert.equal(result.amount, "68");
});

test("reads the only currency amount from a railway ticket when the price label is unclear", () => {
  const result = parseInvoiceText(
    "铁路电子客票 美兰站 C7889 琼海站 ￥68.00",
    "26469151444000199953-电子发票.pdf",
  );
  assert.equal(result.amount, "68");
});

test("uses the final currency amount in a fragmented invoice total area", () => {
  const result = parseInvoiceText(
    "价税合计（大写） （小写） 项目金额 ¥205.00 税额 ¥12.30 ¥217.30 贰佰壹拾柒圆叁角",
    "26317000002365948991.pdf",
  );
  assert.equal(result.amount, "217.3");
});
