import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "花签｜智能发票整理工具",
  description: "读取发票号码和金额，快速生成统一、清楚的文件名。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
