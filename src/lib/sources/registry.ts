import { flatfoxAdapter } from "@/lib/sources/flatfox/adapter";
import { umsAdapter } from "@/lib/sources/ums/adapter";
import { urbanHomeAdapter } from "@/lib/sources/urbanhome/adapter";
import type { SourceAdapter } from "@/lib/sources/base";

export const sourceAdapters: SourceAdapter[] = [flatfoxAdapter, urbanHomeAdapter, umsAdapter];
