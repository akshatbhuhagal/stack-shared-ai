"use client";
export default function DashboardError({ error }: { error: Error }) {
  return <p>Error: {error.message}</p>;
}
