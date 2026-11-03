import { toNextJsHandler } from "better-auth/next-js";
import { authConfigured, getAuth } from "@/lib/auth/server";

const notConfigured = () =>
  Response.json({ error: { message: "Sign-in is not configured yet." } }, { status: 503 });

export async function GET(request: Request) {
  if (!authConfigured()) return notConfigured();
  return toNextJsHandler(getAuth()).GET(request);
}
export async function POST(request: Request) {
  if (!authConfigured()) return notConfigured();
  return toNextJsHandler(getAuth()).POST(request);
}
