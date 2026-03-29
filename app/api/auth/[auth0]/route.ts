import { handleAuth } from "@auth0/nextjs-auth0";

function stripTrailingSlash(value: string | undefined): string | undefined {
  return value ? value.replace(/\/+$/, "") : value;
}

// Auth0 SDK is strict about URL formats; normalize common local env values.
process.env.AUTH0_BASE_URL = stripTrailingSlash(process.env.AUTH0_BASE_URL);
process.env.AUTH0_ISSUER_BASE_URL = stripTrailingSlash(process.env.AUTH0_ISSUER_BASE_URL);

const auth = handleAuth();

// Handles: /api/auth/login, /api/auth/callback, /api/auth/logout, /api/auth/me
export async function GET(req: Request, context: { params: { auth0: string } }) {
  try {
    const requestOrigin = new URL(req.url).origin;
    const baseUrl = process.env.AUTH0_BASE_URL;
    if (!baseUrl) {
      process.env.AUTH0_BASE_URL = requestOrigin;
    } else if (baseUrl.includes("localhost") && baseUrl !== requestOrigin) {
      // Keep local dev resilient if Next picks 3001/3002 instead of 3000.
      process.env.AUTH0_BASE_URL = requestOrigin;
    }
    return await auth(req as never, context as never);
  } catch (error) {
    console.error("Auth0 route error:", error);
    return Response.json(
      {
        error: "Auth0 route failed",
        hint: "Verify AUTH0_BASE_URL, AUTH0_ISSUER_BASE_URL, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET",
      },
      { status: 500 }
    );
  }
}
