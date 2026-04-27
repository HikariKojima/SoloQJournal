<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { dev } from "$app/environment";
  import { injectAnalytics } from "@vercel/analytics/sveltekit";

  const ANALYTICS_CONSENT_KEY = "soloq:analytics-consent-v1";
  const AI_CONSENT_KEY = "soloq:ai-consent-v1";

  let { children } = $props();
  let showConsentBanner = $state(false);
  let analyticsInjected = false;

  function readConsent(key: string): "granted" | "denied" | null {
    if (typeof window === "undefined") return null;

    const value = localStorage.getItem(key);
    if (value === "granted" || value === "denied") {
      return value;
    }

    return null;
  }

  function writeConsent(key: string, value: "granted" | "denied") {
    if (typeof window === "undefined") return;
    localStorage.setItem(key, value);
  }

  function enableAnalytics() {
    if (analyticsInjected) return;
    injectAnalytics({ mode: dev ? "development" : "production" });
    analyticsInjected = true;
  }

  function acceptAllConsents() {
    writeConsent(ANALYTICS_CONSENT_KEY, "granted");
    writeConsent(AI_CONSENT_KEY, "granted");
    enableAnalytics();
    showConsentBanner = false;
  }

  function saveEssentialOnly() {
    writeConsent(ANALYTICS_CONSENT_KEY, "denied");
    showConsentBanner = false;
  }

  function openPrivacyPage() {
    if (typeof window === "undefined") return;
    window.location.href = "/privacy";
  }

  onMount(() => {
    const analyticsConsent = readConsent(ANALYTICS_CONSENT_KEY);
    if (analyticsConsent === "granted") {
      enableAnalytics();
    }

    showConsentBanner = analyticsConsent === null;
  });
</script>

<div class="min-h-screen flex flex-col">
  <div class="flex-1">
    {@render children()}
  </div>

  <footer class="border-t border-slate-800 bg-slate-950/85 px-4 py-4 text-xs text-slate-300">
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <p>Data source: Riot Games API and Data Dragon.</p>
      <nav class="flex flex-wrap items-center gap-4">
        <a class="hover:text-slate-100" href="/privacy">Privacy</a>
        <a class="hover:text-slate-100" href="/terms">Terms</a>
        <a class="hover:text-slate-100" href="/support">Support</a>
      </nav>
    </div>
    <p class="mx-auto mt-2 w-full max-w-6xl text-[11px] leading-relaxed text-slate-400">
      SoloQ Journal isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
    </p>
  </footer>
</div>

{#if showConsentBanner}
  <div class="fixed inset-x-0 bottom-3 z-70 mx-auto w-[min(96vw,860px)] rounded-xl border border-slate-700 bg-slate-950/95 p-4 shadow-[0_18px_45px_rgba(0,0,0,0.55)]">
    <p class="text-sm text-slate-100">
      This app can use analytics and AI coaching processing. Analytics are optional.
      AI coaching requires explicit consent before match data is sent to the coaching provider.
    </p>
    <div class="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        class="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500"
        onclick={acceptAllConsents}
      >
        Accept analytics and AI coaching
      </button>
      <button
        type="button"
        class="rounded-md border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800"
        onclick={saveEssentialOnly}
      >
        Keep essential only
      </button>
      <button
        type="button"
        class="rounded-md border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800"
        onclick={openPrivacyPage}
      >
        Review privacy details
      </button>
    </div>
  </div>
{/if}
