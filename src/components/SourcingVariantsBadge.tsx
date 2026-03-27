import { Layers } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface VariantOption {
  name: string;
  quantity: number;
}

interface VariantGroup {
  group: string;
  options: VariantOption[];
}

interface Props {
  variants: VariantGroup[] | null | undefined;
}

export function SourcingVariantsBadge({ variants }: Props) {
  if (!variants || !Array.isArray(variants) || variants.length === 0) return null;

  const totalOptions = variants.reduce((s, g) => s + (g.options?.length || 0), 0);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 rounded-full border bg-primary/5 border-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary cursor-default">
          <Layers className="h-2.5 w-2.5" />
          {variants.length}G · {totalOptions}V
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[280px]">
        <div className="space-y-1.5">
          {variants.map((g, i) => (
            <div key={i}>
              <p className="text-[11px] font-semibold">{g.group || `Group ${i + 1}`}</p>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {g.options?.map((o, j) => (
                  <span key={j} className="inline-flex items-center gap-0.5 rounded bg-background/80 px-1.5 py-0.5 text-[10px]">
                    {o.name} <span className="text-muted-foreground">×{o.quantity}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
