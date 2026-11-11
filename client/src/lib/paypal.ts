const PAYPAL_API_BASE =
  process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";

const getClientId = () => process.env.PAYPAL_CLIENT_ID || "";
const getSecretKey = () =>
  process.env.PAYPAL_SECRET_KEY || process.env.PAYPAL_CLIENT_SECRET || "";

export async function getPayPalAccessToken(): Promise<string> {
  const clientId = getClientId();
  const secretKey = getSecretKey();

  if (!clientId || !secretKey) {
    throw new Error("PayPal API credentials are not configured.");
  }

  const auth = Buffer.from(`${clientId}:${secretKey}`).toString("base64");

  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("PayPal OAuth token error:", errorText);
    throw new Error(`Failed to authenticate with PayPal: ${res.statusText}`);
  }

  const data = await res.json();
  return data.access_token;
}

export async function createPayPalOrder(amount: number) {
  if (amount < 5.0) {
    throw new Error("Minimum top-up amount is $5.00 (500 credits).");
  }

  const token = await getPayPalAccessToken();

  const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value: amount.toFixed(2),
          },
          description: `Agent Marketplace Wallet Top-Up (${Math.round(amount * 100)} Credits)`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("PayPal Create Order error:", errorText);
    throw new Error("Failed to create PayPal order.");
  }

  return await res.json();
}

export async function capturePayPalOrder(orderId: string) {
  const token = await getPayPalAccessToken();

  const res = await fetch(
    `${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!res.ok) {
    const errorText = await res.text();
    console.error("PayPal Capture Order error:", errorText);
    throw new Error("Failed to capture PayPal order.");
  }

  return await res.json();
}

export async function createPayPalPayout(
  email: string,
  amount: number,
  note = "Wallet Withdrawal from Agent Marketplace",
) {
  const token = await getPayPalAccessToken();

  const batchId = `payout_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  const res = await fetch(`${PAYPAL_API_BASE}/v1/payments/payouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: batchId,
        email_subject: "Agent Marketplace Withdrawal Payout",
      },
      items: [
        {
          recipient_type: "EMAIL",
          amount: {
            value: amount.toFixed(2),
            currency: "USD",
          },
          receiver: email,
          note,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("PayPal Payout error:", errorText);
    throw new Error("Failed to process PayPal payout.");
  }

  return await res.json();
}
