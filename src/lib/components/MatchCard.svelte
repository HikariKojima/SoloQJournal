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
    playerPuuid,
    leagueEntry,
    onMatchSelect,
    hasReflection = false,
  }: {
    match: MatchSummaryResponse;
    history: MatchHistoryStats;
    playerPuuid: string;
    leagueEntry: LeagueEntry | null;
    onMatchSelect?: (match: MatchSummaryResponse) => void;
    hasReflection?: boolean;
  } = $props();

  let showCoaching = $state(false);
  let championImageFailed = $state(false);

  const csPerMin = $derived.by(() => {
    if (match.durationSeconds === 0) return 0;
    return (
      Math.round((match.stats.cs / (match.durationSeconds / 60)) * 10) / 10
    );
  });

  const kdaRatio = $derived.by(() => match.kda.ratio);

  const kdaQualityClass = $derived.by(() => {
    if (kdaRatio == null) return "match-kda--average";
    if (kdaRatio >= 3) return "match-kda--good";
    return "match-kda--average";
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

  const cardAccentClass = $derived.by(() =>
    match.result === "win"
      ? "match-card match-card--win"
      : "match-card match-card--loss",
  );

  const resultPillClass = $derived.by(() =>
    match.result === "win"
      ? "match-pill match-pill--win"
      : "match-pill match-pill--loss",
  );

  const itemSlots = $derived.by(() => {
    const items = match.items ?? [];
    const slots: Array<number | null> = [...items];
    while (slots.length < 7) {
      slots.push(null);
    }
    return slots.slice(0, 7);
  });
</script>

<div
  role="button"
  tabindex="0"
  class="match-card-wrapper cursor-pointer"
  onclick={(event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && target.closest(".match-card__coach-panel")) {
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
      <div class="match-card__reflection-chip">Reflection saved</div>
    {/if}

    <div class="match-card__left">
      <div class="match-card__avatar-stack">
        {#if championImageFailed}
          <div class="match-card__champion-fallback">
            {match.champion.slice(0, 2).toUpperCase()}
          </div>
        {:else}
          <div class="match-card__champion">
            <img
              src={championIcon(match.champion.replaceAll(" ", ""))}
              alt={match.champion}
              width="52"
              height="52"
              loading="lazy"
              onerror={() => {
                championImageFailed = true;
              }}
            />
          </div>
        {/if}

        {#if match.summonerSpells}
          <div class="match-card__spells">
            {#if match.summonerSpells.primary}
              <img
                src={summonerSpellIcon(match.summonerSpells.primary)}
                alt="Primary summoner spell"
                width="20"
                height="20"
                class="match-card__spell-icon"
                loading="lazy"
              />
            {/if}
            {#if match.summonerSpells.secondary}
              <img
                src={summonerSpellIcon(match.summonerSpells.secondary)}
                alt="Secondary summoner spell"
                width="20"
                height="20"
                class="match-card__spell-icon"
                loading="lazy"
              />
            {/if}
          </div>
        {/if}
      </div>

      <div class="match-card__body">
        <div class="match-card__title-row">
          <span class="match-card__champ-name">{match.champion}</span>
          <div class="match-card__meta">
            <span>{queueLabel}</span>
            <span class="match-card__dot"></span>
            <span>{formattedDuration}</span>
            <span class={resultPillClass}>{match.result.toUpperCase()}</span>
          </div>
        </div>

        <div class="match-card__items">
          {#each itemSlots as itemId, index (index)}
            <div class="match-card__item-slot">
              {#if itemId}
                <img
                  src={itemIcon(itemId)}
                  alt={"Item " + itemId}
                  width="26"
                  height="26"
                  loading="lazy"
                />
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>

    <div class="match-card__center">
      <div class="match-card__kda-line">
        {match.kda.kills} / {match.kda.deaths} / {match.kda.assists}
      </div>
      {#if kdaDisplay}
        <div class={`match-card__kda-ratio ${kdaQualityClass}`}>
          {kdaDisplay}
        </div>
      {/if}
    </div>

    <div class="match-card__right">
      <div>
        <p class="match-card__stat-label">CS/m</p>
        <p class="match-card__stat-value">{csPerMin.toFixed(1)}</p>
      </div>
      <div>
        <p class="match-card__stat-label">KP</p>
        <p class="match-card__stat-value">{kpDisplay}</p>
      </div>

      <button
        type="button"
        class="match-card__coach-btn"
        onclick={(event) => {
          event.stopPropagation();
          showCoaching = !showCoaching;
        }}
      >
        <Sparkles class="match-card__coach-btn-icon" />
        <span>AI Coach</span>
        <ChevronDown
          class={`match-card__coach-btn-icon transition-transform ${showCoaching ? "rotate-180" : ""}`}
        />
      </button>
    </div>
  </div>

  {#if showCoaching}
    <div
      aria-live="polite"
      class="match-card__coach-panel"
      transition:slide={{ duration: 150 }}
    >
      <button type="button" class="match-card__coach-cta">
        <Sparkles class="match-card__coach-cta-icon" />
        <span>Analyze this game</span>
      </button>

      <CoachingPanel {match} {history} {playerPuuid} {leagueEntry} />
    </div>
  {/if}
</div>
