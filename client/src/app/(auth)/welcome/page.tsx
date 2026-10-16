"use client";

import React, { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  Questionnaire,
  QuestionnaireProgress,
  QuestionnaireItem,
  QuestionnaireTitle,
  QuestionnaireDescription,
  QuestionnaireChoices,
  QuestionnaireChoice,
  QuestionnairePrevious,
  QuestionnaireSkip,
  QuestionnaireNext,
  QuestionnaireSubmit,
} from "@/components/ui/questionnaire";
import {
  CodeBlock,
  CodeBlockHeader,
  CodeBlockContent,
  CodeBlockCopyButton,
} from "@/components/ui/code-block";
import {
  Sparkles,
  ShoppingBag,
  Cpu,
  Terminal,
  ArrowRight,
  Loader2,
  DollarSign,
  Rocket,
  Globe,
  Radio,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { AnimatedDitherBackground } from "@/components/ui/animated-dither-background";

// Referral sources: 9 items for 3x3 grid without internal indicator circle
const referralChoices = [
  {
    value: "twitter",
    label: "Twitter / X",
    desc: "Tech discussions & feeds",
    image: "/twitter.png",
  },
  {
    value: "github",
    label: "GitHub",
    desc: "Repos & open source",
    image: "/github.png",
  },
  {
    value: "youtube",
    label: "YouTube",
    desc: "Tutorials & video demos",
    image: "/yt.png",
  },
  {
    value: "producthunt",
    label: "Product Hunt",
    desc: "Featured launch day",
    image: "/ph-orange.jpg",
  },
  {
    value: "google_search",
    label: "Google / Search",
    desc: "Search engine & browsing",
    image: "/search.png",
  },
  {
    value: "word_of_mouth",
    label: "Friends & Network",
    desc: "Colleague recommendation",
    image: "/people.png",
  },
  {
    value: "dev_community",
    label: "Dev Communities",
    desc: "Discord, Reddit & Slack",
    icon: Share2,
  },
  {
    value: "podcasts_news",
    label: "Podcasts & News",
    desc: "Tech blogs & newsletters",
    icon: Radio,
  },
  {
    value: "other",
    label: "Other Source",
    desc: "Events & other channels",
    icon: Globe,
  },
];

// Question 2: Exactly 4 options for a balanced 2x2 grid
const primaryUseChoices = [
  {
    value: "create_earn_agent",
    label: "Create and Earn from your Agent",
    desc: "Deploy, monetize, and earn revenue from your AI agents",
    icon: DollarSign,
  },
  {
    value: "browse_agents",
    label: "Browse Agents and capabilities",
    desc: "Explore agent tools, specialized skills, and integrations",
    icon: Rocket,
  },
  {
    value: "rent_agents",
    label: "Rent other Agents for personal use case",
    desc: "Borrow high-performance autonomous agents on-demand",
    icon: Cpu,
  },
  {
    value: "discovering_platforms",
    label: "Just discovering the platforms",
    desc: "Exploring what is possible and learning the ecosystem",
    icon: ShoppingBag,
  },
];

const questionsConfig = [
  {
    name: "referral_source",
    prompt: "How did you hear about us?",
    description: "Help us understand how you found your way to our platform.",
    required: false,
  },
  {
    name: "primary_use",
    prompt: "What is your primary use of our platform?",
    description:
      "Tell us what you are building so we can tailor your experience.",
    required: false,
  },
  {
    name: "sdk_installation",
    prompt: "Install our SDK and start earning!",
    description:
      "Get started in seconds. Install the SDK package to connect your services.",
    required: false,
  },
] as const;

const sdkCommand = "pnpm add @marketplace/sdk";

export default function WelcomePage() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const completeOnboardingMutation = useMutation(api.auth.completeOnboarding);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hearAboutUs, setHearAboutUs] = useState<string | undefined>();
  const [primaryUse, setPrimaryUse] = useState<string | undefined>();

  const handleFinishOnboarding = async (formData?: {
    referral_source?: string;
    primary_use?: string;
  }) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const finalHearAboutUs = formData?.referral_source || hearAboutUs;
    const finalPrimaryUse = formData?.primary_use || primaryUse;

    try {
      try {
        await (authClient as any).updateUser({
          onboardingCompleted: true,
          hearAboutUs: finalHearAboutUs,
          primaryUse: finalPrimaryUse,
        });
      } catch (clientErr) {
        console.warn("Client auth updateUser fallback:", clientErr);
      }

      try {
        await completeOnboardingMutation({
          hearAboutUs: finalHearAboutUs,
          primaryUse: finalPrimaryUse,
        });
      } catch (convexErr) {
        console.warn("Convex mutation completeOnboarding fallback:", convexErr);
      }

      const userName = session?.user?.name || session?.user?.email?.split("@")[0] || "there";
      toast.success(`Welcome ${userName}!`);
      
      try {
        router.push("/space");
      } catch {
        window.location.href = "/space";
      }
    } catch (err: any) {
      console.error("Onboarding completion error:", err);
      toast.error(err?.message || "Failed to complete setup");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const referral = (data.get("referral_source") as string) || hearAboutUs;
    const use = (data.get("primary_use") as string) || primaryUse;
    await handleFinishOnboarding({
      referral_source: referral,
      primary_use: use,
    });
  };

  return (
    <div className="relative h-screen w-full flex flex-col items-center justify-between text-foreground px-4 py-4 sm:py-5 overflow-hidden selection:bg-primary selection:text-primary-foreground">
      {/* Dynamic Animated Greyish-White Dither Pixel Background */}
      <AnimatedDitherBackground />

      {/* Brand Header */}
      <header className="relative z-10 w-full max-w-3xl flex flex-col items-center shrink-0">
        <Image
          src="/logo.svg"
          alt="Logo"
          width={128}
          height={38}
          priority
          className="dark:invert-0 brightness-100 object-contain h-10 w-auto drop-shadow-xs"
        />
      </header>

      {/* Main Questionnaire Area */}
      <main className="relative z-10 w-full max-w-3xl flex-1 flex flex-col justify-center my-auto min-h-0 py-2">
        <Questionnaire
          items={questionsConfig.map((q) => ({
            name: q.name,
            required: q.required,
          }))}
          onSubmit={handleFormSubmit}
          shortcuts="numbers"
          className="w-full flex flex-col gap-4"
        >
          {/* Card containing the questionnaire content */}
          <div className="w-full rounded-xl border border-border bg-card px-6 py-5 sm:px-7 sm:py-6 shadow-xs overflow-hidden">
            {/* Header Row: Progress indicator & category tag */}
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Getting Started
              </span>
              <QuestionnaireProgress className="text-xs font-medium text-muted-foreground tabular-nums" />
            </div>

            {/* Question 1: How did you hear about us? (3x3 grid without internal circle) */}
            <QuestionnaireItem
              name="referral_source"
              required={false}
              className="flex flex-col gap-3.5 border-0 p-0"
            >
              <div>
                <QuestionnaireTitle className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
                  How did you hear about us?
                </QuestionnaireTitle>
                <QuestionnaireDescription className="text-xs sm:text-sm text-muted-foreground mt-1">
                  Help us understand how you found your way to our platform.
                </QuestionnaireDescription>
              </div>

              {/* 3x3 Grid of choices: without circle indicators for cleaner, roomier layout */}
              <QuestionnaireChoices className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
                {referralChoices.map((choice) => {
                  const Icon = choice.icon;
                  return (
                    <QuestionnaireChoice
                      key={choice.value}
                      value={choice.value}
                      checked={hearAboutUs === choice.value}
                      onChange={() => setHearAboutUs(choice.value)}
                      hideIndicator={true}
                      className="flex flex-col items-start gap-2 p-3 rounded-lg border border-border bg-card hover:bg-muted text-start transition-colors cursor-pointer data-checked:border-primary data-checked:bg-secondary h-full min-h-0"
                    >
                      <div className="size-7 rounded-md border border-border bg-background flex items-center justify-center p-1 shrink-0 overflow-hidden">
                        {choice.image ? (
                          <Image
                            src={choice.image}
                            alt={choice.label}
                            width={18}
                            height={18}
                            className="object-contain size-4.5"
                          />
                        ) : Icon ? (
                          <Icon className="size-4 text-foreground" />
                        ) : null}
                      </div>

                      <div className="flex flex-col flex-1 leading-snug">
                        <span className="text-sm font-medium text-foreground">
                          {choice.label}
                        </span>
                        <span className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {choice.desc}
                        </span>
                      </div>
                    </QuestionnaireChoice>
                  );
                })}
              </QuestionnaireChoices>
            </QuestionnaireItem>

            {/* Question 2: Primary use of our platform? (4 options - 2x2 grid without internal circle) */}
            <QuestionnaireItem
              name="primary_use"
              required={false}
              className="flex flex-col gap-3.5 border-0 p-0"
            >
              <div>
                <QuestionnaireTitle className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
                  What is your primary use of our platform?
                </QuestionnaireTitle>
                <QuestionnaireDescription className="text-xs sm:text-sm text-muted-foreground mt-1">
                  Tell us what you are building so we can tailor your
                  experience.
                </QuestionnaireDescription>
              </div>

              <QuestionnaireChoices className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                {primaryUseChoices.map((choice) => {
                  const Icon = choice.icon;
                  return (
                    <QuestionnaireChoice
                      key={choice.value}
                      value={choice.value}
                      checked={primaryUse === choice.value}
                      onChange={() => setPrimaryUse(choice.value)}
                      hideIndicator={true}
                      className="flex flex-col items-start gap-2 p-3.5 rounded-lg border border-border bg-card hover:bg-muted text-start transition-colors cursor-pointer data-checked:border-primary data-checked:bg-secondary min-h-0"
                    >
                      <div className="w-fit p-1.5 rounded-md border border-border bg-background text-foreground shrink-0 flex items-center justify-center">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex flex-col flex-1 leading-snug w-full">
                        <span className="text-sm font-medium text-foreground">
                          {choice.label}
                        </span>
                        <span className="text-xs text-muted-foreground mt-0.5">
                          {choice.desc}
                        </span>
                      </div>
                    </QuestionnaireChoice>
                  );
                })}
              </QuestionnaireChoices>
            </QuestionnaireItem>

            {/* Question 3: Install our SDK and start earning! */}
            <QuestionnaireItem
              name="sdk_installation"
              required={false}
              className="flex flex-col gap-3.5 border-0 p-0"
            >
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border border-border bg-secondary text-secondary-foreground mb-2">
                  <Sparkles className="h-3 w-3" />
                  <span>Ready to Launch</span>
                </div>
                <QuestionnaireTitle className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
                  Install our SDK and start earning!
                </QuestionnaireTitle>
                <QuestionnaireDescription className="text-xs sm:text-sm text-muted-foreground mt-1">
                  Integrate our SDK directly into your node, python, or edge
                  applications. Start receiving automated settlements for your
                  compute & API endpoints.
                </QuestionnaireDescription>
              </div>

              {/* SDK Code Snippet */}
              <div className="space-y-3 pt-1">
                <CodeBlock
                  variant="default"
                  className="rounded-lg border border-border bg-card"
                >
                  <CodeBlockHeader className="border-b border-border px-3.5 py-2 text-xs font-mono text-muted-foreground flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs">Terminal</span>
                    </div>
                    <CodeBlockCopyButton value={sdkCommand} />
                  </CodeBlockHeader>
                  <CodeBlockContent className="p-3 font-mono text-xs sm:text-sm text-foreground bg-muted">
                    <pre className="overflow-x-auto">
                      <code>{sdkCommand}</code>
                    </pre>
                  </CodeBlockContent>
                </CodeBlock>

                <div className="rounded-lg border border-border bg-card p-3.5 flex items-center gap-3.5">
                  <div className="p-2.5 rounded-md bg-secondary text-secondary-foreground shrink-0">
                    <DollarSign className="h-5 w-5" />
                  </div>
                  <div className="text-xs sm:text-sm leading-snug">
                    <span className="font-medium text-foreground block">
                      Instant Monetization Active
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Your developer keys are automatically provisioned for this
                      account.
                    </span>
                  </div>
                </div>
              </div>
            </QuestionnaireItem>
          </div>

          {/* Navigation Actions Placed Outside the Card Border */}
          <div className="w-full flex items-center justify-between px-1 shrink-0">
            <div>
              <QuestionnairePrevious
                variant="outline"
                className="h-10 px-4 rounded-lg border border-border bg-card hover:bg-muted text-foreground font-medium text-xs sm:text-sm cursor-pointer shadow-xs"
              >
                Previous
              </QuestionnairePrevious>
            </div>

            <div className="flex items-center gap-2.5">
              <QuestionnaireSkip
                variant="outline"
                className="h-10 px-4 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground font-medium text-xs sm:text-sm cursor-pointer shadow-xs"
              >
                Skip
              </QuestionnaireSkip>

              <QuestionnaireNext className="h-10 px-5 rounded-lg bg-primary text-primary-foreground hover:bg-secondary hover:text-secondary-foreground transition-colors font-medium text-xs sm:text-sm cursor-pointer shadow-xs">
                Next
              </QuestionnaireNext>

              <QuestionnaireSubmit
                disabled={isSubmitting}
                onClick={() => {
                  void handleFinishOnboarding();
                }}
                className="h-10 px-6 rounded-lg bg-primary text-primary-foreground hover:bg-secondary hover:text-secondary-foreground transition-colors font-medium text-xs sm:text-sm cursor-pointer inline-flex items-center gap-2 shadow-xs"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Finishing...</span>
                  </>
                ) : (
                  <>
                    <span>Continue</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </QuestionnaireSubmit>
            </div>
          </div>
        </Questionnaire>
      </main>

      {/* Account Info Footer */}
      {session?.user?.email && (
        <footer className="relative z-10 shrink-0 text-center text-xs text-muted-foreground">
          Logged in as{" "}
          <span className="text-foreground font-medium">
            {session.user.email}
          </span>
        </footer>
      )}
    </div>
  );
}
