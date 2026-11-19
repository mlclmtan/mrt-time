export default function TripLoading() {
  return (
    <div className="space-y-4 pt-3" aria-busy="true" aria-label="Loading trip">
      {/* 1. Progress rail */}
      <div className="panel p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="h-4 w-28 rounded bg-line shimmer" />
          <div className="h-4 w-16 rounded bg-line shimmer" />
        </div>
        <div className="flex items-center gap-1.5 pt-1">
          <div className="h-2 flex-1 rounded-full bg-line shimmer" />
          <div className="h-2 flex-1 rounded-full bg-line shimmer" />
          <div className="h-2 flex-1 rounded-full bg-line shimmer" />
          <div className="h-2 flex-1 rounded-full bg-line shimmer" />
          <div className="h-2 flex-1 rounded-full bg-line shimmer" />
          <div className="h-2 flex-1 rounded-full bg-line shimmer" />
        </div>
      </div>

      {/* 2. Big card */}
      <div className="panel p-4 space-y-4 min-h-[160px] flex flex-col justify-between">
        <div className="space-y-2">
          <div className="h-4 w-20 rounded bg-line shimmer" />
          <div className="h-9 w-44 rounded bg-line shimmer" />
          <div className="h-4 w-32 rounded bg-line shimmer" />
        </div>
        <div className="flex items-center justify-between border-t border-line/50 pt-3">
          <div className="h-4 w-24 rounded bg-line shimmer" />
          <div className="h-4 w-16 rounded bg-line shimmer" />
        </div>
      </div>

      {/* 3. Big button */}
      <div className="h-[72px] min-h-[72px] w-full rounded-2xl bg-line shimmer" />
    </div>
  );
}
