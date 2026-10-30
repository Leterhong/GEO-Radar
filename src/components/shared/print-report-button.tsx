"use client";

import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

export function PrintReportButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer className="mr-1 h-3.5 w-3.5" /> 打印 / PDF
    </Button>
  );
}
