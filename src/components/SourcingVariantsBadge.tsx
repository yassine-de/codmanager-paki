import { Layers } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SubVariant {
  name: string;
  quantity: number;
}

interface Variant {
  name: string;
  quantity: number;
  subVariants?: SubVariant[];
  // legacy group format support
  group?: string;
  options?: { name: string; quantity: number }[];
}

interface Props {
  variants: Variant[] | null | undefined;
}

export function SourcingVariantsBadge({ variants }: Props) {
  if (!variants || !Array.isArray(variants) || variants.length === 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 rounded-full border bg-primary/5 border-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary cursor-default">
          <Layers className="h-2.5 w-2.5" />
          {variants.length}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[300px]">
        <div className="space-y-1">
          {variants.map((v, i) => {
            const vName = v.name || v.group || `Variant ${i + 1}`;
            const subs = v.subVariants || v.options;
            return (
              <div key={i}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium">{vName}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">×{v.quantity}</span>
                </div>
                {subs && subs.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-0.5 pl-2">
                    {subs.map((sv, j) => (
                      <span key={j} className="inline-flex items-center gap-0.5 rounded bg-background/80 px-1.5 py-0.5 text-[10px]">
                        {sv.name} <span className="text-muted-foreground">×{sv.quantity}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
