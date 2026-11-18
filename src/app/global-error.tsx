"use client";
import { useEffect } from "react";
import Link from "next/link";
import { reportClientError } from "@/lib/analytics/health";

export default function GlobalError({
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
    <html lang="en">
      <body className="min-h-screen bg-[#0f1316] text-[#e6edf3] antialiased flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-2xl border border-[#262c36] bg-[#161b22] p-6 shadow-2xl space-y-4">
          <h2 className="text-xl font-bold text-[#e6edf3]">
            Something went wrong / 出了點問題
          </h2>
          <p className="text-sm text-[#8b949e]">
            An unexpected error occurred. You can retry or head back to Home.
          </p>
          <p className="text-sm text-[#8b949e]">
            發生非預期的錯誤。你可以點擊重試，或返回首頁。
          </p>
          <div className="flex flex-col gap-3 pt-2 sm:flex-row">
            <button
              type="button"
              onClick={() => reset()}
              className="flex min-h-[48px] flex-1 items-center justify-center rounded-xl bg-[#58a6ff] px-4 py-3 text-base font-bold text-[#0f1316] hover:bg-[#58a6ff]/90 active:scale-95 cursor-pointer"
            >
              Try again / 再試一次
            </button>
            <Link
              href="/"
              className="flex min-h-[48px] flex-1 items-center justify-center rounded-xl border border-[#30363d] bg-[#21262d] px-4 py-3 text-base font-bold text-[#e6edf3] hover:bg-[#30363d] active:scale-95 text-center cursor-pointer"
            >
              Go to Home / 回首頁
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
