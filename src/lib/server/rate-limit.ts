type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type ClientAddressGetter = (() => string) | undefined;

type RateLimitResult =
  | {
      allowed: true;
      remaining: number;
      resetAt: number;
      limit: number;
    }
  | {
      allowed: false;
      remaining: 0;
      resetAt: number;
      limit: number;
    };

const routeRateLimitStore = new Map<string, Map<string, RateLimitBucket>>();

export function getClientKey(
  request: Request,
  getClientAddress: ClientAddressGetter,
): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  if (getClientAddress) {
    try {
      return getClientAddress();
    } catch {
      // Some hosts do not expose client address.
    }
  }

  return "unknown";
}

export function applyRateLimit(options: {
  namespace: string;
  key: string;
  maxRequests: number;
  windowMs: number;
}): RateLimitResult {
  const now = Date.now();
  const namespaceStore =
    routeRateLimitStore.get(options.namespace) ?? new Map<string, RateLimitBucket>();

  if (!routeRateLimitStore.has(options.namespace)) {
    routeRateLimitStore.set(options.namespace, namespaceStore);
  }

  const existing = namespaceStore.get(options.key);

  if (!existing || now >= existing.resetAt) {
    const resetAt = now + options.windowMs;
    namespaceStore.set(options.key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: Math.max(0, options.maxRequests - 1),
      resetAt,
      limit: options.maxRequests,
    };
  }

  if (existing.count >= options.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      limit: options.maxRequests,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, options.maxRequests - existing.count),
    resetAt: existing.resetAt,
    limit: options.maxRequests,
  };
}

export function getRateLimitHeaders(result: {
  limit: number;
  remaining: number;
  resetAt: number;
}): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.floor(result.resetAt / 1000)),
  };
}

export function getRetryAfterSeconds(resetAt: number): number {
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
}
