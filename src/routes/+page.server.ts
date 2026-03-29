/**
 * This is the server load function for the main page in SvelteKit.
 * The +page.server.ts file runs on the server for SSR, pre-fetching data to avoid client-side loading.
 * In SvelteKit, load functions in +page.server.ts populate the page's data prop for initial render.
 * Key concept: SSR improves performance and SEO by rendering with data; check query params for pre-fetching.
 * Example: Visiting /?gameName=Player&tagLine=NA1 loads profile data server-side for instant render.
 * 
 * PERFORMANCE NOTES:
 * - Only load the initial 5 matches for SSR (fast initial render)
 * - Client-side can load more matches on demand with pagination
 * - Timeline data is expensive - only fetch on detailed match views
 */

import type { PageServerLoad } from "./$types";
import { getFullProfile } from "$lib/server/riot.service";
import type { ProfileData } from "$lib/types";
import {
  fetchLatestDdragonVersion,
  getDdragonVersion,
} from "$lib/utils/ddragon";

export const load: PageServerLoad = async ({ url }) => {
  const gameName = url.searchParams.get("gameName");
  const tagLine = url.searchParams.get("tagLine");
  const platform = url.searchParams.get("platform") ?? "euw1";

  let profileData: ProfileData = null;
  
  // Fetch ddragon version in parallel with profile data
  const ddragonVersion = await fetchLatestDdragonVersion(fetch).catch(() =>
    getDdragonVersion(),
  );

  if (gameName && tagLine) {
    try {
      profileData = await getFullProfile(gameName, tagLine, platform);
    } catch (err) {
      console.error("Failed to pre-fetch profile:", err);
      // Return null on error, let client handle
    }
  }

  return { profileData, platform, ddragonVersion };
};
