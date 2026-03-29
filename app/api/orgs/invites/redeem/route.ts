import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/current-user";
import { redeemInvite, resolveOrgMemberUserId, updateMyMemberProfile } from "@/lib/org";

function isValidEmail(value?: string): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(req: NextRequest) {
  let body: { token?: string; userId?: string; name?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.token || !body.token.trim()) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const session = await getSessionUser();
  const isAuthenticatedSession = session?.source === "basic" || session?.source === "master";
  const resolvedSessionUserId =
    isAuthenticatedSession && session?.userId
      ? await resolveOrgMemberUserId({
          userId: session.userId,
          email: session.email,
        })
      : undefined;

  const fallbackUserId = `guest_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const providedUserId = typeof body.userId === "string" ? body.userId.trim() : "";
  const userId = (isAuthenticatedSession
    ? resolvedSessionUserId || session?.userId
    : providedUserId || session?.userId || fallbackUserId) as string;
  const name = isAuthenticatedSession ? session?.name : body.name?.trim() || session?.name || "Guest Member";
  const email = (isAuthenticatedSession ? session?.email : body.email?.trim().toLowerCase() || session?.email)?.trim().toLowerCase();

  if (!isAuthenticatedSession && !isValidEmail(email)) {
    return NextResponse.json({ error: "Valid email is required to join via invite link" }, { status: 400 });
  }

  try {
    const context = await redeemInvite({
      token: body.token,
      userId,
      name,
      email,
    });
    if (email) {
      await updateMyMemberProfile({ userId, name, workEmail: email });
    }

    const res = NextResponse.json(context);
    if (!isAuthenticatedSession) {
      res.cookies.set("neo_dev_user_id", userId, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
      if (name) {
        res.cookies.set("neo_dev_user_name", name, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
      }
      if (email) {
        res.cookies.set("neo_dev_user_email", email, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
      }
    }
    return res;
  } catch (error: any) {
    const msg = error?.message ?? "join_failed";
    if (msg === "db_unavailable") {
      return NextResponse.json({ error: "Database unavailable, retry in a few seconds" }, { status: 503 });
    }
    if (msg === "invite_not_found") return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    if (msg === "invite_expired") return NextResponse.json({ error: "Invite expired" }, { status: 410 });
    if (msg === "invite_maxed") return NextResponse.json({ error: "Invite usage limit reached" }, { status: 409 });
    return NextResponse.json({ error: "Failed to join org" }, { status: 500 });
  }
}
