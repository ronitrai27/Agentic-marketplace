import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, fetchAuthQuery, fetchAuthMutation } from "@/lib/auth-server";
import { createPayPalPayout } from "@/lib/paypal";
import { api } from "../../../../../convex/_generated/api";

export async function POST(req: NextRequest) {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const amountUsd = Number(body.amount);
    const paypalEmail = (body.paypalEmail || "").trim();

    if (!paypalEmail || !paypalEmail.includes("@")) {
      return NextResponse.json(
        { error: "A valid PayPal email address is required." },
        { status: 400 },
      );
    }

    if (isNaN(amountUsd) || amountUsd <= 0) {
      return NextResponse.json(
        { error: "Invalid withdrawal amount." },
        { status: 400 },
      );
    }

    const requestedCredits = Math.round(amountUsd * 100);

    // Verify wallet balance and platform rules
    const wallet = await fetchAuthQuery(api.wallet.getWallet, {});
    const withdrawableCredits = wallet?.withdrawableCredits ?? 0;

    if (requestedCredits > withdrawableCredits) {
      return NextResponse.json(
        {
          error: `Insufficient withdrawable balance. You can withdraw up to ${wallet.withdrawableCredits} credits ($${wallet.withdrawableUsd}) because the first $5.00 (500 credits) is reserved.`,
        },
        { status: 400 },
      );
    }

    // Process PayPal Payout to developer / user email
    const payoutResult = await createPayPalPayout(paypalEmail, amountUsd);
    const batchId =
      payoutResult.batch_header?.payout_batch_id || `batch_${Date.now()}`;

    // Deduct credits in Convex
    await fetchAuthMutation(api.wallet.deductCreditsForWithdrawal, {
      amountCredits: requestedCredits,
      payoutId: batchId,
    });

    return NextResponse.json({
      success: true,
      amountWithdrawnUsd: amountUsd,
      creditsDeducted: requestedCredits,
      batchId,
    });
  } catch (err: any) {
    console.error("Error processing withdrawal:", err);
    return NextResponse.json(
      { error: err.message || "Failed to process withdrawal." },
      { status: 500 },
    );
  }
}
