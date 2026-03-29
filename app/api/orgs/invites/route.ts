import { getSessionUser } from "@/lib/current-user";
import { createInviteForManager, createOrgForManager, resolveOrgMemberUserId } from "@/lib/org";

function deriveDefaultOrgName(email?: string): string {
  const seed = email?.split("@")[1]?.split(".")[0] ?? "team";
  return `${seed.charAt(0).toUpperCase()}${seed.slice(1)} Team`;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { daysValid?: number; maxUses?: number } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const resolvedUserId =
      (await resolveOrgMemberUserId({ userId: user.userId, email: user.email })) ||
      user.userId;
    const invite = await createInviteForManager({
      userId: resolvedUserId,
      daysValid: body.daysValid,
      maxUses: body.maxUses,
    });
    return Response.json({ invite });
  } catch (error: any) {
    const msg = error?.message ?? "unknown_error";
    if (msg === "db_unavailable") {
      return Response.json({ error: "Database unavailable, retry in a few seconds" }, { status: 503 });
    }
    if (msg === "no_org") {
      const resolvedUserId =
        (await resolveOrgMemberUserId({ userId: user.userId, email: user.email })) ||
        user.userId;
      await createOrgForManager({
        userId: resolvedUserId,
        name: user.name,
        email: user.email,
        orgName: deriveDefaultOrgName(user.email),
      });
      const invite = await createInviteForManager({
        userId: resolvedUserId,
        daysValid: body.daysValid,
        maxUses: body.maxUses,
      });
      return Response.json({ invite, bootstrappedOrg: true });
    }
    if (msg === "not_manager") return Response.json({ error: "Only managers can create invites" }, { status: 403 });
    return Response.json({ error: "Failed to create invite" }, { status: 500 });
  }
}
