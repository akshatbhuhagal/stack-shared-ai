"use client";
import { ReactNode } from "react";

export function Button({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return <button onClick={onClick}>{children}</button>;
}
