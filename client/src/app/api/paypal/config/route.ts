import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth-server";

export async function GET() {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "PayPal is not configured." },
      { status: 500 },
    );
  }

  return NextResponse.json({ clientId });
}
