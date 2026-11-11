import Hero from "@/modules/web/components/Hero";
import Section1 from "@/modules/web/components/section-1";
import Section2 from "@/modules/web/components/section-2";
import HowItWorks from "@/modules/web/components/HowItWorks";
import CodeDemo from "@/modules/web/components/CodeDemo";
import Global from "@/modules/web/components/Global";
import Integrations from "@/modules/web/components/Integrations";
import Testimonials from "@/modules/web/components/Testimonials";
import McpSection from "@/modules/web/components/McpSection";
import Footer from "@/modules/web/components/Footer";

export default function WebPage() {
  return (
    <Hero>
      <Section1 />
      <Section2 />
      <McpSection />
      <HowItWorks />
      <CodeDemo />
      <Global />
      <Integrations />
      <Testimonials />
      <Footer />
    </Hero>
  );
}
