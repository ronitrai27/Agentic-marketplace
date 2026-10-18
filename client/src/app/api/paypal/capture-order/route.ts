import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, fetchAuthMutation } from "@/lib/auth-server";
import { capturePayPalOrder } from "@/lib/paypal";
import { api } from "../../../../../convex/_generated/api";

export async function POST(req: NextRequest) {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const orderId = body.orderId;

    if (!orderId) {
      return NextResponse.json(
        { error: "orderId is required." },
        { status: 400 },
      );
    }

    const captureData = await capturePayPalOrder(orderId);

    if (captureData.status !== "COMPLETED") {
      return NextResponse.json(
        { error: `Payment not completed. Status: ${captureData.status}` },
        { status: 400 },
      );
    }

    // Extract captured USD amount
    const capturedValue =
      captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ||
      captureData.purchase_units?.[0]?.amount?.value;

    const amountUsd = Number(capturedValue);
    if (isNaN(amountUsd) || amountUsd <= 0) {
      return NextResponse.json(
        { error: "Invalid payment capture value." },
        { status: 400 },
      );
    }

    // Convert to credits: 1 USD = 100 Credits
    const amountCredits = Math.round(amountUsd * 100);

    // Add credits to user in Convex
    await fetchAuthMutation(api.wallet.addCredits, {
      amountCredits,
      orderId,
    });

    return NextResponse.json({
      success: true,
      amountCredits,
      amountUsd,
      orderId,
    });
  } catch (err: any) {
    console.error("Error capturing PayPal order:", err);
    return NextResponse.json(
      { error: err.message || "Failed to capture payment." },
      { status: 500 },
    );
  }
}
