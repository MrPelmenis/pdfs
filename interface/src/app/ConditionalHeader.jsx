"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/search", label: "Search" },
  { href: "/upload", label: "Upload" },
];

export default function ConditionalHeader() {
  const pathname = usePathname();

  if (pathname === "/") return null;

  return (
    <header className="sticky top-0 z-40 w-full bg-surface border-b border-border">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">

        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded-lg bg-accent/20 flex items-center justify-center">
            <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-ink group-hover:text-accent transition-colors duration-150">
                PDF 
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {links.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(href + "?");
            return (
              <Link
                key={href}
                href={href}
                className={`
                  relative px-4 py-1.5 rounded-lg text-sm font-medium
                  transition-colors duration-150
                  ${active
                    ? "text-accent bg-accent/10"
                    : "text-ink-dim hover:text-ink hover:bg-raised"
                  }
                `}
              >
                {label}
              </Link>
            );
          })}
        </nav>

      </div>
    </header>
  );
}
