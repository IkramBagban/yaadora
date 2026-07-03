export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);

export const AUTH_TOKEN = process.env.EXPO_PUBLIC_AUTH_TOKEN ?? '';
