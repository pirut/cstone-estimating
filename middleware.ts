import { NextResponse, type NextRequest } from "next/server";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const AUTH_HEADER = "authorization";
const ADMIN_BEARER_PREFIX = "bearer ";
const ADMIN_BASIC_PREFIX = "basic ";

export function middleware(request: NextRequest) {
  if (!ADMIN_TOKEN) {
    return NextResponse.next();
  }

  const authHeader = request.headers.get(AUTH_HEADER) ?? "";
  const lowerAuth = authHeader.toLowerCase();
  const token = lowerAuth.startsWith(ADMIN_BEARER_PREFIX)
    ? authHeader.slice(ADMIN_BEARER_PREFIX.length).trim()
    : authHeader.trim();

  if (token && token === ADMIN_TOKEN) {
    return NextResponse.next();
  }

  if (lowerAuth.startsWith(ADMIN_BASIC_PREFIX)) {
    const basicValue = authHeader.slice(ADMIN_BASIC_PREFIX.length).trim();
    const decoded = decodeBasic(basicValue);
    if (decoded) {
      const [, password] = decoded.split(":", 2);
      if (password === ADMIN_TOKEN) {
        return NextResponse.next();
      }
    }
  }

  if (request.nextUrl.pathname.startsWith("/admin")) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": "Basic" },
    });
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/library", "/api/template-config"],
};

function decodeBasic(value: string) {
  if (!value) return null;
  try {
    return atob(value);
  } catch {
    return null;
  }
}
