import { getSessionUser } from "@/lib/current-user";
import { createOrgForManager, resolveOrgMemberUserId, updateMyMemberProfile, MemberAvailability } from "@/lib/org";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    name?: string;
    workEmail?: string;
    skills?: string[];
    timezone?: string;
    availability?: MemberAvailability;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const resolvedUserId =
      (await resolveOrgMemberUserId({ userId: user.userId, email: user.email })) ||
      user.userId;
    const updated = await updateMyMemberProfile({
      userId: resolvedUserId,
      name: body.name,
      workEmail: body.workEmail,
      skills: body.skills,
      timezone: body.timezone,
      availability: body.availability,
    });

    if (updated) return Response.json({ member: updated });

    // Bootstrap path: if user has no org yet, create one as manager then persist profile.
    const orgNameSeed =
      body.workEmail?.split("@")[1]?.split(".")[0] ??
      user.email?.split("@")[1]?.split(".")[0] ??
      "neosis";
    const orgName = `${orgNameSeed.charAt(0).toUpperCase()}${orgNameSeed.slice(1)} Team`;

    await createOrgForManager({
      userId: resolvedUserId,
      name: user.name,
      email: user.email,
      orgName,
    });

    const createdAndUpdated = await updateMyMemberProfile({
      userId: resolvedUserId,
      name: body.name ?? user.name,
      workEmail: body.workEmail,
    });

    if (!createdAndUpdated) {
      return Response.json({ error: "Unable to save profile" }, { status: 500 });
    }

    return Response.json({ member: createdAndUpdated, bootstrappedOrg: true });
  } catch (error: any) {
    if (error?.message === "db_unavailable") {
      return Response.json({ error: "Database unavailable, retry in a few seconds" }, { status: 503 });
    }
    return Response.json({ error: "Unable to save profile" }, { status: 500 });
  }
}
