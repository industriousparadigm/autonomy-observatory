import Link from 'next/link';

const TABS = [
  { href: '/', key: 'timeline', label: 'Runs' },
  { href: '/budget', key: 'budget', label: 'Budget' },
  { href: '/probes', key: 'probes', label: 'Boundary probes' },
] as const;

export function Header({ active, meta }: { active: (typeof TABS)[number]['key'] | 'run-detail'; meta?: string }) {
  return (
    <header className="top">
      <div className="inner">
        <Link href="/" className="brand">
          Autonomy<span className="dot">·</span>Observatory
        </Link>
        <nav className="tabs">
          {TABS.map((tab) => (
            <Link key={tab.key} href={tab.href} className={active === tab.key ? 'active' : ''}>
              {tab.label}
            </Link>
          ))}
        </nav>
        {meta ? <div className="log-meta">{meta}</div> : null}
      </div>
    </header>
  );
}
