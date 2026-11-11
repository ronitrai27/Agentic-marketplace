/** Single source for the contract shown in the last registration step and for its "Copy" button. */

export const CONTRACT_TITLE = "Catelog Developer Security & Data Responsibility Declaration";

export const DECLARATION_PARAGRAPHS: string[] = [
  "I confirm that I am authorized to publish and operate this agent and that its declared capabilities, data handling, pricing, permissions, and external dependencies are accurate.",
  "I agree not to misuse, sell, unlawfully disclose, or improperly retain buyer data; collect data beyond disclosed and authorized purposes; attempt to compromise Catelog, its users, or other agents; or circumvent platform security controls.",
  "I accept responsibility for my agent's operation and for complying with applicable privacy, data-protection, intellectual-property, and other laws. I understand that violations may result in investigation, listing suspension, credential revocation, account termination, and other appropriate legal action where warranted by applicable law.",
  "I understand that Catelog may investigate credible abuse reports and preserve or disclose relevant information where legally permitted or required. I agree to keep my disclosures accurate and promptly report security incidents affecting buyer data.",
];

export const PAYMENTS_TITLE = "Payments and marketplace commission";

export const PAYMENT_RULES: Array<{ title: string; body: string }> = [
  {
    title: "Failed runs are not charged",
    body: "If a run fails, times out, or returns output that does not match the output schema declared by the agent, the buyer is not charged and the creator receives nothing for that run.",
  },
  {
    title: "Canceled runs and platform errors",
    body: "If a run is canceled, or ends because of a Catelog server error or another unexpected error on Catelog's side, the creator receives a partial compensation of between 10% and 50% of the run price. It is paid from the buyer's wallet or by Catelog, depending on the cause, and its size depends on the time used and other factors.",
  },
  {
    title: "Successful runs are held for 48 hours",
    body: "When a run succeeds, the price is deducted from the buyer's wallet and the creator's earnings are held for 48 hours before they can be withdrawn. During this period Catelog checks settlement, legal and compliance matters, and whether the buyer has raised any complaint.",
  },
  {
    title: "Commission is not fixed",
    body: "Catelog's commission is not a fixed rate. It is decided for each run and ranges from 5% to 20% of the run price.",
  },
];

export const AGREEMENT_LABEL =
  "I have read and agree to the Developer Security & Data Responsibility Declaration and the payment and commission rules.";

export const CONFIRM_WORD = "CONFIRM";

/** Plain-text version of the whole contract, for copying into an AI assistant or a document. */
export function contractAsText(): string {
  const declaration = DECLARATION_PARAGRAPHS.join("\n\n");
  const payments = PAYMENT_RULES.map((r, i) => `${i + 1}. ${r.title}: ${r.body}`).join("\n");
  return [
    CONTRACT_TITLE,
    "",
    declaration,
    "",
    PAYMENTS_TITLE,
    "",
    payments,
    "",
    AGREEMENT_LABEL,
    `To finish, the creator types ${CONFIRM_WORD} to acknowledge.`,
  ].join("\n");
}
