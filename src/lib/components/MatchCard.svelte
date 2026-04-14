<script lang="ts">
  import { Sparkles, ChevronDown } from "lucide-svelte";
  import { slide } from "svelte/transition";
  import CoachingPanel from "$lib/components/CoachingPanel.svelte";
  import type { MatchSummaryResponse } from "$lib/types";
  import type { LeagueEntry, MatchHistoryStats } from "$lib/utils/coaching";
  import {
    championIcon,
    itemIcon,
    summonerSpellIcon,
  } from "$lib/utils/ddragon";

  let {
    match,
    history,
    recentMatches = [],
    playerPuuid,
    leagueEntry,
    onMatchSelect,
    hasReflection = false,
    learningObjectives = [],
  }: {
    match: MatchSummaryResponse;
    history: MatchHistoryStats;
    recentMatches?: MatchSummaryResponse[];
    playerPuuid: string;
    leagueEntry: LeagueEntry | null;
    onMatchSelect?: (match: MatchSummaryResponse) => void;
    hasReflection?: boolean;
    learningObjectives?: string[];
  } = $props();

  let showCoaching = $state(false);
  let playerIconFailed = $state(false);
  let allyJunglerIconFailed = $state(false);
  let enemyIconFailed = $state(false);
  let enemyJunglerIconFailed = $state(false);

  const csPerMin = $derived.by(() => {
    if (match.durationSeconds === 0) return 0;
    return (
      Math.round((match.stats.cs / (match.durationSeconds / 60)) * 10) / 10
    );
  });

  const kdaRatio = $derived.by(() => match.kda.ratio);

  const hasGoodKda = $derived.by(() => {
    if (kdaRatio == null) return false;
    return kdaRatio >= 3;
  });

  const kdaDisplay = $derived.by(() => {
    if (kdaRatio == null) return null;
    return `${kdaRatio.toFixed(1)} KDA`;
  });

  const kpPercent = $derived.by(() => {
    if (!match.teamKills) return 0;
    const value =
      ((match.kda.kills + match.kda.assists) / match.teamKills) * 100;
    return Math.round(value * 10) / 10;
  });

  const kpDisplay = $derived.by(() => `${kpPercent.toFixed(1)}%`);

  const formattedDuration = $derived.by(() => {
    const minutes = Math.floor(match.durationSeconds / 60);
    const seconds = match.durationSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  });

  const queueLabel = $derived.by(() => {
    return "Ranked Solo/Duo";
  });

  const cardBaseClass =
    "relative flex items-center justify-between gap-8 rounded-[14px] border-l-[3px] border-tl-none border-bl-none bg-(--card-bg) px-[1.9rem] py-[1.35rem] pl-[1.65rem] shadow-[0_20px_40px_rgba(0,0,0,0.7)] transition-[background-color,transform,box-shadow] duration-150 ease-in hover:bg-(--card-bg-hover) hover:-translate-y-px hover:shadow-[0_24px_60px_rgba(0,0,0,0.9)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] max-md:flex-wrap max-md:items-start max-md:gap-3 max-md:px-3.5 max-md:py-3 max-md:pl-3.5";

  const resultPillBaseClass =
    "inline-flex items-center justify-center rounded-full px-[0.55rem] py-[0.1rem] text-[0.72rem] font-semibold uppercase tracking-[0.12em]";

  const championCircleBaseClass =
    "relative box-border aspect-square overflow-hidden rounded-full bg-[#1e2538]";

  const championImageClass =
    "h-full w-full rounded-full object-cover object-center block";

  const roleIconClass =
    "h-3.5 w-3.5 object-contain filter-[brightness(0)_invert(1)]";

  const playerFallbackClass =
    "absolute inset-0 flex items-center justify-center rounded-full bg-[#1e2538] text-[0.7rem] font-semibold text-(--text-primary)";

  const junglerFallbackClass =
    "absolute inset-0 flex items-center justify-center rounded-full bg-[#1e2538] text-[0.58rem] font-semibold text-(--text-primary)";

  const cardAccentClass = $derived.by(() =>
    match.result === "win"
      ? `${cardBaseClass} border-l-[#7c3aed]`
      : `${cardBaseClass} border-l-[#be185d]`,
  );

  const resultPillClass = $derived.by(() =>
    match.result === "win"
      ? `${resultPillBaseClass} bg-[var(--badge-win-bg)] text-[var(--badge-win-text)]`
      : `${resultPillBaseClass} bg-[var(--badge-loss-bg)] text-[var(--badge-loss-text)]`,
  );

  const itemSlots = $derived.by(() => {
    const items = match.items ?? [];
    const slots: Array<number | null> = [...items];
    while (slots.length < 7) {
      slots.push(null);
    }
    return slots.slice(0, 7);
  });

  function championDdragonUrl(champion: string): string {
    return championIcon(champion);
}

  function normalizePositionRole(value?: string | null): string | null {
    if (!value) return null;
    const role = value.toUpperCase();
    if (role === "TOP") return "top";
    if (role === "JUNGLE") return "jungle";
    if (role === "MIDDLE" || role === "MID") return "middle";
    if (role === "BOTTOM" || role === "BOT") return "bottom";
    if (role === "UTILITY" || role === "SUPPORT") return "utility";
    return null;
  }

  function roleIconUrl(value?: string | null): string | null {
    const normalized = normalizePositionRole(value);
    if (!normalized) return null;
    return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-${normalized}.png`;
  }

  const playerRoleIcon = $derived.by(() => roleIconUrl(match.playerPosition));
  const allyJunglerRoleIcon = $derived.by(() =>
    roleIconUrl(match.allyJungler?.position || "JUNGLE"),
  );
  const enemyRoleIcon = $derived.by(() =>
    roleIconUrl(match.laneOpponent?.position),
  );
  const enemyJunglerRoleIcon = $derived.by(() =>
    roleIconUrl(match.enemyJungler?.position || "JUNGLE"),
  );

  const allyRingClass = $derived.by(() =>
    match.result === "win"
      ? "shadow-[0_0_0_2px_#7c3aed]"
      : "shadow-[0_0_0_2px_#be185d]",
  );

  const enemyRingClass = $derived.by(() =>
    match.result === "win"
      ? "shadow-[0_0_0_2px_#be185d]"
      : "shadow-[0_0_0_2px_#7c3aed]",
  );
</script>

<div
  role="button"
  tabindex="0"
  class="flex flex-col gap-2 cursor-pointer"
  onclick={(event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && target.closest("[data-coach-panel]")) {
      return;
    }
    onMatchSelect?.(match);
  }}
  onkeydown={(event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      onMatchSelect?.(match);
      event.preventDefault();
    }
  }}
>
  <div class={cardAccentClass}>
    {#if hasReflection}
      <div class="absolute right-[1.1rem] top-[0.55rem] rounded-full bg-[rgba(22,163,74,0.18)] px-[0.6rem] py-[0.2rem] text-[0.7rem] font-medium text-[#bbf7d0]">Reflection saved</div>
    {/if}

    <div class="flex items-center gap-[1.1rem] max-md:w-full max-md:gap-2.5">
      <div class="flex items-start gap-1 max-md:gap-0">
        <div class="flex flex-col items-center gap-1">
          <div
            class={`${championCircleBaseClass} h-12.5 w-12.5 max-md:h-10 max-md:w-10 ${allyRingClass}`}
          >
            {#if playerIconFailed}
              <div class={playerFallbackClass}>
                {match.champion.slice(0, 2).toUpperCase()}
              </div>
            {:else}
              <img
                src={championDdragonUrl(match.champion)}
                alt={match.champion}
                width="44"
                height="44"
                loading="lazy"
                class={championImageClass}
                onerror={() => {
                  playerIconFailed = true;
                }}
              />
            {/if}
          </div>

          {#if playerRoleIcon}
            <img
              src={playerRoleIcon}
              alt="Player role"
              width="14"
              height="14"
              class={roleIconClass}
              loading="lazy"
            />
          {/if}
        </div>

        {#if match.allyJungler?.champion}
          <div class="-ml-1.5 flex flex-col items-center gap-1 max-md:-ml-2.5 max-md:mt-3.5">
            <div
              class={`${championCircleBaseClass} h-9.5 w-9.5 max-md:h-8 max-md:w-8 ${allyRingClass}`}
            >
              {#if allyJunglerIconFailed}
                <div class={junglerFallbackClass}>
                  {match.allyJungler.champion.slice(0, 2).toUpperCase()}
                </div>
              {:else}
                <img
                  src={championDdragonUrl(match.allyJungler.champion)}
                  alt={match.allyJungler.champion}
                  width="32"
                  height="32"
                  loading="lazy"
                  class={championImageClass}
                  onerror={() => {
                    allyJunglerIconFailed = true;
                  }}
                />
              {/if}
            </div>

            {#if allyJunglerRoleIcon}
              <img
                src={allyJunglerRoleIcon}
                alt="Allied teammate role"
                width="14"
                height="14"
                class={roleIconClass}
                loading="lazy"
              />
            {/if}
          </div>
        {/if}
      </div>

      {#if match.summonerSpells}
        <div class="flex flex-col gap-[0.3rem] max-md:gap-1">
          {#if match.summonerSpells.primary}
            <img
              src={summonerSpellIcon(match.summonerSpells.primary)}
              alt="Primary summoner spell"
              width="20"
              height="20"
              class="h-5 w-5 rounded border border-[rgba(15,23,42,0.9)] bg-[#050816] object-cover max-md:h-4.5 max-md:w-4.5"
              loading="lazy"
            />
          {/if}
          {#if match.summonerSpells.secondary}
            <img
              src={summonerSpellIcon(match.summonerSpells.secondary)}
              alt="Secondary summoner spell"
              width="20"
              height="20"
              class="h-5 w-5 rounded border border-[rgba(15,23,42,0.9)] bg-[#050816] object-cover max-md:h-4.5 max-md:w-4.5"
              loading="lazy"
            />
          {/if}
        </div>
      {/if}

      <div class="flex flex-col gap-[0.52rem]">
        <div class="flex flex-col gap-[0.32rem]">
          <span class="text-[0.9rem] font-semibold text-(--text-primary)">{match.champion}</span>
          <div class="flex items-center gap-[0.4rem] text-[0.78rem] text-(--text-muted)">
            <span>{queueLabel}</span>
            <span class="h-0.75 w-0.75 rounded-full bg-(--text-muted)"></span>
            <span>{formattedDuration}</span>
            <span class={resultPillClass}>{match.result.toUpperCase()}</span>
          </div>
        </div>

        <div class="mt-[0.4rem] flex items-center gap-[0.38rem]">
          {#each itemSlots as itemId, index (index)}
            <div class="h-6.5 w-6.5 overflow-hidden rounded-[5px] border border-[rgba(15,23,42,0.9)] bg-[#050816]">
              {#if itemId}
                <img
                  src={itemIcon(itemId)}
                  alt={"Item " + itemId}
                  width="26"
                  height="26"
                  loading="lazy"
                  class="h-full w-full object-cover block"
                />
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>

      <div class="flex min-w-25.5 flex-col items-center max-md:w-full max-md:min-w-0 max-md:items-start">
      <div class="text-[1.05rem] font-semibold">
        {match.kda.kills} / {match.kda.deaths} / {match.kda.assists}
      </div>
      {#if kdaDisplay}
        <div class={`mt-[0.2rem] text-[0.84rem] font-medium ${hasGoodKda ? "text-(--kda-good)" : "text-(--kda-avg)"}`}>
          {kdaDisplay}
        </div>
      {/if}
    </div>

    <div class="order-6 flex min-w-32 flex-col items-end gap-[0.42rem] max-md:w-full max-md:min-w-0 max-md:flex-row max-md:flex-wrap max-md:items-center max-md:justify-start max-md:gap-3">
      <div>
        <p class="text-[0.74rem] text-(--text-muted)">CS/m</p>
        <p class="text-[0.94rem] font-semibold">{csPerMin.toFixed(1)}</p>
      </div>
      <div>
        <p class="text-[0.74rem] text-(--text-muted)">KP</p>
        <p class="text-[0.94rem] font-semibold">{kpDisplay}</p>
      </div>

      <button
        type="button"
        class="mt-[0.45rem] inline-flex items-center gap-[0.45rem] rounded-full border border-[rgba(167,139,250,0.65)] bg-[radial-gradient(circle_at_top_left,rgba(129,140,248,0.26),rgba(15,23,42,0.98))] px-4 py-2 text-[0.8rem] font-semibold text-(--text-primary) shadow-[0_8px_24px_rgba(46,16,101,0.35)] transition-[background-color,border-color,transform,box-shadow] duration-150 ease-in hover:-translate-y-px hover:border-[rgba(196,181,253,0.9)] hover:shadow-[0_12px_28px_rgba(76,29,149,0.42)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(196,181,253,0.95)]"
        onclick={(event) => {
          event.stopPropagation();
          showCoaching = !showCoaching;
        }}
      >
        <Sparkles class="h-4 w-4" />
        <span>Get Coaching</span>
        <ChevronDown
          class={`h-4 w-4 transition-transform ${showCoaching ? "rotate-180" : ""}`}
        />
      </button>
    </div>

    <div class="order-5 flex min-w-24.5 flex-col items-center gap-[0.35rem] max-md:min-w-0 max-md:items-start">
      <span class="text-[11px] uppercase leading-none tracking-[0.08em] text-slate-50">VS</span>
      <div class="flex items-start gap-1.5 max-md:gap-0">
        {#if match.laneOpponent?.champion}
          <div class="flex flex-col items-center gap-1">
            <div
              class={`${championCircleBaseClass} h-12.5 w-12.5 max-md:h-10 max-md:w-10 ${enemyRingClass}`}
            >
              {#if enemyIconFailed}
                <div class={playerFallbackClass}>
                  {match.laneOpponent.champion.slice(0, 2).toUpperCase()}
                </div>
              {:else}
                <img
                  src={championDdragonUrl(match.laneOpponent.champion)}
                  alt={match.laneOpponent.champion}
                  width="44"
                  height="44"
                  loading="lazy"
                  class={championImageClass}
                  onerror={() => {
                    enemyIconFailed = true;
                  }}
                />
              {/if}
            </div>

            {#if enemyRoleIcon}
              <img
                src={enemyRoleIcon}
                alt="Enemy role"
                width="14"
                height="14"
                class={roleIconClass}
                loading="lazy"
              />
            {/if}
          </div>
        {/if}

        {#if match.enemyJungler?.champion}
          <div class="-ml-1.5 flex flex-col items-center gap-1 max-md:-ml-2.5 max-md:mt-3.5">
            <div
              class={`${championCircleBaseClass} h-9.5 w-9.5 max-md:h-8 max-md:w-8 ${enemyRingClass}`}
            >
              {#if enemyJunglerIconFailed}
                <div class={junglerFallbackClass}>
                  {match.enemyJungler.champion.slice(0, 2).toUpperCase()}
                </div>
              {:else}
                <img
                  src={championDdragonUrl(match.enemyJungler.champion)}
                  alt={match.enemyJungler.champion}
                  width="32"
                  height="32"
                  loading="lazy"
                  class={championImageClass}
                  onerror={() => {
                    enemyJunglerIconFailed = true;
                  }}
                />
              {/if}
            </div>

            {#if enemyJunglerRoleIcon}
              <img
                src={enemyJunglerRoleIcon}
                alt="Enemy jungler role"
                width="14"
                height="14"
                class={roleIconClass}
                loading="lazy"
              />
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>

  {#if showCoaching}
    <div
      aria-live="polite"
      data-coach-panel="true"
      class="rounded-xl border border-[rgba(15,23,42,0.9)] bg-[#020617] px-[1.05rem] py-[0.9rem]"
      transition:slide={{ duration: 150 }}
    >
      <CoachingPanel {match} {history} {recentMatches} {playerPuuid} {leagueEntry} {learningObjectives} />
    </div>
  {/if}
</div>
