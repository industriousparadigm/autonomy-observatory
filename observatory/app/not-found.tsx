import Link from 'next/link';
import { Header } from '@/components/Header';

export default function NotFound() {
  return (
    <>
      <Header active="compare" />
      <div className="shell">
        <div className="empty-state">
          <h2>Not found</h2>
          <p>
            No run, or no arm, matches that address. <Link href="/">Back to the arm comparison</Link>.
          </p>
        </div>
      </div>
    </>
  );
}
