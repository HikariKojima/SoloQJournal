import type { RequestHandler } from "@sveltejs/kit";
import { streamCoachingReview } from "$lib/server/gemini.service";
import type { CoachingPayload } from "$lib/server/gemini.service";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;
const rateLimitStore = new Map<string, RateLimitBucket>();

function getClientKey(request: Request, getClientAddress: (() => string) | undefined): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  if (getClientAddress) {
    try {
      return getClientAddress();
    } catch {
      // Ignore environments where client address is unavailable.
    }
  }

  return "unknown";
}

function applyRateLimit(key: string):
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; remaining: 0; resetAt: number } {
  const now = Date.now();
  const existing = rateLimitStore.get(key);

  if (!existing || now >= existing.resetAt) {
    const resetAt = now + WINDOW_MS;
    rateLimitStore.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: MAX_REQUESTS_PER_WINDOW - 1,
      resetAt,
    };
  }

  if (existing.count >= MAX_REQUESTS_PER_WINDOW) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: MAX_REQUESTS_PER_WINDOW - existing.count,
    resetAt: existing.resetAt,
  };
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const clientKey = getClientKey(request, getClientAddress);
  const limit = applyRateLimit(clientKey);

  if (!limit.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return new Response(
      "Too many coaching requests. Please wait a moment and try again.",
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
          "X-RateLimit-Limit": String(MAX_REQUESTS_PER_WINDOW),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.floor(limit.resetAt / 1000)),
        },
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
    const first = await generator.next();

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (!first.done && first.value) {
            controller.enqueue(encoder.encode(first.value));
          }

          for await (const piece of generator) {
            controller.enqueue(encoder.encode(piece));
          }
          controller.close();
        } catch (err) {
          console.error("Coaching stream failed:", err);
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain",
        "X-RateLimit-Limit": String(MAX_REQUESTS_PER_WINDOW),
        "X-RateLimit-Remaining": String(limit.remaining),
        "X-RateLimit-Reset": String(Math.floor(limit.resetAt / 1000)),
      },
    });
  } catch (err: any) {
    const reason = err?.message || "Failed to process coaching review";
    return new Response(reason, { status: 500 });
  }
};
