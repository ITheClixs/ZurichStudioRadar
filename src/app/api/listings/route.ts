import { NextResponse } from "next/server";

import { getAggregationSnapshot } from "@/lib/aggregation";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getAggregationSnapshot();
  return NextResponse.json(snapshot);
}
