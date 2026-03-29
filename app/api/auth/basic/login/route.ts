import { NextRequest, NextResponse } from "next/server";
import {
  BASIC_SESSION_COOKIE,
  createBasicSessionToken,
  loginBasicUser,
} from "@/lib/basic-auth";
import { redeemInvite, updateMyMemberProfile } from "@/lib/org";

export async function POST(req: NextRequest) {
  let body: {
    email?: string;
    password?: string;
    inviteToken?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const user = await loginBasicUser({
      email: body.email ?? "",
      password: body.password ?? "",
    });

    const token = createBasicSessionToken(user);
    const resBody: Record<string, unknown> = { user };

    if (body.inviteToken?.trim()) {
      const context = await redeemInvite({
        token: body.inviteToken.trim(),
        userId: user.userId,
        name: user.name,
        email: user.email,
      });
      await updateMyMemberProfile({
        userId: user.userId,
        name: user.name,
        workEmail: user.email,
      });
      resBody.joined = true;
      resBody.org = context.org;
    }

    const res = NextResponse.json(resBody);
    res.cookies.set(BASIC_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (error: any) {
    const msg = error?.message ?? "login_failed";
    if (msg === "invalid_credentials") return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    if (msg === "invite_not_found") return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    if (msg === "invite_expired") return NextResponse.json({ error: "Invite expired" }, { status: 410 });
    if (msg === "invite_maxed") return NextResponse.json({ error: "Invite usage limit reached" }, { status: 409 });
    if (msg === "db_unavailable") {
      return NextResponse.json({ error: "Database unavailable, retry in a few seconds" }, { status: 503 });
    }
    return NextResponse.json({ error: "Failed to login" }, { status: 500 });
  }
}
