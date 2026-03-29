/**
 * This is a SvelteKit API route handler for fetching summoner profiles.
 * The +server.ts file in routes/api/summoner/ creates the endpoint at /api/summoner.
 * In SvelteKit, API routes use the RequestEvent to handle HTTP requests server-side.
 * Key concept: Server routes can access private env vars and perform external API calls securely.
 * Example: GET /api/summoner?gameName=Player&tagLine=NA1 fetches and returns profile data.
 * 
 * PERFORMANCE OPTIMIZATIONS:
 * - Limited to 20 matches max per request (prevents rate limit issues)
 * - Client-side pagination for loading more matches
 * - Parallel match fetching reduces response time
 */

import { json, error } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import {
  getAllFilteredMatchesForSeason,
  getFilteredMatchPage,
  getSummonerByRiotId,
  getSummonerByPuuid,
} from "$lib/server/riot.service";

const DEFAULT_PAGE_LIMIT = 12;
const MAX_PAGE_LIMIT = 20;

export async function GET({ url }: RequestEvent) {
  const gameName = url.searchParams.get("gameName");
  const tagLine = url.searchParams.get("tagLine");
  const platform = url.searchParams.get("platform") ?? "euw1";
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
  const all = (url.searchParams.get("all") ?? "").toLowerCase() === "true";
  
  // Keep page responses compact for snappier infinite scroll while preserving
  // a hard upper bound for manual query overrides.
  const allLimit = Math.min(
    Math.max(
      parseInt(url.searchParams.get("limit") ?? String(DEFAULT_PAGE_LIMIT), 10) ||
        DEFAULT_PAGE_LIMIT,
      5,
    ),
    MAX_PAGE_LIMIT,
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
      allLimit,  // Use the limited value (max 20)
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
