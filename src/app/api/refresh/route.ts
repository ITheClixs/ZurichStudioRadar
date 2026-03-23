import { NextResponse } from "next/server";

import { refreshAggregationSnapshot } from "@/lib/aggregation";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const snapshot = await refreshAggregationSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Refresh failed",
        details: String(error)
      },
      { status: 500 }
    );
  }
}
