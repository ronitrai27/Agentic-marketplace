"use client";

import React, { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { toast } from "sonner";
import {
  Wallet,
  ArrowUpRight,
  ShieldCheck,
  Loader2,
  Building2,
  Scale,
  Lock,
  FileText,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "../../../../../convex/_generated/api";

const PRESETS = [5, 10, 25, 50];

export default function WalletPage() {
  const wallet = useQuery(api.wallet.getWallet);
  const [clientId, setClientId] = useState<string | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // Tab switch: default is "topup"
  const [activeTab, setActiveTab] = useState<"topup" | "withdraw">("topup");

  // Top-up state
  const [topUpAmount, setTopUpAmount] = useState<number>(10);
  const [customTopUpInput, setCustomTopUpInput] = useState<string>("10");

  // Withdrawal state
  const [withdrawAmount, setWithdrawAmount] = useState<string>("");
  const [paypalEmail, setPaypalEmail] = useState<string>("");
  const [isWithdrawing, setIsWithdrawing] = useState<boolean>(false);

  // Fetch PayPal Client ID securely from backend (no NEXT_PUBLIC_ required)
  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch("/api/paypal/config");
        if (!res.ok) throw new Error("Failed to load PayPal config.");
        const data = await res.json();
        setClientId(data.clientId);
      } catch (e: any) {
        console.error("Config error:", e);
      } finally {
        setLoadingConfig(false);
      }
    }
    loadConfig();
  }, []);

  // Set default email from wallet query once available
  useEffect(() => {
    if (wallet?.email && !paypalEmail) {
      setPaypalEmail(wallet.email);
    }
  }, [wallet?.email, paypalEmail]);

  const handlePresetSelect = (amount: number) => {
    setTopUpAmount(amount);
    setCustomTopUpInput(amount.toString());
  };

  const handleCustomAmountChange = (val: string) => {
    setCustomTopUpInput(val);
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      setTopUpAmount(num);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(withdrawAmount);

    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Please enter a valid withdrawal amount.");
      return;
    }

    if (!paypalEmail || !paypalEmail.includes("@")) {
      toast.error("Please enter a valid PayPal email address.");
      return;
    }

    const maxWithdrawable = parseFloat(wallet?.withdrawableUsd || "0");
    if (amountNum > maxWithdrawable) {
      toast.error(
        `Amount exceeds your withdrawable limit of $${maxWithdrawable.toFixed(2)}.`,
      );
      return;
    }

    try {
      setIsWithdrawing(true);
      const res = await fetch("/api/paypal/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountNum,
          paypalEmail,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Withdrawal failed.");
      }

      toast.success(
        `Withdrawal of $${amountNum.toFixed(2)} sent to ${paypalEmail}!`,
      );
      setWithdrawAmount("");
    } catch (err: any) {
      toast.error(err.message || "Failed to process withdrawal.");
    } finally {
      setIsWithdrawing(false);
    }
  };

  const totalCredits = wallet?.credits ?? 0;
  const totalUsd = wallet?.totalUsd ?? "0.00";
  const withdrawableUsd = wallet?.withdrawableUsd ?? "0.00";
  const withdrawableCredits = wallet?.withdrawableCredits ?? 0;
  const escrowUsd = wallet?.escrowUsd ?? "0.00";
  const escrowCredits = wallet?.escrow ?? 0;

  return (
    <div className="flex-1 w-full h-full overflow-y-auto thin-scrollbar px-6 py-6 sm:px-8 sm:py-7 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-foreground">
          Wallet & Billing
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage credits, deposit funds via PayPal Sandbox, and review account
          limits.
        </p>
      </div>

      {/* Balance Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Total Balance */}
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Total Balance
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-foreground tracking-tight">
              {totalCredits.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">credits</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            ≈ ${totalUsd} USD
          </p>
        </div>

        {/* Available for Withdrawal */}
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Available to Withdraw
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-foreground tracking-tight">
              ${withdrawableUsd}
            </span>
            <span className="text-xs text-muted-foreground">USD</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {withdrawableCredits.toLocaleString()} credits ($5 reserve locked)
          </p>
        </div>

        {/* Escrow Hold */}
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            In Escrow / Hold
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-foreground tracking-tight">
              ${escrowUsd}
            </span>
            <span className="text-xs text-muted-foreground">USD</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {escrowCredits.toLocaleString()} credits held for active tasks
          </p>
        </div>
      </div>

      {/* Action Selector: Tab Switcher */}
      <div className="flex items-center gap-1.5 p-1 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("topup")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
            activeTab === "topup"
              ? "bg-white dark:bg-neutral-950 text-foreground shadow-2xs border border-neutral-200/80 dark:border-neutral-800"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Top-Up Credits
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("withdraw")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
            activeTab === "withdraw"
              ? "bg-white dark:bg-neutral-950 text-foreground shadow-2xs border border-neutral-200/80 dark:border-neutral-800"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Withdraw to PayPal
        </button>
      </div>

      {/* Active Card View */}
      {activeTab === "topup" ? (
        /* Top-Up Card */
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-900 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Top-Up Credits with PayPal
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Deposit sandbox USD instantly converted to execution credits.
              </p>
            </div>
            <span className="text-xs text-muted-foreground font-mono bg-neutral-100 dark:bg-neutral-900 px-2 py-0.5 rounded border border-neutral-200/60 dark:border-neutral-800/60">
              $1.00 USD = 100 Credits
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left Column: Preset & Input */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Select Preset Amount
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {PRESETS.map((amt) => {
                    const isSelected = topUpAmount === amt;
                    return (
                      <button
                        type="button"
                        key={amt}
                        onClick={() => handlePresetSelect(amt)}
                        className={`py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer text-center ${
                          isSelected
                            ? "border-foreground bg-foreground text-background"
                            : "border-neutral-200 dark:border-neutral-800 bg-transparent text-foreground hover:bg-neutral-100 dark:hover:bg-neutral-900"
                        }`}
                      >
                        ${amt}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Custom Amount ($5 minimum)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    $
                  </span>
                  <Input
                    type="number"
                    min="5"
                    step="1"
                    value={customTopUpInput}
                    onChange={(e) => handleCustomAmountChange(e.target.value)}
                    className="pl-7 text-xs h-8"
                    placeholder="5.00"
                  />
                </div>
              </div>

              <div className="rounded-md bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/60 dark:border-neutral-800/60 p-2.5 text-xs flex justify-between items-center text-foreground">
                <span className="text-muted-foreground">You will receive:</span>
                <span className="font-semibold text-sm">
                  {Math.round(topUpAmount * 100).toLocaleString()} credits
                </span>
              </div>
            </div>

            {/* Right Column: PayPal Buttons */}
            <div className="flex flex-col justify-center border-t md:border-t-0 md:border-l border-neutral-100 dark:border-neutral-900 pt-3 md:pt-0 md:pl-4 space-y-3">
              <span className="text-xs font-medium text-muted-foreground">
                Payment Method
              </span>

              {loadingConfig ? (
                <div className="h-10 flex items-center justify-center text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin mr-1.5" /> Loading
                  PayPal Sandbox...
                </div>
              ) : !clientId ? (
                <div className="text-xs text-destructive text-center py-2">
                  PayPal Client ID not configured.
                </div>
              ) : topUpAmount < 5 ? (
                <div className="text-xs text-muted-foreground text-center py-2">
                  Minimum top-up is $5.00 (500 credits).
                </div>
              ) : (
                <PayPalScriptProvider
                  options={{
                    clientId: clientId,
                    currency: "USD",
                    intent: "capture",
                  }}
                >
                  <PayPalButtons
                    style={{
                      layout: "horizontal",
                      color: "gold",
                      shape: "rect",
                      label: "pay",
                      height: 38,
                      tagline: false,
                    }}
                    createOrder={async () => {
                      const res = await fetch("/api/paypal/create-order", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ amount: topUpAmount }),
                      });
                      const data = await res.json();
                      if (!res.ok || data.error) {
                        throw new Error(
                          data.error || "Failed to create order.",
                        );
                      }
                      return data.id;
                    }}
                    onApprove={async (data) => {
                      const res = await fetch("/api/paypal/capture-order", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ orderId: data.orderID }),
                      });
                      const result = await res.json();
                      if (result.success) {
                        toast.success(
                          `Successfully credited ${result.amountCredits} credits ($${result.amountUsd.toFixed(2)})!`,
                        );
                      } else {
                        toast.error(result.error || "Payment capture failed.");
                      }
                    }}
                    onError={(err) => {
                      console.error("PayPal Error:", err);
                      toast.error("PayPal transaction failed or cancelled.");
                    }}
                  />
                </PayPalScriptProvider>
              )}

              <p className="text-[11px] text-muted-foreground text-center">
                Secured by PayPal Sandbox. 100% test funds, no real card billed.
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* Withdrawal Card */
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-900 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Withdraw to PayPal
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Disburse available earnings directly to your PayPal account.
              </p>
            </div>
            <span className="text-xs text-muted-foreground font-mono bg-neutral-100 dark:bg-neutral-900 px-2 py-0.5 rounded border border-neutral-200/60 dark:border-neutral-800/60">
              Max Withdrawable: ${withdrawableUsd} USD
            </span>
          </div>

          <form onSubmit={handleWithdraw} className="space-y-4 max-w-lg">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                PayPal Receiver Email
              </label>
              <Input
                type="email"
                value={paypalEmail}
                onChange={(e) => setPaypalEmail(e.target.value)}
                placeholder="dev@example.com"
                required
                className="text-xs h-8"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-medium text-muted-foreground">
                  Withdraw Amount (USD)
                </label>
                {parseFloat(withdrawableUsd) > 0 && (
                  <button
                    type="button"
                    onClick={() => setWithdrawAmount(withdrawableUsd)}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                  >
                    Withdraw All (${withdrawableUsd})
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  $
                </span>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={withdrawableUsd}
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="0.00"
                  className="pl-7 text-xs h-8"
                />
              </div>
            </div>

            <div className="text-[11px] text-muted-foreground space-y-1 bg-neutral-50 dark:bg-neutral-900 p-2.5 rounded border border-neutral-200/60 dark:border-neutral-800/60">
              <p>
                • Mandatory reserve floor of $5.00 (500 credits) remains locked
                in your account.
              </p>
              <p>
                • Settlements are processed via the PayPal Payouts API directly
                to your Sandbox wallet.
              </p>
            </div>

            <Button
              type="submit"
              disabled={
                isWithdrawing ||
                parseFloat(withdrawableUsd) <= 0 ||
                !withdrawAmount ||
                parseFloat(withdrawAmount) <= 0
              }
              className="text-xs h-8 px-4 cursor-pointer"
            >
              {isWithdrawing ? (
                <>
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                  Processing Payout...
                </>
              ) : (
                <>
                  <ArrowUpRight className="size-3.5 mr-1.5" />
                  Request Payout
                </>
              )}
            </Button>
          </form>

          {parseFloat(withdrawableUsd) <= 0 && (
            <div className="text-xs text-muted-foreground py-2 border-t border-neutral-100 dark:border-neutral-900 flex items-center gap-1.5">
              <AlertCircle className="size-3.5 text-muted-foreground shrink-0" />
              <span>
                Your balance must exceed 500 credits ($5.00 USD) before payouts
                can be initiated.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Enterprise Platform Financial Disclosures & Regulatory Compliance */}
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-900 pb-3">
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Treasury, Settlement & Regulatory Disclosures
            </h3>
          </div>
          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-900 text-muted-foreground border border-neutral-200/60 dark:border-neutral-800/60">
            Compliance Spec v2.6
          </span>
        </div>

        <div className="flex flex-col space-y-4 text-xs text-muted-foreground">
          {/* Section 1 */}
          <div className="space-y-1.5 border-l-2 border-neutral-300 dark:border-neutral-700 pl-3">
            <div className="flex items-center gap-1.5 text-foreground font-semibold">
              <Scale className="size-3.5" />
              <span>1. Regulatory Banking & Cross-Border Framework</span>
            </div>
            <p className="leading-relaxed">
              All payment settlements, authorizations, and merchant
              disbursements are processed in compliance with
              <strong> PayPal (Europe) S.à r.l. et Cie, S.C.A.</strong>{" "}
              (CSSF-regulated credit institution) and
              <strong> PayPal Inc.</strong> (FinCEN-registered MSB pursuant to
              31 CFR § 1022.380). Cross-border remittances involving Indian
              commercial entities adhere to{" "}
              <strong>Reserve Bank of India (RBI)</strong> Master Directions for
              Online Payment Gateway Service Providers (OPGSP) and{" "}
              <strong>State Bank of India (SBI)</strong> inward nostro clearing
              protocols for electronic services.
            </p>
          </div>

          {/* Section 2 */}
          <div className="space-y-1.5 border-l-2 border-neutral-300 dark:border-neutral-700 pl-3">
            <div className="flex items-center gap-1.5 text-foreground font-semibold">
              <Lock className="size-3.5" />
              <span>
                2. Mandatory Liquidity Reserve Floor ($5.00 / 500 Credits)
              </span>
            </div>
            <p className="leading-relaxed">
              In accordance with Automated Clearing House (ACH) operating
              standards and automated ledger solvency policies, accounts must
              maintain a non-callable minimum liquidity reserve of{" "}
              <strong>500 credits ($5.00 USD)</strong>. This reserve ensures
              counterparty risk protection against asynchronous agent execution
              latency, sub-agent micro-transactions, and retried tool calls.
              Only funds strictly exceeding this threshold are eligible for
              outward liquidation.
            </p>
          </div>

          {/* Section 3 */}
          <div className="space-y-1.5 border-l-2 border-neutral-300 dark:border-neutral-700 pl-3">
            <div className="flex items-center gap-1.5 text-foreground font-semibold">
              <ShieldCheck className="size-3.5" />
              <span>3. Escrow Custody & Cryptographic Verification Gate</span>
            </div>
            <p className="leading-relaxed">
              Buyer funds allocated to agent tasks are secured in pre-authorized
              intent escrow (<code>intent: AUTHORIZE</code>). Settlement capture
              occurs exclusively upon deterministic schema validation of output
              artifacts. If an agent encounters infinite loops, timeouts, or
              unfulfilled output contracts, the authorization is voided in full,
              ensuring zero-loss buyer protection.
            </p>
          </div>

          {/* Section 4 */}
          <div className="space-y-1.5 border-l-2 border-neutral-300 dark:border-neutral-700 pl-3">
            <div className="flex items-center gap-1.5 text-foreground font-semibold">
              <FileText className="size-3.5" />
              <span>
                4. Anti-Money Laundering (AML) & Payout Clearing Times
              </span>
            </div>
            <p className="leading-relaxed">
              Disbursements executed via the PayPal Payouts API are verified
              against OFAC, FATF, and FinCEN sanctions databases. Funds
              requested to verified sandbox merchant accounts settle instantly;
              high-volume creator batch settlements are subject to 2FA
              verification and automated platform fraud telemetry audits prior
              to release.
            </p>
          </div>
        </div>

        {/* Caution Banner */}
        <div className="rounded-md bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800 p-3 text-[11px] text-muted-foreground flex items-start gap-2">
          <AlertCircle className="size-4 text-foreground shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong className="text-foreground">
              Official Regulatory Caution:
            </strong>{" "}
            Platform credits represent computational utility equivalents (1 USD
            = 100 Credits) and do not constitute demand deposit liabilities.
            Sandbox transactions are conducted in an isolated PayPal developer
            environment for software evaluation purposes.
          </p>
        </div>
      </div>
    </div>
  );
}
