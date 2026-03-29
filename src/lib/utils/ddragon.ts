export const DDRAGON_FALLBACK_VERSION = "16.6.1";

let ddragonVersion = DDRAGON_FALLBACK_VERSION;
let ddragonVersionRequest: Promise<string> | null = null;

function isValidDdragonVersion(version: unknown): version is string {
  return typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version);
}

export function getDdragonVersion(): string {
  return ddragonVersion;
}

export function setDdragonVersion(version: unknown): string {
  if (isValidDdragonVersion(version)) {
    ddragonVersion = version;
  }
  return ddragonVersion;
}

export async function fetchLatestDdragonVersion(
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (ddragonVersionRequest) {
    return ddragonVersionRequest;
  }

  ddragonVersionRequest = (async () => {
    try {
      const response = await fetcher(
        "https://ddragon.leagueoflegends.com/api/versions.json",
      );
      if (!response.ok) {
        return ddragonVersion;
      }

      const versions: unknown = await response.json();
      if (!Array.isArray(versions) || versions.length === 0) {
        return ddragonVersion;
      }

      return setDdragonVersion(versions[0]);
    } catch {
      return ddragonVersion;
    } finally {
      ddragonVersionRequest = null;
    }
  })();

  return ddragonVersionRequest;
}

const CHAMPION_KEY_ALIASES: Record<string, string> = {
  fiddlesticks: "Fiddlesticks",
  fiddlesticksold: "Fiddlesticks",
  fiddlesticksrework: "Fiddlesticks",
  fiddlestick: "Fiddlesticks",
  monkeyking: "MonkeyKing",
  wukong: "MonkeyKing",
  nunu: "Nunu",
  nunuwillump: "Nunu",
  renata: "RenataGlasc",
  renataglasc: "RenataGlasc",
};

function toChampionDataDragonKey(name: string): string {
  const compact = name.replace(/[^A-Za-z0-9]/g, "");
  const alias = CHAMPION_KEY_ALIASES[compact.toLowerCase()];
  return alias ?? compact;
}

export function championIcon(name: string, version = getDdragonVersion()): string {
  const championKey = toChampionDataDragonKey(name);
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championKey}.png`;
}

export function itemIcon(id: number, version = getDdragonVersion()): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${id}.png`;
}

export function profileIcon(id: number, version = getDdragonVersion()): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${id}.png`;
}

const SUMMONER_SPELLS: Record<number, string> = {
  1: "SummonerBoost", // Cleanse
  3: "SummonerExhaust",
  4: "SummonerFlash",
  6: "SummonerHaste", // Ghost
  7: "SummonerHeal",
  11: "SummonerSmite",
  12: "SummonerTeleport",
  13: "SummonerMana", // Clarity (ARAM)
  14: "SummonerDot", // Ignite
  21: "SummonerBarrier",
  30: "SummonerPoroRecall",
  31: "SummonerPoroThrow",
  32: "SummonerSnowball", // Mark/Dash (ARAM)
  39: "SummonerSnowURFSnowball_Mark", // URF Mark
};

export function summonerSpellIcon(id: number, version = getDdragonVersion()): string {
  const key = SUMMONER_SPELLS[id];
  if (!key) {
    return "";
  }
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${key}.png`;
}
