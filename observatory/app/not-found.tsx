import Link from 'next/link';
import { Header } from '@/components/Header';

export default function NotFound() {
  return (
    <>
      <Header active="timeline" />
      <div className="shell">
        <div className="empty-state">
          <h2>Not found</h2>
          <p>
            No run matches that number. <Link href="/">Back to the timeline</Link>.
          </p>
        </div>
      </div>
    </>
  );
}
