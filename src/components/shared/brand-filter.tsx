"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function BrandFilter({
  brands,
  days,
  basePath,
  currentBrandId,
  allowAll = false,
}: {
  brands: Array<{ id: string; name: string }>;
  days: number;
  basePath: string;
  currentBrandId?: string;
  allowAll?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = currentBrandId ?? searchParams.get("brandId") ?? (allowAll ? "all" : brands[0]?.id ?? "all");

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete(key);
    else params.set(key, value);
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <div className="flex gap-2">
      <Select value={current} onValueChange={(v) => update("brandId", v)}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="选择品牌" />
        </SelectTrigger>
        <SelectContent>
          {allowAll ? <SelectItem value="all">全部品牌</SelectItem> : null}
          {brands.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={String(days)} onValueChange={(v) => update("days", v)}>
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="7">近 7 天</SelectItem>
          <SelectItem value="30">近 30 天</SelectItem>
          <SelectItem value="90">近 90 天</SelectItem>
          <SelectItem value="365">近一年</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
