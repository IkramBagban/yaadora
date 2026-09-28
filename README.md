# Yaadora

Yaadora is a personal AI memory system. It keeps the original memory record intact and links derived facts back to their sources. Retrieval combines vector search, full-text search, and graph relationships; the aim is to answer with evidence or stay silent.

## What to look at

- **Provenance:** trace a derived fact back to the memory it came from.
- **Retrieval:** combine search methods instead of relying on one embedding match.
- **Proactivity:** gate when the system speaks in code, not just prompts.

The repository is a Bun/Turborepo workspace with an Expo mobile app (`apps/mobile`), a Bun API (`apps/server`), a background worker (`apps/worker`), and shared core and database packages. PostgreSQL with pgvector and Redis are defined in `docker-compose.yml`.

## Explore locally

These steps are derived from the repository configuration, not a verified end-to-end install. You will need Docker, Bun 1.3.x, a suitable Expo emulator or device, and your own authentication and AI-provider keys. Do not put real keys in source control.

```bash
git clone https://github.com/IkramBagban/yaadora.git
cd yaadora
bun install
cp .env.example .env
cp apps/mobile/.env.example apps/mobile/.env
docker compose up -d
```

Set the provider keys, embedding provider, and Clerk credentials described in `.env.example`. Set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in `apps/mobile/.env`; if using a physical phone, replace the local API URL with your computer's LAN address. Then run the database migration and development processes:

```bash
bun run --filter @repo/db migrate
bun run dev
```

The root `package.json` also defines `bun run seed` and `bun run eval` for local data and evaluation work. Some paths require configured providers and local bootstrap settings; read `.env.example` before using them. The app has not been verified here as a one-command public demo.

## Status

This is a public code repository, not a claim that Yaadora has a hosted, publicly accessible app. A short product walkthrough and screenshots can be added once reviewed.
