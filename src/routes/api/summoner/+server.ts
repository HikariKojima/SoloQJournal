/**
 * This is a SvelteKit API route handler for fetching summoner profiles.
 * The +server.ts file in routes/api/summoner/ creates the endpoint at /api/summoner.
 * In SvelteKit, API routes use the RequestEvent to handle HTTP requests server-side.
 * Key concept: Server routes can access private env vars and perform external API calls securely.
 * Example: GET /api/summoner?gameName=Player&tagLine=NA1 fetches and returns profile data.
 */

import { json, error } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import {
  getAllFilteredMatchesForSeason,
  getFilteredMatchPage,
  getSummonerByRiotId,
  getSummonerByPuuid,
} from "$lib/server/riot.service";

export async function GET({ url }: RequestEvent) {
  const gameName = url.searchParams.get("gameName");
  const tagLine = url.searchParams.get("tagLine");
  const platform = url.searchParams.get("platform") ?? "euw1";
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
  const all = (url.searchParams.get("all") ?? "").toLowerCase() === "true";
  const allLimit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 10),
    150,
  );
  const champion = url.searchParams.get("champion") ?? undefined;
  const opponentChampion =
    url.searchParams.get("opponentChampion") ?? undefined;

  if (!gameName || !tagLine) {
    throw error(400, {
      message: "Missing gameName or tagLine query parameters",
    });
  }

  try {
    const account = await getSummonerByRiotId(gameName, tagLine, platform);
    const region = platform;
    const filters = {
      champion,
      opponentChampion,
    };

    if (all) {
      const matches = await getAllFilteredMatchesForSeason(
        region,
        account.puuid,
        filters,
        allLimit,
      );
      const hasMore = matches.length >= allLimit;

      if (offset === 0) {
        const summoner = await getSummonerByPuuid(region, account.puuid);
        return json({
          summoner,
          matches,
          nextOffset: 0,
          hasMore,
        });
      }

      return json({ matches, nextOffset: 0, hasMore });
    }

    const page = await getFilteredMatchPage(
      region,
      account.puuid,
      Number.isNaN(offset) ? 0 : offset,
      10,
      filters,
    );

    if (offset === 0) {
      const summoner = await getSummonerByPuuid(region, account.puuid);
      return json({
        summoner,
        matches: page.matches,
        nextOffset: page.nextOffset,
        hasMore: page.hasMore,
      });
    }

    return json({
      matches: page.matches,
      nextOffset: page.nextOffset,
      hasMore: page.hasMore,
    });
  } catch (err: any) {
    throw error(400, { message: err.message || "Failed to fetch profile" });
  }
}
