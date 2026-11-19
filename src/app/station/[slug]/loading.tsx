export default function StationLoading() {
  return (
    <div className="space-y-4 pt-3 sm:pt-4" aria-busy="true" aria-label="Loading station">
      {/* Header */}
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-6 w-14 rounded-full bg-line shimmer" />
          <div className="h-7 w-40 rounded bg-line shimmer" />
        </div>
        <div className="h-4 w-48 rounded bg-line shimmer" />
      </header>

      {/* Two direction blocks */}
      <div className="space-y-3">
        <div className="panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="h-5 w-36 rounded bg-line shimmer" />
            <div className="h-5 w-16 rounded bg-line shimmer" />
          </div>
          <div className="flex items-baseline justify-between border-t border-line/40 pt-2">
            <div className="h-8 w-24 rounded bg-line shimmer" />
            <div className="h-4 w-20 rounded bg-line shimmer" />
          </div>
        </div>
        <div className="panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="h-5 w-36 rounded bg-line shimmer" />
            <div className="h-5 w-16 rounded bg-line shimmer" />
          </div>
          <div className="flex items-baseline justify-between border-t border-line/40 pt-2">
            <div className="h-8 w-24 rounded bg-line shimmer" />
            <div className="h-4 w-20 rounded bg-line shimmer" />
          </div>
        </div>
      </div>
    </div>
  );
}
