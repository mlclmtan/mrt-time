export default function MeLoading() {
  return (
    <div className="space-y-4 pt-3" aria-busy="true" aria-label="Loading profile">
      <div className="panel p-4 space-y-3">
        <div className="h-5 w-32 rounded bg-line shimmer" />
        <div className="h-4 w-3/4 rounded bg-line shimmer" />
        <div className="h-10 w-full rounded bg-line shimmer" />
      </div>
      <div className="panel p-4 space-y-3">
        <div className="h-5 w-32 rounded bg-line shimmer" />
        <div className="h-4 w-3/4 rounded bg-line shimmer" />
        <div className="h-10 w-full rounded bg-line shimmer" />
      </div>
      <div className="panel p-4 space-y-3">
        <div className="h-5 w-32 rounded bg-line shimmer" />
        <div className="h-4 w-3/4 rounded bg-line shimmer" />
        <div className="h-10 w-full rounded bg-line shimmer" />
      </div>
    </div>
  );
}
