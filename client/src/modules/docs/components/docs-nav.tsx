"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const DOCS_NAV = [
  {
    title: "Getting Started",
    items: [{ title: "What is Catelog?", href: "/docs" }],
  },
];

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav className="space-y-6 text-sm">
      {DOCS_NAV.map((g) => (
        <div key={g.title}>
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            {g.title}
          </p>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const active = pathname === it.href;
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    className={`block rounded-md px-3 py-1.5 transition-colors ${
                      active
                        ? "bg-neutral-100 font-medium text-neutral-900"
                        : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
                    }`}
                  >
                    {it.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function OnThisPage({ items }: { items: { id: string; title: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);

  useEffect(() => {
    const root = document.getElementById("docs-scroll");
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length) setActive(visible[0].target.id);
      },
      { root, rootMargin: "-80px 0px -65% 0px" },
    );
    items.forEach((i) => {
      const el = document.getElementById(i.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [items]);

  return (
    <div className="text-sm">
      <p className="mb-3 font-medium text-neutral-900">On this page</p>
      <ul className="space-y-2 border-l border-neutral-200">
        {items.map((i) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              className={`-ml-px block border-l py-0.5 pl-4 transition-colors ${
                active === i.id
                  ? "border-neutral-900 font-medium text-neutral-900"
                  : "border-transparent text-neutral-500 hover:text-neutral-900"
              }`}
            >
              {i.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
