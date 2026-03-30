import { error, json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { getMatchDetails } from "$lib/server/riot.service";

export async function GET({ url }: RequestEvent) {
  const matchId = url.searchParams.get("matchId");
  const puuid = url.searchParams.get("puuid");
  const platform = url.searchParams.get("platform") ?? "euw1";

  if (!matchId || !puuid) {
    throw error(400, {
      message: "Missing matchId or puuid query parameters",
    });
  }

  try {
    const match = await getMatchDetails(platform, matchId, puuid, true);
    return json({
      matchId,
      stats: {
        csAt10:
          typeof match.stats.csAt10 === "number" ? match.stats.csAt10 : null,
        csAt20:
          typeof match.stats.csAt20 === "number" ? match.stats.csAt20 : null,
      },
    });
  } catch (err: any) {
    throw error(400, {
      message: err?.message || "Failed to fetch match timeline stats",
    });
  }
}
