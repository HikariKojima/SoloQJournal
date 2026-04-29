<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { dev } from "$app/environment";
  import { injectAnalytics } from "@vercel/analytics/sveltekit";

  const ANALYTICS_CONSENT_KEY = "soloq:analytics-consent-v1";
  const AI_CONSENT_KEY = "soloq:ai-consent-v1";
  const THEME_PREFERENCE_KEY = "soloq:theme-preference-v1";

  type ThemePreference = "system" | "light" | "dark";
  type ResolvedTheme = "light" | "dark";

  let { children } = $props();
  let showConsentBanner = $state(false);
  let analyticsInjected = false;
  let themePreference = $state<ThemePreference>("system");

  let systemThemeMedia: MediaQueryList | null = null;

  const themeOptions: Array<{ value: ThemePreference; label: string }> = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

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

  function resolveTheme(preference: ThemePreference): ResolvedTheme {
    if (preference === "light" || preference === "dark") {
      return preference;
    }

    if (systemThemeMedia?.matches) {
      return "dark";
    }

    return "light";
  }

  function applyResolvedTheme(theme: ResolvedTheme) {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = theme;
  }

  function detachSystemListener() {
    if (!systemThemeMedia) return;
    systemThemeMedia.removeEventListener("change", onSystemThemeChange);
  }

  function onSystemThemeChange() {
    if (themePreference !== "system") return;
    applyResolvedTheme(resolveTheme("system"));
  }

  function syncTheme() {
    applyResolvedTheme(resolveTheme(themePreference));

    detachSystemListener();
    if (themePreference === "system" && systemThemeMedia) {
      systemThemeMedia.addEventListener("change", onSystemThemeChange);
    }
  }

  function setThemePreference(preference: ThemePreference) {
    themePreference = preference;

    if (typeof window !== "undefined") {
      localStorage.setItem(THEME_PREFERENCE_KEY, preference);
    }

    syncTheme();
  }

  onMount(() => {
    const analyticsConsent = readConsent(ANALYTICS_CONSENT_KEY);
    if (analyticsConsent === "granted") {
      enableAnalytics();
    }

    showConsentBanner = analyticsConsent === null;

    systemThemeMedia = window.matchMedia("(prefers-color-scheme: dark)");

    const storedThemePreference = localStorage.getItem(THEME_PREFERENCE_KEY);
    if (
      storedThemePreference === "light" ||
      storedThemePreference === "dark" ||
      storedThemePreference === "system"
    ) {
      themePreference = storedThemePreference;
    }

    syncTheme();

    return () => {
      detachSystemListener();
    };
  });
</script>

<div class="min-h-screen flex flex-col bg-(--page-bg) text-(--text-primary)">
  <header class="sticky top-0 z-60 border-b border-(--border) bg-(--card-bg)/90 px-4 py-3 backdrop-blur-sm">
    <div class="flex w-full items-center justify-between gap-3">
      <p class="text-lg font-semibold tracking-[0.08em] text-(--text-primary) md:text-xl">SoloQ Journal</p>
      <div class="inline-flex items-center gap-2 rounded-full border border-(--border) bg-(--background) p-1">
        {#each themeOptions as option (option.value)}
          <button
            type="button"
            class={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              themePreference === option.value
                ? "bg-(--primary) text-(--primary-foreground)"
                : "text-(--text-muted) hover:bg-(--card-bg-hover) hover:text-(--text-primary)"
            }`}
            onclick={() => setThemePreference(option.value)}
            aria-pressed={themePreference === option.value}
          >
            {option.label}
          </button>
        {/each}
      </div>
    </div>
  </header>

  <div class="flex-1">
    {@render children()}
  </div>

  <footer class="border-t border-(--border) bg-(--card-bg)/90 px-4 py-4 text-xs text-(--text-muted)">
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <p>Data source: Riot Games API and Data Dragon.</p>
      <nav class="flex flex-wrap items-center gap-4">
        <a class="hover:text-(--text-primary)" href="/privacy">Privacy</a>
        <a class="hover:text-(--text-primary)" href="/terms">Terms</a>
        <a class="hover:text-(--text-primary)" href="/support">Support</a>
      </nav>
    </div>
    <p class="mx-auto mt-2 w-full max-w-6xl text-[11px] leading-relaxed text-(--text-muted)">
      SoloQ Journal isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
    </p>
  </footer>
</div>

{#if showConsentBanner}
  <div class="fixed inset-x-0 bottom-3 z-70 mx-auto w-[min(96vw,860px)] rounded-xl border border-(--border) bg-(--card-bg)/95 p-4 shadow-[0_18px_45px_rgba(0,0,0,0.35)]">
    <p class="text-sm text-(--text-primary)">
      This app can use analytics and AI coaching processing. Analytics are optional.
      AI coaching requires explicit consent before match data is sent to the coaching provider.
    </p>
    <div class="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        class="rounded-md bg-(--primary) px-3 py-2 text-sm font-semibold text-(--primary-foreground) hover:brightness-110"
        onclick={acceptAllConsents}
      >
        Accept analytics and AI coaching
      </button>
      <button
        type="button"
        class="rounded-md border border-(--border) px-3 py-2 text-sm font-semibold text-(--text-primary) hover:bg-(--card-bg-hover)"
        onclick={saveEssentialOnly}
      >
        Keep essential only
      </button>
      <button
        type="button"
        class="rounded-md border border-(--border) px-3 py-2 text-sm font-semibold text-(--text-primary) hover:bg-(--card-bg-hover)"
        onclick={openPrivacyPage}
      >
        Review privacy details
      </button>
    </div>
  </div>
{/if}
