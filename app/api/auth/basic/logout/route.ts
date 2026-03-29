import { NextResponse } from "next/server";
import { BASIC_SESSION_COOKIE } from "@/lib/basic-auth";

function clearCookies(res: NextResponse) {
  res.cookies.set(BASIC_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set("neo_dev_user_id", "", { path: "/", maxAge: 0 });
  res.cookies.set("neo_dev_user_name", "", { path: "/", maxAge: 0 });
  res.cookies.set("neo_dev_user_email", "", { path: "/", maxAge: 0 });
}

export async function POST() {
  const res = NextResponse.json({ loggedOut: true });
  clearCookies(res);
  return res;
}

export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/auth", req.url));
  clearCookies(res);
  return res;
}
