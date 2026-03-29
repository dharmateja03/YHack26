import { getSessionUser } from "@/lib/current-user";
import { getOrgContextForIdentity } from "@/lib/org";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const context = await getOrgContextForIdentity({
      userId: user.userId,
      email: user.email,
    });
    if (!context) {
      return Response.json({ org: null, me: null, members: [], invites: [] });
    }
    return Response.json(context);
  } catch (error: any) {
    if (error?.message === "db_unavailable") {
      return Response.json({ error: "Database unavailable, retry in a few seconds" }, { status: 503 });
    }
    return Response.json({ error: "Failed to load org" }, { status: 500 });
  }
}
