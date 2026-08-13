import { NextResponse } from "next/server";
import {
  fetchClickUpJson,
  getClickUpApiKey,
  getClickUpCredentialStatus
} from "@/lib/clickup";
import {
  deleteStoredClickUpApiKey,
  setStoredClickUpApiKey
} from "@/lib/app-settings";
import { getDatabase } from "@/lib/dashboard-state";

export const dynamic = "force-dynamic";

type ClickUpUserResponse = {
  user?: {
    username?: string;
    email?: string;
  };
};

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    return NextResponse.json(await getClickUpCredentialStatus(), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await readJsonBody(request);
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) {
      return NextResponse.json({ error: "ClickUp API key is required." }, { status: 400 });
    }

    setStoredClickUpApiKey(getDatabase(), apiKey);
    return NextResponse.json(await getClickUpCredentialStatus(), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    deleteStoredClickUpApiKey(getDatabase());
    return NextResponse.json(await getClickUpCredentialStatus(), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const apiKey = typeof body.apiKey === "string" && body.apiKey.trim()
      ? body.apiKey.trim()
      : await getClickUpApiKey();

    if (!apiKey) {
      return NextResponse.json({ error: "No ClickUp API key is configured." }, { status: 400 });
    }

    const result = await fetchClickUpJson<ClickUpUserResponse>("/user", new URLSearchParams(), apiKey);
    return NextResponse.json(
      {
        ok: true,
        user: result.user
          ? {
              username: result.user.username || "",
              email: result.user.email || ""
            }
          : null
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}
