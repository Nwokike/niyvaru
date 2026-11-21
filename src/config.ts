const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export const API_BASE = apiBase.replace(/\/$/, "");

export const DIRECT_MODE = API_BASE === "";

export const GATEWAY_URL = (
  (import.meta.env.VITE_GATEWAY_URL as string | undefined) ?? "https://api.kiri.ng"
).replace(/\/$/, "");

export const GATEWAY_KEY =
  (import.meta.env.VITE_GATEWAY_KEY as string | undefined) || "mobile-v1";
