# Trading Buddy Mobile

This folder contains a React Native / Expo mobile app scaffold for Trading Buddy AI.

## Getting Started

1. Install dependencies:
   ```bash
   cd mobile
   pnpm install
   ```

2. Start the Expo development server:
   ```bash
   pnpm start
   ```

3. Run on a device or emulator:
   - `pnpm ios`
   - `pnpm android`
   - `pnpm web`

## Features

- Push notification registration via Expo push tokens
- Voice command surface for quick buy/sell and portfolio actions
- Wearable summary endpoint for quick P&L checks

## Backend Integration

The mobile app uses the backend endpoints exposed at:

- `/api/mobile/push/register`
- `/api/mobile/voice-command`
- `/api/mobile/watch-summary`

For local development, the mobile app is configured to communicate with `http://localhost:3000`.
