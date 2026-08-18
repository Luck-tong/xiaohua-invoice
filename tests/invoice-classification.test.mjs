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

test("extracts the ledger parties, first item, subtotal, tax, and tax-inclusive amount", () => {
  const result = parseInvoiceText(`
    电子发票（普通发票） 发票号码：26912000000461724376
    购买方信息 名称：上海市建纬律师事务所
    统一社会信用代码/纳税人识别号：31310000425013819A
    销售方信息 名称：大连祖君宏正黄旗餐饮有限公司
    统一社会信用代码/纳税人识别号：91210202MADFQLJ04K
    项目名称 规格型号 单位 数量 单价 金额 税率/征收率 税额
    *生产生活服务*餐饮服务 1 726.42 726.42 6% 43.58
    *生产生活服务*其他服务 1 10.00 10.00
    合计 ¥726.42 ¥43.58
    价税合计（小写）¥770.00
  `, "26912000000461724376.pdf");

  assert.deepEqual(result, {
    number: "26912000000461724376",
    amount: "770",
    buyerName: "上海市建纬律师事务所",
    buyerTaxId: "31310000425013819A",
    sellerName: "大连祖君宏正黄旗餐饮有限公司",
    sellerTaxId: "91210202MADFQLJ04K",
    itemName: "生产生活服务-餐饮服务",
    subtotal: "726.42",
    taxAmount: "43.58",
  });
});

test("leaves subtotal and tax blank when they cannot be verified against the invoice total", () => {
  const result = parseInvoiceText(
    "发票号码：26912000000461724376 项目名称 *生产生活服务*餐饮服务 合计 726.42 40.00 价税合计（小写）770.00",
    "26912000000461724376.pdf",
  );

  assert.equal(result.amount, "770");
  assert.equal(result.subtotal, "");
  assert.equal(result.taxAmount, "");
});

test("separates buyer and seller names in row-ordered PDF text", () => {
  const result = parseInvoiceText(
    "购买方信息 名称：上海市建纬律师事务所 销售方信息 名称：大连祖君宏正黄旗餐饮有限公司 统一社会信用代码/纳税人识别号：31310000425013819A 统一社会信用代码/纳税人识别号：91210202MADFQLJ04K 项目名称 *生产生活服务*餐饮服务 价税合计（小写）770.00",
    "26912000000461724376.pdf",
  );

  assert.equal(result.buyerName, "上海市建纬律师事务所");
  assert.equal(result.sellerName, "大连祖君宏正黄旗餐饮有限公司");
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

test("prefers the explicit small total over a trailing tax amount", () => {
  const result = parseInvoiceText(
    "价税合计（大写）壹佰陆拾陆圆陆角（小写）¥166.60 合计金额¥164.95 税额¥1.65",
    "26432000001375360096.pdf",
  );

  assert.equal(result.amount, "166.6");
});

test("does not treat an archive copy suffix as the invoice amount", () => {
  const result = parseInvoiceText(
    "发票号码：26317000001248082454 合计 ¥832.08 ¥49.92 882.00（小写）捌佰捌拾贰圆整 价税合计（大写）",
    "电子发票 (1).pdf",
  );

  assert.equal(result.amount, "882");
});

test("verifies a total against amount plus tax in reversed PDF token order", () => {
  const result = parseInvoiceText(
    "价税合计（大写） 合计 （小写） 备注 开票人：壹佰陆拾陆圆陆角整 ¥166.60 李娟 164.95 ¥1.65 ¥",
    "26432000001375360096-上海市建纬律师事务所.pdf",
  );

  assert.equal(result.amount, "166.6");
});

test("keeps the verified total instead of the trailing tax in reversed token order", () => {
  const result = parseInvoiceText(
    "价税合计（大写） 合计 （小写） 备注 开票人：玖拾玖圆整 ¥99.00 朱琛 93.40 ¥5.60 ¥",
    "dzfp_26112000002646190696_上海市建纬律师事务所_20260629115102.pdf",
  );

  assert.equal(result.amount, "99");
});

test("preserves negative adjustments when verifying the final invoice total", () => {
  const result = parseInvoiceText(
    `发票号码：26332000004765395271 项目名称 税率 税额
    客运服务费 23.35 0.70 客运服务费 -2.91 -0.09
    合计 20.44 0.61 价税合计（大写）贰拾壹圆零伍分（小写）21.05`,
    "26332000004765395271.pdf",
  );

  assert.equal(result.amount, "21.05");
});

test("rejects a tax identifier mistaken for an amount and reads the small total", () => {
  const result = parseInvoiceText(
    "统一社会信用代码 31310000425013819A 价税合计 ¥31310000425013819 （小写）28.97",
    "26317000002869884573.pdf",
  );

  assert.equal(result.amount, "28.97");
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

test("recognizes a formal invoice despite a WeChat filename and OCR-spaced labels", () => {
  const text = `发 票 号 到: 26312000004897976641
    项 目 名 称 规格 型 号 单位 数量 单价 金额 税率 征收率 税额
    生 产 生 活 服务 * 餐 饮 服 务 1 205. 66 205. 66 6% 12.34
    合计 205. 66 12.34 价 税 合计（小 写）218. 00`;
  const filename = "微信图片_20260817181914_2809_103.pdf";

  assert.equal(parseInvoiceText(text, filename).amount, "218");
  assert.equal(classifyInvoice(text, filename), "餐饮费");
});

test("recovers an OCR invoice total by amount plus tax when the total label is unreadable", () => {
  const text = `发 票 号 到: 26312000004897976641
    项 目 名 称 单价 金额 税率 税额
    生 产 生 活 服务 * 餐 饮 服 务 205. 66 205. 66 6% 12.34
    合计 205. 66 12.34 价 税 台 计（小 写）218. 00`;

  assert.equal(
    parseInvoiceText(text, "微信图片_20260817181914_2809_103.pdf").amount,
    "218",
  );
});

test("classifies WeChat screenshots separately", () => {
  assert.equal(
    classifyInvoice("东方航空 账单详情 交易成功", "微信图片_20260604110930_1619_103.pdf"),
    "微信截图发票",
  );
});

test("uses invoice content before a WeChat image filename", () => {
  const text = `电子发票（普通发票） 发票号码：26312000004909676536
    项目名称 规格型号 单位 数量 单价 金额
    *生产生活服务*餐饮服务 1 989.62 989.62
    价税合计（小写）¥1049.00`;

  assert.equal(
    classifyInvoice(text, "微信图片_20260807125237_790_15.pdf"),
    "生产生活服务-餐饮服务",
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
