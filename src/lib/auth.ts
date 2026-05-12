import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getSession, authenticateAgent, authenticateAdminApiKey, authenticateExtensionApiKey } from "./db/queries";

export type UserAuth = {
  type: "user";
  userId: string;
  email: string;
  displayName: string;
};

export type AgentAuth = {
  type: "agent";
  agentId: string;
  agentName: string;
};

export type ExtensionAuth = {
  type: "extension";
  extensionKeyId: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerDisplayName: string;
};

export type AuthContext = UserAuth | AgentAuth | ExtensionAuth;

type RouteContext = { params: Promise<Record<string, string>> };

type AuthHandler = (req: NextRequest, auth: AuthContext, ctx: RouteContext) => Promise<Response>;
type UserAuthHandler = (req: NextRequest, auth: UserAuth, ctx: RouteContext) => Promise<Response>;

async function getAuthFromRequest(req: NextRequest): Promise<AuthContext | null> {
  // Check for API key auth (agents or admin keys)
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.slice(7);

    const agent = authenticateAgent(apiKey);
    if (agent) {
      return { type: "agent", agentId: agent.id, agentName: agent.name };
    }

    // Admin API keys resolve to the creating user's identity
    const adminKey = authenticateAdminApiKey(apiKey);
    if (adminKey) {
      return { type: "user", userId: adminKey.created_by_user_id, email: adminKey.email, displayName: adminKey.display_name };
    }

    // Extension API keys — narrowly scoped. The route handler MUST verify the
    // request is for an extension-allowed path (we gate that via withExtensionAuth).
    if (apiKey.startsWith("hbr_ext_")) {
      const extKey = authenticateExtensionApiKey(apiKey);
      if (extKey) {
        return {
          type: "extension",
          extensionKeyId: extKey.id,
          ownerUserId: extKey.created_by_user_id,
          ownerEmail: extKey.email,
          ownerDisplayName: extKey.display_name,
        };
      }
    }

    return null;
  }

  // Check for session cookie auth (users)
  const sessionId = req.cookies.get("harbour_session")?.value;
  if (sessionId) {
    const session = getSession(sessionId);
    if (session) {
      return { type: "user", userId: session.userId, email: session.email, displayName: session.displayName };
    }
  }

  return null;
}

export function withAuth(handler: AuthHandler) {
  return async (req: NextRequest, ctx: RouteContext) => {
    const auth = await getAuthFromRequest(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(req, auth, ctx);
  };
}

// Gate for the extension's narrow surface (session-sync + /extension/* routes).
// Accepts an ExtensionAuth or a UserAuth (so the dashboard can hit these
// endpoints for testing). Rejects agent and unauthenticated callers.
type ExtensionAuthHandler = (req: NextRequest, auth: ExtensionAuth | UserAuth, ctx: RouteContext) => Promise<Response>;

export function withExtensionAuth(handler: ExtensionAuthHandler) {
  return async (req: NextRequest, ctx: RouteContext) => {
    const auth = await getAuthFromRequest(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (auth.type === "agent") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return handler(req, auth, ctx);
  };
}

export function withUserAuth(handler: UserAuthHandler) {
  return async (req: NextRequest, ctx: RouteContext) => {
    const auth = await getAuthFromRequest(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (auth.type !== "user") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return handler(req, auth, ctx);
  };
}

export async function getAuthFromCookies(): Promise<{ userId: string; email: string; displayName: string } | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("harbour_session")?.value;
  if (!sessionId) return null;
  const session = getSession(sessionId);
  if (!session) return null;
  return { userId: session.userId, email: session.email, displayName: session.displayName };
}

/** If caller is an agent, verify it owns the given agentId. Users pass through. Agentless runs (null agentId) allow any authenticated caller. */
export function requireAgentOwnership(auth: AuthContext, agentId: string | null): NextResponse | null {
  if (!agentId) return null;
  if (auth.type === "agent" && auth.agentId !== agentId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export function getActorFromAuth(auth: AuthContext): { actorType: string; actorId: string } {
  if (auth.type === "user") {
    return { actorType: "user", actorId: auth.userId };
  }
  if (auth.type === "extension") {
    return { actorType: "extension", actorId: auth.extensionKeyId };
  }
  return { actorType: "agent", actorId: auth.agentId };
}
