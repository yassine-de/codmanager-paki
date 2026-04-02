import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
  return (
    <div className="max-w-[1400px] space-y-8 mt-5 animate-fade-in">
      {/* Header */}
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64 mt-2" />
      </div>

      {/* Sparkline cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border shadow-soft p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-7 w-20 mt-2" />
              </div>
              <Skeleton className="h-5 w-10 rounded-full" />
            </div>
            <Skeleton className="h-[105px] w-full rounded-lg" />
          </div>
        ))}
      </div>

      {/* KPI section */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border shadow-soft p-5">
            <Skeleton className="h-3 w-24 mb-3" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-xl" />
              <div className="flex-1">
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-10 mt-1" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border shadow-soft p-5">
          <Skeleton className="h-4 w-32 mb-4" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 mb-3">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
        <div className="bg-card rounded-xl border shadow-soft p-5">
          <Skeleton className="h-4 w-32 mb-4" />
          <Skeleton className="h-[150px] w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
