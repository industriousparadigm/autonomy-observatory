export default function Loading() {
  return (
    <div className="shell" aria-busy="true" aria-label="Loading run">
      <div className="loading-bar" />
      <div className="skeleton-block" style={{ height: '1.6rem', width: '22%', marginTop: '1.5rem' }} />
      <div className="stat-row" style={{ marginTop: '1rem' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton-block" style={{ height: '2.6rem', width: '110px' }} />
        ))}
      </div>
      <div className="skeleton-block" style={{ height: '90px', marginTop: '1.4rem' }} />
      <div className="transcript" style={{ marginTop: '1.8rem' }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton-block" style={{ height: '64px' }} />
        ))}
      </div>
    </div>
  );
}
