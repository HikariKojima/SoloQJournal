import { error, json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { getSummonerByPuuid, getSummonerByRiotId } from "$lib/server/riot.service";

export async function GET({ url }: RequestEvent) {
  const gameName = url.searchParams.get("gameName");
  const tagLine = url.searchParams.get("tagLine");
  const platform = url.searchParams.get("platform") ?? "euw1";

  if (!gameName || !tagLine) {
    throw error(400, {
      message: "Missing gameName or tagLine query parameters",
    });
  }

  try {
    const account = await getSummonerByRiotId(gameName, tagLine, platform);
    const summoner = await getSummonerByPuuid(platform, account.puuid);
    return json({ summoner });
  } catch (err: any) {
    throw error(400, {
      message: err?.message || "Failed to fetch profile",
    });
  }
}
