import { handleAuth } from "@auth0/nextjs-auth0";

export const GET = handleAuth({
  onError(_req: Request, error: Error) {
    console.error("Auth error:", error);
    return Response.redirect(
      new URL("/login", process.env.AUTH0_BASE_URL ?? "http://localhost:3000")
    );
  },
});
