export function championIcon(name: string, version = "14.24.1"): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${name}.png`;
}

export function itemIcon(id: number, version = "14.24.1"): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${id}.png`;
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

export function summonerSpellIcon(id: number, version = "14.24.1"): string {
  const key = SUMMONER_SPELLS[id];
  if (!key) {
    return "";
  }
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${key}.png`;
}
