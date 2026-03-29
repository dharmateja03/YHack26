import { getSessionUser } from "@/lib/current-user";
import { createOrgForManager, createInviteForManager, resolveOrgMemberUserId } from "@/lib/org";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { orgName?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.orgName || !body.orgName.trim()) {
    return Response.json({ error: "orgName is required" }, { status: 400 });
  }

  try {
    const resolvedUserId =
      (await resolveOrgMemberUserId({ userId: user.userId, email: user.email })) ||
      user.userId;
    const context = await createOrgForManager({
      userId: resolvedUserId,
      name: user.name,
      email: user.email,
      orgName: body.orgName,
    });

    const invite = await createInviteForManager({ userId: resolvedUserId });
    return Response.json({
      ...context,
      firstInviteToken: invite.token,
    });
  } catch (error: any) {
    if (error?.message === "db_unavailable") {
      return Response.json({ error: "Database unavailable, retry in a few seconds" }, { status: 503 });
    }
    return Response.json({ error: "Failed to create org" }, { status: 500 });
  }
}
