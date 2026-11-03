"use client";
import { useEffect } from "react";
export function PwaRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        // Always fetch sw.js from the network so a deploy's worker wins.
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {});
  }, []);
  return null;
}
