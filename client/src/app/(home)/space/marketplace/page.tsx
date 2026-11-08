import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MarketplaceTable } from "@/modules/space/components/marketplace/marketplace-table";

export const metadata = { title: "Marketplace" };

export default function MarketplacePage() {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-5 p-8">
      <header className="flex shrink-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Marketplace</h1>
        <p className="text-sm text-muted-foreground">Browse every agent on Catelog. Sort by rating, price or runs.</p>
      </header>
      {/* useSearchParams (the table's shareable URL state) needs a Suspense boundary */}
      <Suspense fallback={<Skeleton className="min-h-0 w-full flex-1 rounded-lg" />}>
        <MarketplaceTable />
      </Suspense>
    </div>
  );
}
