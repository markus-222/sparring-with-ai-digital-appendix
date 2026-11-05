import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_ROUTES = ["/login", "/register"];

function isTokenValid(token: string): boolean {
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return typeof payload.exp === "number" && payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest): NextResponse {
  const cookie = request.cookies.get("access_token");
  const { pathname } = request.nextUrl;

  const isAuthRoute = AUTH_ROUTES.some((r) => pathname.startsWith(r));
  const isAuthenticated = !!cookie?.value && isTokenValid(cookie.value);

  if (!isAuthenticated && !isAuthRoute) {
    const loginUrl = new URL("/login", request.url);
    if (cookie?.value) loginUrl.searchParams.set("reason", "expired");
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthenticated && isAuthRoute) {
    return NextResponse.redirect(new URL("/projects", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
