"use client";
import { useEffect } from "react";
import Link from "next/link";
import { reportClientError } from "@/lib/analytics/health";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    let file: string | undefined;
    let line: number | undefined;
    let col: number | undefined;

    if (error.stack) {
      const match = error.stack.match(/at\s+(?:.*?\s+\()?([^\s)]+):(\d+):(\d+)\)?/);
      if (match) {
        file = match[1];
        line = Number(match[2]);
        col = Number(match[3]);
      }
    }

    reportClientError({
      kind: "boundary",
      msg: error.message || String(error),
      file,
      line,
      col,
      route: typeof location !== "undefined" ? location.pathname : "/",
    });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-8 text-center">
      <div className="panel max-w-md w-full space-y-4 p-6 text-left shadow-lg">
        <h2 className="text-xl font-bold text-ink">
          Something went wrong / 出了點問題
        </h2>
        <p className="text-sm text-muted">
          An unexpected error occurred. You can retry or head back to Home.
        </p>
        <p className="text-sm text-muted">
          發生非預期的錯誤。你可以點擊重試，或返回首頁。
        </p>

        <div className="flex flex-col gap-3 pt-2 sm:flex-row">
          <button
            type="button"
            onClick={() => reset()}
            className="btn btn-primary flex min-h-[48px] flex-1 items-center justify-center px-4 py-3 text-base font-semibold active:scale-95 cursor-pointer"
          >
            Try again / 再試一次
          </button>
          <Link
            href="/"
            className="btn btn-secondary flex min-h-[48px] flex-1 items-center justify-center px-4 py-3 text-base font-semibold active:scale-95 text-center cursor-pointer"
          >
            Go to Home / 回首頁
          </Link>
        </div>
      </div>
    </div>
  );
}
