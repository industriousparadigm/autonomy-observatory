export default function Loading() {
  return (
    <div className="shell" aria-busy="true" aria-label="Loading">
      <div className="loading-bar" />
      <div className="skeleton-block" style={{ height: '1.8rem', width: '32%', marginTop: '1.5rem' }} />
      <div className="skeleton-block" style={{ height: '1rem', width: '58%', marginTop: '0.7rem' }} />
      <div className="skeleton-block" style={{ height: '320px', marginTop: '1.6rem' }} />
    </div>
  );
}
