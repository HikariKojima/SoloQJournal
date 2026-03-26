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
  getFullProfile,
  getMatchSummaries,
  getSummonerByRiotId,
  getSummonerByPuuid,
} from "$lib/server/riot.service";

export async function GET({ url }: RequestEvent) {
  const gameName = url.searchParams.get("gameName");
  const tagLine = url.searchParams.get("tagLine");
  const platform = url.searchParams.get("platform") ?? "euw1";
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  if (!gameName || !tagLine) {
    throw error(400, {
      message: "Missing gameName or tagLine query parameters",
    });
  }

  try {
    // If offset is 0, return full profile; otherwise return just the new matches
    if (offset === 0) {
      const profile = await getFullProfile(gameName, tagLine, platform);
      return json(profile);
    } else {
      // Fetch only the new matches at the offset
      const account = await getSummonerByRiotId(gameName, tagLine, platform);
      const region = platform;
      const matches = await getMatchSummaries(
        region,
        account.puuid,
        offset,
        10,
      );
      return json({ matches });
    }
  } catch (err: any) {
    throw error(400, { message: err.message || "Failed to fetch profile" });
  }
}
