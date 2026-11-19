"use client";

import dynamic from "next/dynamic";
import StationsLoading from "@/app/stations/loading";

export const ClientStations = dynamic(
  () => import("@/components/stations-list").then((mod) => mod.StationsList),
  {
    ssr: false,
    loading: () => <StationsLoading />,
  },
);
