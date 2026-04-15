import type { RequestHandler } from "@sveltejs/kit";
import { streamCoachingReview } from "$lib/server/gemini.service";
import type { CoachingPayload } from "$lib/server/gemini.service";
import {
  applyRateLimit,
  getClientKey,
  getRateLimitHeaders,
  getRetryAfterSeconds,
} from "$lib/server/rate-limit";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const requestStartMs = performance.now();

  const clientKey = getClientKey(request, getClientAddress);
  const limit = applyRateLimit({
    namespace: "coaching",
    key: clientKey,
    maxRequests: MAX_REQUESTS_PER_WINDOW,
    windowMs: WINDOW_MS,
  });

  const rateLimitHeaders = getRateLimitHeaders(limit);

  if (!limit.allowed) {
    const retryAfterSeconds = getRetryAfterSeconds(limit.resetAt);
    return new Response(
      "Too many coaching requests. Please wait a moment and try again.",
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
          ...rateLimitHeaders,
        },
      },
    );
  }

  const aiConsent = (request.headers.get("x-ai-consent") ?? "").toLowerCase();
  if (aiConsent !== "granted") {
    return new Response(
      "AI coaching requires explicit consent before sending match data to the coaching provider.",
      {
        status: 403,
        headers: rateLimitHeaders,
      },
    );
  }

  let payload: CoachingPayload;

  try {
    payload = await request.json();
  } catch (err) {
    return new Response("Invalid JSON body", { status: 400 });
  }

  try {
    const generator = streamCoachingReview(payload);
    const encoder = new TextEncoder();
    const firstChunkStartMs = performance.now();
    const first = await generator.next();
    const firstChunkElapsedMs = Math.round(performance.now() - firstChunkStartMs);

    console.info(
      `[COACHING][API_FIRST_CHUNK] firstChunkMs=${firstChunkElapsedMs} totalToFirstChunkMs=${Math.round(performance.now() - requestStartMs)}`,
    );

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        let streamedChunks = 0;
        try {
          if (!first.done && first.value) {
            streamedChunks += 1;
            controller.enqueue(encoder.encode(first.value));
          }

          for await (const piece of generator) {
            streamedChunks += 1;
            controller.enqueue(encoder.encode(piece));
          }
          controller.close();

          console.info(
            `[COACHING][API_STREAM_DONE] chunks=${streamedChunks} totalMs=${Math.round(performance.now() - requestStartMs)}`,
          );
        } catch (err) {
          console.error(
            `[COACHING][API_STREAM_ERROR] totalMs=${Math.round(performance.now() - requestStartMs)}`,
          );
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain",
        ...rateLimitHeaders,
      },
    });
  } catch (err: any) {
    console.error(
      `[COACHING][API_ERROR] totalMs=${Math.round(performance.now() - requestStartMs)} status=${typeof err?.status === "number" ? err.status : "unknown"}`,
    );

    const statusCode =
      typeof err?.status === "number" && err.status >= 400 && err.status <= 599
        ? err.status
        : 500;
    const reason =
      statusCode === 503
        ? "AI coaching is temporarily overloaded. Please try again in a few seconds."
        : statusCode === 429
          ? "AI coaching is rate-limited right now. Please retry shortly."
          : err?.message || "Failed to process coaching review";
    return new Response(reason, {
      status: statusCode,
      headers: rateLimitHeaders,
    });
  }
};
