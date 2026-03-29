export async function GET() {
  return Response.json(
    { error: "Auth0 is not configured. Using local authentication." },
    { status: 204 }
  );
}
