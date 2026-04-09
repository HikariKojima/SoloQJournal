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
import {
  applyRateLimit,
  getClientKey,
  getRateLimitHeaders,
  getRetryAfterSeconds,
} from "$lib/server/rate-limit";
import {
  validateGameName,
  validatePlatform,
  validateTagLine,
} from "$lib/server/validation";

const DEFAULT_PAGE_LIMIT = 12;
const MAX_PAGE_LIMIT = 20;
// Upper bound for how many matches can be returned when requesting the
// current season in one shot (all=true). Kept separate from per-page limit
// so background filter enrichment can look at a larger sample without
// affecting infinite scroll behavior.
const MAX_SEASON_MATCHES = 400;

export async function GET({ url, request, getClientAddress }: RequestEvent) {
  const clientKey = getClientKey(request, getClientAddress);
  const limit = applyRateLimit({
    namespace: "api-summoner",
    key: clientKey,
    maxRequests: 45,
    windowMs: 60_000,
  });
  const rateLimitHeaders = getRateLimitHeaders(limit);

  if (!limit.allowed) {
    const retryAfterSeconds = getRetryAfterSeconds(limit.resetAt);
    return new Response("Too many requests. Please wait before searching again.", {
      status: 429,
      headers: {
        ...rateLimitHeaders,
        "Retry-After": String(retryAfterSeconds),
      },
    });
  }

  const validatedGameName = validateGameName(url.searchParams.get("gameName"));
  const validatedTagLine = validateTagLine(url.searchParams.get("tagLine"));
  const validatedPlatform = validatePlatform(url.searchParams.get("platform"));

  if (!validatedGameName.ok) {
    throw error(400, { message: validatedGameName.error });
  }
  if (!validatedTagLine.ok) {
    throw error(400, { message: validatedTagLine.error });
  }
  if (!validatedPlatform.ok) {
    throw error(400, { message: validatedPlatform.error });
  }

  const gameName = validatedGameName.value;
  const tagLine = validatedTagLine.value;
  const platform = validatedPlatform.value;
  const offsetRaw = parseInt(url.searchParams.get("offset") ?? "0", 10);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "", 10);
  const all = (url.searchParams.get("all") ?? "").toLowerCase() === "true";

  // Keep page responses compact for snappier infinite scroll while preserving
  // a hard upper bound for manual query overrides.
  const pageLimitBase = Number.isNaN(limitRaw) ? DEFAULT_PAGE_LIMIT : limitRaw;
  const pageLimit = Math.min(Math.max(pageLimitBase, 5), MAX_PAGE_LIMIT);

  // When requesting the full season window (all=true), allow a higher cap so
  // background filter enrichment can see a larger sample, while still
  // enforcing a hard safety ceiling.
  const requestedSeasonLimit = Number.isNaN(limitRaw)
    ? MAX_SEASON_MATCHES
    : limitRaw;
  const seasonLimit = Math.min(
    Math.max(requestedSeasonLimit, 10),
    MAX_SEASON_MATCHES,
  );
  const champion = url.searchParams.get("champion") ?? undefined;
  const opponentChampion =
    url.searchParams.get("opponentChampion") ?? undefined;

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
        seasonLimit,
      );
      const hasMore = matches.length >= seasonLimit;

      // Note: offset is intentionally ignored for all=true. This endpoint
      // returns up to seasonLimit matches for the current season in one shot,
      // with hasMore indicating whether the cap was reached.

      if (offsetRaw === 0) {
        const summoner = await getSummonerByPuuid(region, account.puuid);
        return json({
          summoner,
          matches,
          nextOffset: 0,
          hasMore,
        }, {
          headers: rateLimitHeaders,
        });
      }

      return json({ matches, nextOffset: 0, hasMore }, {
        headers: rateLimitHeaders,
      });
    }

    const page = await getFilteredMatchPage(
      region,
      account.puuid,
      Number.isNaN(offsetRaw) ? 0 : offsetRaw,
      pageLimit, // Use the limited value (max 20) for paging
      filters,
    );

    if (offsetRaw === 0) {
      const summoner = await getSummonerByPuuid(region, account.puuid);
      return json({
        summoner,
        matches: page.matches,
        nextOffset: page.nextOffset,
        hasMore: page.hasMore,
      }, {
        headers: rateLimitHeaders,
      });
    }

    return json({
      matches: page.matches,
      nextOffset: page.nextOffset,
      hasMore: page.hasMore,
    }, {
      headers: rateLimitHeaders,
    });
  } catch (err: any) {
    throw error(400, { message: err.message || "Failed to fetch profile" });
  }
}
