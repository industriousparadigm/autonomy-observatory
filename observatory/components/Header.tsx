import Link from 'next/link';
import type { ArmMeta } from '@/lib/arms';
import { defaultArmId, PROMPT_VARIANT_NOTE } from '@/lib/arms';

const TABS = [
  { key: 'timeline', label: 'Runs' },
  { key: 'budget', label: 'Budget' },
  { key: 'probes', label: 'Boundary probes' },
  { key: 'setup', label: 'Setup & docs' },
] as const;

type ActiveKey = (typeof TABS)[number]['key'] | 'run-detail' | 'compare' | 'cold-start';

/** Where a per-arm tab points for a given section — run-detail and the cross-arm pages have no arm-scoped analog, so they fall back to that arm's timeline. */
function armHref(armId: string, section: ActiveKey): string {
  switch (section) {
    case 'timeline':
    case 'run-detail':
    case 'compare':
    case 'cold-start':
      return `/${armId}`;
    default:
      return `/${armId}/${section}`;
  }
}

export function Header({
  active,
  meta,
  arms,
  currentArm,
}: {
  active: ActiveKey;
  meta?: string;
  /** Every known arm, for the switcher. Omit on pages that can't discover arms (shouldn't happen, but keeps this component usable standalone). */
  arms?: ArmMeta[];
  /** The arm this page is scoped to — null on the cross-arm compare page. */
  currentArm?: ArmMeta | null;
}) {
  const tabTarget = currentArm?.id ?? (arms ? defaultArmId(arms) : null);

  return (
    <header className="top">
      <div className="inner">
        <Link href="/" className="brand">
          Autonomy<span className="dot">·</span>Observatory
        </Link>
        <nav className="tabs">
          <Link href="/" className={active === 'compare' ? 'active' : ''}>
            Digest
          </Link>
          <Link href="/cold-start" className={active === 'cold-start' ? 'active' : ''}>
            Cold start
          </Link>
          {TABS.map((tab) => (
            <Link key={tab.key} href={tabTarget ? armHref(tabTarget, tab.key) : '/'} className={active === tab.key ? 'active' : ''}>
              {tab.label}
            </Link>
          ))}
        </nav>
        {meta ? <div className="log-meta">{meta}</div> : null}
      </div>
      {arms && arms.length > 0 ? (
        <div className="inner arm-bar">
          <span className="arm-bar-label">Arm</span>
          <div className="arm-switcher">
            {arms.map((a) => (
              <Link key={a.id} href={armHref(a.id, active)} className={`arm-chip${currentArm?.id === a.id ? ' active' : ''}${!a.hasLog ? ' arm-chip--empty' : ''}`}>
                {a.label}
                {!a.hasLog ? <span className="arm-chip-note">no runs yet</span> : null}
              </Link>
            ))}
          </div>
          {currentArm ? (
            <div className="arm-meta" title={currentArm.promptVariant ? PROMPT_VARIANT_NOTE[currentArm.promptVariant] : undefined}>
              {[currentArm.model, currentArm.promptVariant, currentArm.tools?.join(', ')].filter(Boolean).join(' · ') || 'No config found for this arm.'}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
