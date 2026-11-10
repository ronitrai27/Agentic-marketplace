import Hero from "@/modules/web/components/Hero";
import Section1 from "@/modules/web/components/section-1";
import Section2 from "@/modules/web/components/section-2";
import HowItWorks from "@/modules/web/components/HowItWorks";
import CodeDemo from "@/modules/web/components/CodeDemo";

export default function WebPage() {
  return (
    <Hero>
      <Section1 />
      <Section2 />
      <HowItWorks />
      <CodeDemo />
    </Hero>
  );
}
