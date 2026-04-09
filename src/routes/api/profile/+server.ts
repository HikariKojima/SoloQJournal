import { error, json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { getSummonerByPuuid, getSummonerByRiotId } from "$lib/server/riot.service";
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

export async function GET({ url, request, getClientAddress }: RequestEvent) {
  const clientKey = getClientKey(request, getClientAddress);
  const limit = applyRateLimit({
    namespace: "api-profile",
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

  try {
    const account = await getSummonerByRiotId(gameName, tagLine, platform);
    const summoner = await getSummonerByPuuid(platform, account.puuid);
    return json({ summoner }, { headers: rateLimitHeaders });
  } catch (err: any) {
    throw error(400, {
      message: err?.message || "Failed to fetch profile",
    });
  }
}
