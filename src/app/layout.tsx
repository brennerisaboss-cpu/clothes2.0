import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { facets } from '@/lib/queries';
import FxBanner from '@/components/FxBanner';

export const metadata: Metadata = {
  title: 'Resale tracker',
  description: 'Personal resale price tracking for a narrow brand list.',
};

export const dynamic = 'force-dynamic';

async function Nav() {
  let due = 0;
  let unresolved = 0;
  try {
    const f = await facets();
    due = Number(f.counts?.due ?? 0);
    unresolved = Number(f.counts?.unresolved ?? 0);
  } catch {
    // The nav must render even with no database, so the setup page is reachable.
  }

  const links = [
    { href: '/', label: 'Grid' },
    { href: '/items', label: 'Items' },
    { href: '/opportunities', label: 'Opportunities' },
    { href: '/add', label: 'Add', accent: true },
    { href: '/verify', label: 'Re-check', badge: due },
    { href: '/unresolved', label: 'Unresolved', badge: unresolved },
    { href: '/sources', label: 'Sources' },
    { href: '/alerts', label: 'Alerts' },
  ];

  return (
    // A masthead: one solid black bar with the name reversed out of it.
    //
    // The page goes emphatic in exactly one place so everything under it can
    // stay quiet. The previous bar was ink-on-paper like the rest of the
    // screen, marked its active item with a pill, and put a plotted asterisk
    // beside the name — three decorations doing the job one block of black
    // does better.
    <header className="masthead sticky top-0 z-30">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3">
        <Link href="/" className="wordmark text-[19px] no-underline hover:no-underline">
          Resale
        </Link>

        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`py-1 text-[12px] font-semibold uppercase tracking-[0.1em] no-underline hover:no-underline ${
                l.accent ? 'is-active' : ''
              }`}
            >
              {l.label}
              {/* A count set as a superior figure, the way a printed index
                  carries a note number — rather than a filled chip, which
                  reads as a notification and shouts louder than it deserves. */}
              {l.badge ? (
                <sup className="ml-0.5 text-[10px] font-bold text-accent">{l.badge}</sup>
              ) : null}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Nav />
        {/* No sheet, no shadow. The content sits directly on the paper: a
            floating panel implies an object above a surface, and there is no
            surface here for it to float over. */}
        <main className="mx-auto max-w-[1600px] px-5 py-7 sm:px-8">
          <FxBanner />
          {children}
        </main>
      </body>
    </html>
  );
}
