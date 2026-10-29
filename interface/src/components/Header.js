import { Link, useLocation } from "react-router-dom";

const links = [
  { href: "/search", label: "Search" },
  { href: "/mafia", label: "Mafia" },
  { href: "/upload", label: "Upload" },
  { href: "/chat", label: "Chat" },
];

// Partner logos beside the brand, each linking to the partner. The RTU mark is dark teal,
// so it is drawn in white to show on the dark header.
const partners = [
  {
    src: "https://lh3.googleusercontent.com/aida-public/AB6AXuCHArU1t68kJIBc2K3FOqEenENdQrHc5AP-Itx74yVD5PZ5iXUa-rv9-c4aQ8iETxHzU6T-Bku2IDaimpyRTJQ0dGbGTF7dtmjTC2OgM0lcLaSjxapkAaTcnGp3tyQBmiGJuggVfx-0_X-UHRX6lxToOefdwr4FjrRk1wR9c1arrtaY2oDHb1jniscCeVy33e_sl4HnLDkDS2mRTIjZyhq2oSnRzRiW-y4kMjfnOz22DQeyps5IyqSAZ6FvUMq_88niLVpb6nuMo44G",
    alt: "Chartizer", href: "https://chartizer.com/", className: "h-7 sm:h-8 rounded-md",
  },
  { src: "https://www.uniso.lv/logo.svg", alt: "Uniso", href: "https://www.uniso.lv/", className: "h-5 sm:h-6" },
  { src: "https://www.rtu.lv/images/logo_lv.svg?v=1.1", alt: "RTU", href: "https://www.rtu.lv/", className: "h-7 sm:h-9 brightness-0 invert" },
];

export default function Header() {
  const { pathname } = useLocation();

  if (pathname === "/") return null;

  return (
    <header className="flex-shrink-0 z-40 w-full bg-theme-bg border-b border-theme-border pt-[env(safe-area-inset-top)]">
      <div className="w-full px-4 sm:px-8 h-14 sm:h-16 flex items-center justify-between gap-4">
        
        <div className="flex items-center gap-6 min-w-0">

          <Link to="/" className="flex items-baseline gap-2.5 group whitespace-nowrap" aria-label="BRIMS Knowledge Bank">
            <span className="font-['Space_Grotesk'] text-[22px] sm:text-[26px] font-bold leading-none tracking-[-0.03em] text-theme-text-primary group-hover:text-chartizer-yellow transition-colors duration-200">
              BRIMS
            </span>
            <span className="hidden sm:inline text-[15px] font-medium leading-none text-theme-secondary">Knowledge Bank</span>
          </Link>

          <div className="hidden sm:flex items-center gap-4 lg:gap-6 border-l border-theme-border pl-4 lg:pl-6">
            {partners.map(({ src, alt, href, className }) => (
              <a key={alt} href={href} target="_blank" rel="noopener noreferrer" title={alt} className="flex-none">
                <img
                  src={src}
                  alt={alt}
                  className={`w-auto object-contain opacity-90 hover:opacity-100 transition-opacity duration-200 ${className}`}
                />
              </a>
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
