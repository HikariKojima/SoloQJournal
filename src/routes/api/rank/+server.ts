import { error, json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { getRankedSoloEntry } from "$lib/server/riot.service";
import {
  applyRateLimit,
  getClientKey,
  getRateLimitHeaders,
  getRetryAfterSeconds,
} from "$lib/server/rate-limit";
import {
  validatePlatform,
  validatePuuid,
  validateSummonerId,
} from "$lib/server/validation";

export async function GET({ url, request, getClientAddress }: RequestEvent) {
  const clientKey = getClientKey(request, getClientAddress);
  const limit = applyRateLimit({
    namespace: "api-rank",
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

  const validatedPlatform = validatePlatform(url.searchParams.get("platform"));
  if (!validatedPlatform.ok) {
    throw error(400, { message: validatedPlatform.error });
  }

  const platform = validatedPlatform.value;
  const summonerId = url.searchParams.get("summonerId") ?? "";
  const puuid = url.searchParams.get("puuid") ?? "";
  const normalizedSummonerId = summonerId.trim();
  const normalizedPuuid = puuid.trim();

  if (!normalizedSummonerId && !normalizedPuuid) {
    throw error(400, {
      message: "Missing summonerId or puuid query parameters",
    });
  }

  if (normalizedSummonerId) {
    const validatedSummonerId = validateSummonerId(normalizedSummonerId);
    if (!validatedSummonerId.ok) {
      throw error(400, { message: validatedSummonerId.error });
    }
  }

  if (normalizedPuuid) {
    const validatedPuuid = validatePuuid(normalizedPuuid);
    if (!validatedPuuid.ok) {
      throw error(400, { message: validatedPuuid.error });
    }
  }

  try {
    const rankedSolo = await getRankedSoloEntry(
      platform,
      normalizedSummonerId,
      normalizedPuuid,
    );

    return json({ rankedSolo }, { headers: rateLimitHeaders });
  } catch (err: any) {
    throw error(400, {
      message: err?.message || "Failed to fetch rank data",
    });
  }
}
