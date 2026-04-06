import { error, json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { getRankedSoloEntry } from "$lib/server/riot.service";

export async function GET({ url }: RequestEvent) {
  const platform = url.searchParams.get("platform") ?? "euw1";
  const summonerId = url.searchParams.get("summonerId") ?? "";
  const puuid = url.searchParams.get("puuid") ?? "";
  const normalizedSummonerId = summonerId.trim();
  const normalizedPuuid = puuid.trim();

  if (!normalizedSummonerId && !normalizedPuuid) {
    throw error(400, {
      message: "Missing summonerId or puuid query parameters",
    });
  }

  try {
    const rankedSolo = await getRankedSoloEntry(
      platform,
      normalizedSummonerId,
      normalizedPuuid,
    );

    return json({ rankedSolo });
  } catch (err: any) {
    throw error(400, {
      message: err?.message || "Failed to fetch rank data",
    });
  }
}
