import Link from "next/link";
import { Mail } from "lucide-react";

/**
 * Zero-session landing header. The full Navbar pulls next-auth + framer mega-menu
 * into the critical path; this keeps Sign in / Get started as plain links so
 * mobile LCP/INP are not blocked on SessionProvider.
 */
export function LandingHeader() {
  return (
    <header className="fixed top-0 inset-x-0 z-50 flex justify-center pointer-events-none">
      <div className="pointer-events-auto mt-4 mx-4 w-full max-w-5xl flex items-center justify-between rounded-full border border-white/10 bg-black/70 px-4 py-2.5 backdrop-blur-md">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Mailient home">
          <span className="relative w-7 h-7 rounded-[25%] overflow-hidden border border-white/10 bg-white shrink-0">
            <img
              src="/mailient-logo-sm.png"
              alt=""
              width={28}
              height={28}
              className="w-full h-full object-cover"
            />
          </span>
          <span className="font-extrabold text-[15px] tracking-tight text-white">
            Mailient
          </span>
        </Link>

        <nav className="hidden sm:flex items-center gap-6 text-[12px] font-semibold text-neutral-300">
          <Link href="/product/arcus" className="hover:text-white transition-colors">
            Arcus
          </Link>
          <Link href="/pricing" className="hover:text-white transition-colors">
            Pricing
          </Link>
          <Link href="/security" className="hover:text-white transition-colors">
            Security
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/auth/signin"
            className="text-[12px] font-semibold text-neutral-300 hover:text-white transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/auth/signup"
            className="inline-flex items-center gap-1.5 rounded-full bg-white text-black text-[11px] font-bold px-3.5 h-8.5 hover:bg-neutral-200 transition-colors"
          >
            <Mail className="w-3.5 h-3.5" aria-hidden="true" />
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
