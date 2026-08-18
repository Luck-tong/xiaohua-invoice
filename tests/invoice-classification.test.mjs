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

test("excludes a standalone specification value from the item name", () => {
  const text = `项目名称 规格型号 单位 数量 单价 金额
    *生产生活服务*餐饮费 无 1 205.66 205.66 合计 218.00`;
  assert.equal(
    classifyInvoice(text, "普通发票.pdf"),
    "生产生活服务-餐饮费",
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

test("reads an OCR total when the currency symbol is mistaken for a Chinese character", () => {
  const result = parseInvoiceText(
    "发 票 号 码 : 26312000004897976641 价 税 合计 《大 写 ) 贰佰壹拾捌圆整 (小 写 ) 对 218. 00",
    "微信图片_20260817181914_2809_103.pdf",
  );
  assert.equal(result.number, "26312000004897976641");
  assert.equal(result.amount, "218");
});

test("reads an OCR total even when 合计 is recognized as 含计", () => {
  const result = parseInvoiceText(
    "发票号码:26312000004909676536 价 税 含 计 (大写) 壹仟零肆拾玖圆整 (小 写 ) 对 1049. 00",
    "微信图片_20260807125237_790_15.pdf",
  );
  assert.equal(result.amount, "1049");
});

test("classifies WeChat screenshots separately", () => {
  assert.equal(
    classifyInvoice("东方航空 账单详情 交易成功", "微信图片_20260604110930_1619_103.pdf"),
    "微信截图发票",
  );
});

test("uses the paid amount rather than the original order amount in a WeChat screenshot", () => {
  const result = parseInvoiceText(
    "东方航空 -70,613.50 交易成功 订单金额 70614.00 机票支付立减 -0.50",
    "微信图片_20260604110930_1619_103.pdf",
  );
  assert.equal(result.amount, "70613.5");
});

test("classifies an Alipay screenshot separately and uses the paid amount", () => {
  const text = `账单详情 全部账单 尚优生鲜直供超市浦东三林店
    -20.62 交易成功 订单金额 20.70 百次立减 -0.08
    付款方式 花呗 收单机构 上海汇付支付有限公司`;
  const filename = "c333d1a5cc36247a81b5826c44aa770f.jpg";
  const result = parseInvoiceText(text, filename);

  assert.equal(classifyInvoice(text, filename), "支付宝图片");
  assert.equal(result.amount, "20.62");
});
