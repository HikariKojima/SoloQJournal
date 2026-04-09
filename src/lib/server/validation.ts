const VALID_PLATFORMS = new Set([
  "na1",
  "br1",
  "eun1",
  "euw1",
  "jp1",
  "kr",
  "la1",
  "la2",
  "oc1",
  "tr1",
  "ru",
  "ph2",
  "sg2",
  "th2",
  "tw2",
  "vn2",
  "sa1",
]);

function hasControlChars(value: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(value);
}

export function validatePlatform(rawPlatform: string | null, fallback = "euw1") {
  const platform = (rawPlatform ?? fallback).trim().toLowerCase();
  if (!VALID_PLATFORMS.has(platform)) {
    return {
      ok: false as const,
      error: "Invalid platform value.",
    };
  }

  return {
    ok: true as const,
    value: platform,
  };
}

export function validateGameName(rawGameName: string | null) {
  const gameName = (rawGameName ?? "").trim();
  if (!gameName) {
    return { ok: false as const, error: "Missing gameName query parameter" };
  }
  if (gameName.length > 32 || hasControlChars(gameName)) {
    return { ok: false as const, error: "Invalid gameName format" };
  }

  return { ok: true as const, value: gameName };
}

export function validateTagLine(rawTagLine: string | null) {
  const tagLine = (rawTagLine ?? "").trim().replace(/^#/, "");
  if (!tagLine) {
    return { ok: false as const, error: "Missing tagLine query parameter" };
  }

  if (!/^[A-Za-z0-9]{2,10}$/.test(tagLine)) {
    return { ok: false as const, error: "Invalid tagLine format" };
  }

  return { ok: true as const, value: tagLine };
}

export function validatePuuid(rawPuuid: string | null) {
  const puuid = (rawPuuid ?? "").trim();
  if (!puuid) {
    return { ok: false as const, error: "Missing puuid query parameter" };
  }

  if (puuid.length < 40 || puuid.length > 128 || hasControlChars(puuid)) {
    return { ok: false as const, error: "Invalid puuid format" };
  }

  return { ok: true as const, value: puuid };
}

export function validateSummonerId(rawSummonerId: string | null) {
  const summonerId = (rawSummonerId ?? "").trim();
  if (!summonerId) {
    return { ok: false as const, error: "Missing summonerId query parameter" };
  }

  if (summonerId.length < 20 || summonerId.length > 120 || hasControlChars(summonerId)) {
    return { ok: false as const, error: "Invalid summonerId format" };
  }

  return { ok: true as const, value: summonerId };
}

export function validateMatchId(rawMatchId: string | null) {
  const matchId = (rawMatchId ?? "").trim().toUpperCase();
  if (!matchId) {
    return { ok: false as const, error: "Missing matchId query parameter" };
  }

  if (!/^[A-Z0-9_]{8,40}$/.test(matchId)) {
    return { ok: false as const, error: "Invalid matchId format" };
  }

  return { ok: true as const, value: matchId };
}
