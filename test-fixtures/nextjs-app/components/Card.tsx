import { ReactNode } from "react";

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export default function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid">{children}</div>;
}
