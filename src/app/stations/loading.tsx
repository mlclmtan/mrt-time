export default function StationsLoading() {
  return (
    <div className="space-y-4 pt-3" aria-busy="true" aria-label="Loading stations">
      {/* Search field: 52px tall */}
      <div className="h-[52px] min-h-[52px] w-full rounded-xl bg-line shimmer" />

      {/* Segments: 4 segments */}
      <div className="flex gap-2">
        <div className="h-11 min-h-[44px] flex-1 rounded-xl bg-line shimmer" />
        <div className="h-11 min-h-[44px] flex-1 rounded-xl bg-line shimmer" />
        <div className="h-11 min-h-[44px] flex-1 rounded-xl bg-line shimmer" />
        <div className="h-11 min-h-[44px] flex-1 rounded-xl bg-line shimmer" />
      </div>

      {/* 6 station rows */}
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="panel flex min-h-[56px] items-center gap-3 px-3 py-2">
            <div className="h-6 w-6 rounded-md bg-line shimmer" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-28 rounded bg-line shimmer" />
              <div className="h-3 w-16 rounded bg-line shimmer" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
