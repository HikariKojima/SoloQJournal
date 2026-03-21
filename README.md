# League of Legends SoloQ Journal

A modern, responsive web application built with SvelteKit 5 for tracking League of Legends Solo Queue performance. Search summoners across multiple regions, view detailed match history, and save profiles for quick access.

## Features

- **Multi-Region Support**: Search summoners in EUW, NA, KR, JP, and BR regions
- **Real-time Match Data**: View recent Solo Queue matches with detailed statistics
- **Profile Management**: Save favorite summoners for quick access
- **Responsive Design**: Clean, dark-themed UI that works on all devices
- **Riot API Integration**: Official League of Legends data via Riot Games API

## Tech Stack

- **Framework**: SvelteKit 5 with Svelte 5 Runes
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Icons**: Lucide Svelte
- **Backend**: Riot Games API

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Riot Games API Key (get one at [Riot Developer Portal](https://developer.riotgames.com/))

### Installation

1. Clone the repository:

```bash
git clone https://github.com/HikariKojima/SoloQJournal.git
cd SoloQJournal
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the root directory and add your Riot API key:

```env
RIOT_API_KEY=your_api_key_here
```

4. Start the development server:

```bash
npm run dev
```

5. Open [http://localhost:5173](http://localhost:5173) in your browser

## Usage

1. **Select Region**: Choose your preferred region from the dropdown (EUW, NA, KR, JP, BR)
2. **Enter Summoner Details**:
   - Game Name: The summoner's username
   - Tag Line: Must start with # (e.g., #EUW1, #NA1)
3. **Search**: Click the search button to fetch summoner data
4. **Save Profile**: Save summoners to your profile list for quick access
5. **View Matches**: Browse recent Solo Queue matches with KDA, CS/min, and duration

## Project Structure

```
src/
├── lib/
│   ├── components/     # Reusable UI components
│   ├── server/         # Server-side utilities (Riot API)
│   ├── types.ts        # TypeScript type definitions
│   └── profile.svelte.ts # Profile store with localStorage
├── routes/
│   ├── api/summoner/   # API endpoint for summoner data
│   ├── +page.svelte    # Main application page
│   └── +page.server.ts # Server-side data loading
└── app.css             # Global styles
```

## API Integration

The app integrates with the Riot Games API to fetch:

- Summoner information (level, profile icon)
- Recent match history (last 10 Solo Queue games)
- Match details (champion, KDA, CS, duration, result)

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run check` - Type checking
- `npm run lint` - Code linting

### Environment Variables

Create a `.env` file with:

```env
RIOT_API_KEY=your_riot_api_key
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is for educational purposes. Please respect Riot Games' API terms of service.

## Acknowledgments

- [Riot Games](https://www.riotgames.com/) for providing the API
- [SvelteKit](https://svelte.dev/) for the amazing framework
- [Tailwind CSS](https://tailwindcss.com/) for the styling system

````

4. Start the development server:

```bash
npm run dev
````

5. Open [http://localhost:5173](http://localhost:5173) in your browser

## Usage

1. **Select Region**: Choose your preferred region from the dropdown (EUW, NA, KR, JP, BR)
2. **Enter Summoner Details**:
   - Game Name: The summoner's username
   - Tag Line: Must start with # (e.g., #EUW1, #NA1)
3. **Search**: Click the search button to fetch summoner data
4. **Save Profile**: Save summoners to your profile list for quick access
5. **View Matches**: Browse recent Solo Queue matches with KDA, CS/min, and duration

## Project Structure

```
src/
├── lib/
│   ├── components/     # Reusable UI components
│   ├── server/         # Server-side utilities (Riot API)
│   ├── types.ts        # TypeScript type definitions
│   └── profile.svelte.ts # Profile store with localStorage
├── routes/
│   ├── api/summoner/   # API endpoint for summoner data
│   ├── +page.svelte    # Main application page
│   └── +page.server.ts # Server-side data loading
└── app.css             # Global styles
```

## API Integration

The app integrates with the Riot Games API to fetch:

- Summoner information (level, profile icon)
- Recent match history (last 10 Solo Queue games)
- Match details (champion, KDA, CS, duration, result)

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run check` - Type checking
- `npm run lint` - Code linting

### Environment Variables

Create a `.env` file with:

```env
RIOT_API_KEY=your_riot_api_key
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is for educational purposes. Please respect Riot Games' API terms of service.

## Acknowledgments

- [Riot Games](https://www.riotgames.com/) for providing the API
- [SvelteKit](https://svelte.dev/) for the amazing framework
- [Tailwind CSS](https://tailwindcss.com/) for the styling system
  > > > > > > > master
