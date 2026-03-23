import { ListingsDashboard } from "@/components/listings-dashboard";
import { getCachedAggregationSnapshot } from "@/lib/cache";

export default async function HomePage() {
  const snapshot = await getCachedAggregationSnapshot();

  return <ListingsDashboard initialSnapshot={snapshot} />;
}
