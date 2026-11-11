import Link from "next/link";
import Image from "next/image";
import { DocsSidebar } from "@/modules/docs/components/docs-nav";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      id="docs-scroll"
      className="h-full w-full overflow-y-auto bg-white text-neutral-900 scroll-smooth"
    >
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[88rem] items-center justify-between px-5 md:px-8">
          <div className="flex items-center gap-4">
            <Link href="/" aria-label="Catelog home">
              <Image
                src="/logo.svg"
                alt="Catelog"
                width={100}
                height={30}
                className="h-7 w-auto object-contain"
              />
            </Link>
            <span className="h-5 w-px bg-neutral-200" />
            <Link href="/docs" className="text-sm font-medium">
              Docs
            </Link>
          </div>
          <nav className="flex items-center gap-5 text-sm text-neutral-600">
            <Link href="/space" className="hover:text-neutral-900">
              Marketplace
            </Link>
            <Link
              href="/auth"
              className="rounded-full bg-neutral-900 px-4 py-1.5 font-medium text-white transition-colors hover:bg-neutral-700"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto flex max-w-[88rem] gap-10 px-5 md:px-8">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto py-8 pr-2 lg:block">
          <DocsSidebar />
        </aside>
        {children}
      </div>
    </div>
  );
}
