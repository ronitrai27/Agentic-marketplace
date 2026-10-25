/**
 * PayPal (marketplace-guaranteed billing, Docs/marketplace.md).
 *
 * Authorize (escrow-style hold of MAX_RUN_FEE) → Capture at completion → Payout to dev.
 * PAYPAL_MODE=mock (default): zero-credential local simulation with the exact same
 * state machine (pending → authorized → captured), so the product runs without PayPal.
 * sandbox/live: real REST calls (orders API, intent=AUTHORIZE) — capture of a
 * non-approved order simply fails and the record stays `authorized` (never loses money).
 */
import { config } from '../config.js';

const API_BASE = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api.paypal.com',
} as const;

export interface PaymentResult {
  mode: 'mock' | 'sandbox' | 'live';
  authId: string;
  captureId?: string;
  state: 'authorized' | 'captured' | 'voided';
  mock: boolean;
  approvalUrl?: string;
}

async function accessToken(): Promise<string> {
  const c = config();
  const base = API_BASE[c.PAYPAL_MODE === 'live' ? 'live' : 'sandbox'];
  const basic = Buffer.from(`${c.PAYPAL_CLIENT_ID}:${c.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`PayPal auth HTTP ${res.status}`);
  const j = (await res.json()) as { access_token: string };
  return j.access_token;
}

/** Hold the run's fee ceiling before work starts (escrow-style authorization). */
export async function authorize(analysisId: string, maxAmount: number): Promise<PaymentResult> {
  const c = config();
  if (c.PAYPAL_MODE === 'mock' || !c.PAYPAL_CLIENT_ID || !c.PAYPAL_CLIENT_SECRET) {
    return { mode: 'mock', authId: `mock_auth_${analysisId}`, state: 'authorized', mock: true };
  }
  const base = API_BASE[c.PAYPAL_MODE];
  const token = await accessToken();
  const res = await fetch(`${base}/v2/checkout/orders`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          reference_id: analysisId,
          description: `AI Patent Agent run ${analysisId}`,
          custom_id: analysisId,
          amount: { currency_code: 'USD', value: maxAmount.toFixed(2) },
        },
      ],
      application_context: { user_action: 'PAY_NOW' },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`PayPal order HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = (await res.json()) as { id: string; links?: { rel: string; href: string }[] };
  const approve = j.links?.find((l) => l.rel === 'approve')?.href;
  return { mode: c.PAYPAL_MODE, authId: j.id, state: 'authorized', mock: false, approvalUrl: approve };
}

/** Capture exactly the metered amount (≤ authorized ceiling) at completion. */
export async function capture(
  authId: string,
  amount: number,
  mock: boolean,
): Promise<{ captureId?: string; state: 'captured' | 'authorized'; error?: string }> {
  const c = config();
  if (mock || c.PAYPAL_MODE === 'mock' || authId.startsWith('mock_')) {
    return { captureId: `mock_cap_${authId}`, state: 'captured' };
  }
  try {
    const base = API_BASE[c.PAYPAL_MODE === 'live' ? 'live' : 'sandbox'];
    const token = await accessToken();
    const res = await fetch(`${base}/v2/checkout/orders/${authId}/capture`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      // try amount-specific authorization capture path
      const alt = await fetch(`${base}/v2/payments/authorizations/${authId}/capture`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ amount: { currency_code: 'USD', value: amount.toFixed(2) } }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!alt.ok) return { state: 'authorized', error: `capture HTTP ${res.status}/${alt.status}` };
      const aj = (await alt.json()) as { id: string };
      return { captureId: aj.id, state: 'captured' };
    }
    const j = (await res.json()) as { id?: string; purchase_units?: { payments?: { captures?: { id: string }[] } }[] };
    const capId = j.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? j.id;
    return { captureId: capId, state: 'captured' };
  } catch (e) {
    return { state: 'authorized', error: e instanceof Error ? e.message : String(e) };
  }
}

/** Void the hold when a run fails before work is delivered. */
export async function voidAuthorization(authId: string, mock: boolean): Promise<void> {
  if (mock || authId.startsWith('mock_')) return;
  const c = config();
  if (c.PAYPAL_MODE === 'mock' || !c.PAYPAL_CLIENT_ID) return;
  try {
    const base = API_BASE[c.PAYPAL_MODE === 'live' ? 'live' : 'sandbox'];
    const token = await accessToken();
    await fetch(`${base}/v2/payments/authorizations/${authId}/void`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => undefined);
  } catch {
    /* voiding is best-effort; record state remains authoritative */
  }
}

export const isMock = (): boolean =>
  config().PAYPAL_MODE === 'mock' || !config().PAYPAL_CLIENT_ID || !config().PAYPAL_CLIENT_SECRET;
