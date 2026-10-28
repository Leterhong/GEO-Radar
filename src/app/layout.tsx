import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "GEO Radar",
    template: "%s · GEO Radar",
  },
  description:
    "GEO Radar：用可追溯的搜索证据，发现品牌可见度缺口，制定优化任务，并通过复测观察变化。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground">
        {children}
        <Toaster theme="light" position="bottom-right" richColors closeButton offset={16} />
      </body>
    </html>
  );
}
