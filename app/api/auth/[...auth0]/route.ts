import { handleAuth } from "@auth0/nextjs-auth0";

// Handles: /api/auth/login, /api/auth/callback, /api/auth/logout
export const GET = handleAuth();
