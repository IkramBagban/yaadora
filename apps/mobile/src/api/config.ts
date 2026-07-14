export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://34.63.51.172').replace(
  /\/+$/,
  '',
);

export const CLERK_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? 'pk_test_d2lyZWQtb3dsLTk3LmNsZXJrLmFjY291bnRzLmRldiQ';
