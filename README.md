# League of Legends SoloQ Journal

SoloQ Journal is a SvelteKit app for reviewing League match history and getting AI coaching based on real match stats plus recent historical trends.

## Features

- Multi-region summoner search (EUNE, EUW, NA, KR, JP, BR, OCE, RU, TR, LAN, LAS, SA)
- Saved profiles sidebar with quick re-open and delete
- Match history grouped by day with daily W/L badges
- Champion filter for match history
- Load-more pagination for older matches
- Detailed match cards with KDA, CS/min, KP, items, and summoner spells
- AI coaching review per match (streamed response)
- Coaching prompt tuned for one-off vs recurring patterns using historical counters
- Data confidence signal for coaching quality based on sample size + available stats
- Reflection modal for journaling match notes
- Reflection and saved profiles persisted in localStorage
- Tilt warning banner on active losing streak

## Tech Stack

- SvelteKit 5 + Svelte 5 runes
- TypeScript
- Tailwind CSS v4
- Lucide Svelte icons
- Riot Games API (match data)
- Gemini API via `@google/genai` (AI coaching)

## Project Structure

```text
src/
   lib/
      components/
         CoachingPanel.svelte
         MatchCard.svelte
      server/
         riot.service.ts
         gemini.service.ts
      utils/
         coaching.ts
         ddragon.ts
      profile.svelte.ts
      types.ts
   routes/
      +page.svelte
      +page.server.ts
      api/
         summoner/+server.ts
         coaching/+server.ts
```

## Local Setup

### Prerequisites

- Node.js 18+
- npm
- Riot API key
- Gemini API key

### Install

```bash
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
RIOT_API_KEY=your_riot_api_key
GEMINI_API_KEY=your_gemini_api_key
```

### Run

```bash
npm run dev
```

Open http://localhost:5173

## Scripts

- `npm run dev` - start dev server
- `npm run build` - production build
- `npm run preview` - preview production build
- `npm run check` - Svelte + TypeScript checks
- `npm run check:watch` - watch mode checks

## API Endpoints

- `GET /api/summoner`
  - Fetches summoner profile + matches
  - Supports `offset` for pagination
- `POST /api/coaching`
  - Accepts structured coaching payload
  - Streams plain-text coaching response
  - Includes app-level request throttling

## Deployment Notes

- Works on Vercel with current SvelteKit config (`adapter-auto`)
- Add `RIOT_API_KEY` and `GEMINI_API_KEY` in hosting env vars
- For small friend-only testing, current setup is sufficient
- For public launch, use proper Riot key type and stronger shared rate limiting

## Riot API Notes

- Development keys are temporary and expire frequently
- Keep keys server-side only (never expose in client code)
- Follow Riot policy before opening app publicly

## License

Educational project. Follow Riot and Google API terms when deploying.
