import { error, json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { getMatchDetails } from "$lib/server/riot.service";
import {
  applyRateLimit,
  getClientKey,
  getRateLimitHeaders,
  getRetryAfterSeconds,
} from "$lib/server/rate-limit";
import {
  validateMatchId,
  validatePlatform,
  validatePuuid,
} from "$lib/server/validation";

export async function GET({ url, request, getClientAddress }: RequestEvent) {
  const clientKey = getClientKey(request, getClientAddress);
  const limit = applyRateLimit({
    namespace: "api-match",
    key: clientKey,
    maxRequests: 60,
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

  const validatedMatchId = validateMatchId(url.searchParams.get("matchId"));
  const validatedPuuid = validatePuuid(url.searchParams.get("puuid"));
  const validatedPlatform = validatePlatform(url.searchParams.get("platform"));

  if (!validatedMatchId.ok) {
    throw error(400, { message: validatedMatchId.error });
  }
  if (!validatedPuuid.ok) {
    throw error(400, { message: validatedPuuid.error });
  }
  if (!validatedPlatform.ok) {
    throw error(400, { message: validatedPlatform.error });
  }

  const matchId = validatedMatchId.value;
  const puuid = validatedPuuid.value;
  const platform = validatedPlatform.value;

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
    }, {
      headers: rateLimitHeaders,
    });
  } catch (err: any) {
    throw error(400, {
      message: err?.message || "Failed to fetch match timeline stats",
    });
  }
}
