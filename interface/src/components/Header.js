import { Link, useLocation } from "react-router-dom";

const links = [
  { href: "/search", label: "Search" },
  { href: "/upload", label: "Upload" },
  { href: "/chat", label: "Chat" },
];

// Partner logos sit muted beside the brand. The RTU mark is dark teal, so it is drawn
// in white to show on the dark header.
const partners = [
  { src: "https://chartizer.com/chartizericon.png", alt: "Chartizer", className: "" },
  { src: "https://www.uniso.lv/logo.svg", alt: "Uniso", className: "h-5" },
  { src: "https://upload.wikimedia.org/wikipedia/lv/f/fd/RTU_logo_2017.svg", alt: "RTU", className: "h-7 brightness-0 invert" },
];

export default function Header() {
  const { pathname } = useLocation();

  if (pathname === "/") return null;

  return (
    <header className="flex-shrink-0 z-40 w-full bg-theme-bg border-b border-theme-border pt-[env(safe-area-inset-top)]">
      <div className="w-full px-4 sm:px-8 h-14 sm:h-16 flex items-center justify-between gap-4">
        
        <div className="flex items-center gap-6 min-w-0">

          <Link to="/" className="flex items-baseline gap-2.5 group whitespace-nowrap" aria-label="BRIMS Data Explorer">
            <span className="font-['Space_Grotesk'] text-[22px] sm:text-[26px] font-bold leading-none tracking-[-0.03em] text-theme-text-primary group-hover:text-chartizer-yellow transition-colors duration-200">
              BRIMS
            </span>
            <span className="hidden sm:inline text-[15px] font-medium leading-none text-theme-secondary">Data Explorer</span>
          </Link>

          <div className="hidden md:flex items-center gap-5 border-l border-theme-border pl-6">
            {partners.map(({ src, alt, className }) => (
              <img
                key={alt}
                src={src}
                alt={alt}
                title={alt}
                className={`h-6 w-auto object-contain opacity-60 hover:opacity-100 transition-opacity duration-200 ${className}`}
              />
            ))}
          </div>
        </div>

        <nav className="flex items-center gap-5 sm:gap-6 justify-end">
          {links.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(href + "?");
            return (
              <Link
                key={href}
                to={href}
                className={`
                  relative py-2 text-sm font-semibold tracking-wide
                  transition-colors duration-200
                  ${active
                    ? "text-chartizer-yellow"
                    : "text-theme-text-dark hover:text-theme-text-primary"
                  }
                `}
              >
                {label}
                {active && (
                  <span className="absolute left-0 -bottom-[5px] w-full h-[2px] bg-chartizer-yellow shadow-[0_-2px_10px_rgba(222,161,28,0.5)]" />
                )}
              </Link>
            );
          })}
        </nav>

      </div>
    </header>
  );
}
