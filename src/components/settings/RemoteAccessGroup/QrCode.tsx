import { useMemo } from "react";
import { encode } from "uqr";
import { cn } from "@/lib/utils";

/** QR sebagai SVG murni (tanpa innerHTML). */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { data, size } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 });
    return { data: qr.data, size: qr.size };
  }, [value]);
  const path = useMemo(() => {
    let d = "";
    for (let y = 0; y < data.length; y++) {
      const row = data[y] ?? [];
      for (let x = 0; x < row.length; x++) if (row[x]) d += `M${x} ${y}h1v1h-1z`;
    }
    return d;
  }, [data]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn("size-40 shrink-0 rounded-lg bg-white p-1", className)}
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
