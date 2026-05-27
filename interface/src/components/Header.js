import { Link, useLocation } from "react-router-dom";

// Using semantic color variables from your Tailwind configuration
const links = [
  { href: "/search", label: "Search" },
  { href: "/upload", label: "Upload" },
  { href: "/chat", label: "Chat" },
];

export default function Header() {
  const { pathname } = useLocation();

  if (pathname === "/") return null;

  return (
    <header className="sticky top-0 z-40 w-full bg-main border-b border-border">
      {/* REMOVED max-w-6xl and mx-auto to allow full width stretch */}
      <div className="w-full px-8 h-16 flex items-center justify-between">
        
        {/* Left Section: Three Logos + Existing Logo Area */}
        <div className="flex items-center gap-6 flex-shrink-0">
          
          {/* Three Requested Logos */}
          <div className="flex items-center gap-4 border-r border-border/60 pr-6">
            <img 
              src="https://chartizer.com/chartizericon.png" 
              alt="Chartizer" 
              className="h-8 w-auto object-contain"
            />
            <img 
              src="https://www.uniso.lv/logo.svg" 
              alt="Uniso" 
              className="h-8 w-auto object-contain"
            />
            <img 
              src="https://upload.wikimedia.org/wikipedia/lv/f/fd/RTU_logo_2017.svg" 
              alt="RTU" 
              className="h-8 w-auto object-contain"
            />
          </div>

          {/* Main App Logo Area */}
          <Link to="/" className="flex items-center gap-3 group">
            {/* Beaker Icon Box with Glow */}
            <div className="w-9 h-9 rounded-lg border border-chartizer-yellow/40 bg-chartizer-yellow/10 flex items-center justify-center shadow-[0_0_20px_rgba(222,161,28,0.15)] group-hover:bg-chartizer-yellow/20 group-hover:border-chartizer-yellow/60 transition-all duration-300">
              <svg 
                className="w-5 h-5 text-chartizer-yellow" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="1.5" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
              </svg>
            </div>
            
            {/* Typography */}
            <div className="flex flex-col">
              <span className="text-[10px] font-bold tracking-[0.2em] text-chartizer-yellow uppercase mb-0.5">
                Knowledge Synthesis
              </span>
              <span className="text-base font-bold text-ink tracking-tight">
                Data Explorer
              </span>
            </div>
          </Link>
        </div>

        {/* Right Section: Navigation */}
        <nav className="flex items-center gap-6 flex-grow justify-end">
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
                    : "text-ink-dim hover:text-ink" 
                  }
                `}
              >
                {label}
                {/* Active Indicator Underline */}
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
