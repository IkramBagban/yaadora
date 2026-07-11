export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);

export const CLERK_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
