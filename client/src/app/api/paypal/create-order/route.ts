import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth-server";
import { createPayPalOrder } from "@/lib/paypal";

export async function POST(req: NextRequest) {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const amount = Number(body.amount);

    if (isNaN(amount) || amount < 5.0) {
      return NextResponse.json(
        { error: "Minimum top-up is $5.00 (500 credits)." },
        { status: 400 },
      );
    }

    const order = await createPayPalOrder(amount);
    return NextResponse.json({ id: order.id });
  } catch (err: any) {
    console.error("Error creating PayPal order:", err);
    return NextResponse.json(
      { error: err.message || "Failed to create order." },
      { status: 500 },
    );
  }
}
