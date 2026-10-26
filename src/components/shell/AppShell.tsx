import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import type { ViewId } from "@/lib/insights";

export const VIEWS: { id: ViewId; label: string }[] = [
  { id: "geral", label: "Visão geral" },
  { id: "margem", label: "Margem" },
  { id: "ruptura", label: "Ruptura" },
  { id: "perdas", label: "Perdas" },
  { id: "lojas", label: "Lojas e caixas" },
  { id: "cesta", label: "Cesta" },
  { id: "alertas", label: "Alertas" },
];

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Mercado Aurora">
      <rect width="64" height="64" rx="14" fill="#14523e" />
      <path d="M12 44a20 20 0 0 1 40 0" fill="none" stroke="#f6efe0" strokeWidth="5" strokeLinecap="round" />
      <path d="M21 44a11 11 0 0 1 22 0" fill="none" stroke="#f08a1c" strokeWidth="5" strokeLinecap="round" />
      <line x1="10" y1="51" x2="54" y2="51" stroke="#f6efe0" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function AppShell({ view, periodo, children }: { view: ViewId; periodo: string; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-2.5">
          <Link to="/" search={{ view: "geral" }} className="flex shrink-0 items-center gap-2.5">
            <Logo className="size-8" />
            <div className="leading-tight">
              <p className="font-display text-[17px] font-semibold tracking-tight text-foreground">Mercado Aurora</p>
              <p className="hidden text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:block">Radar de margem e ruptura</p>
            </div>
          </Link>
          <nav aria-label="Telas do dashboard" className="ml-2 hidden items-center gap-1 lg:flex">
            {VIEWS.map((v) => (
              <TabLink key={v.id} id={v.id} label={v.label} on={v.id === view} />
            ))}
          </nav>
          <p className="ml-auto text-right text-[11px] leading-tight text-muted-foreground">
            {periodo}
            <span className="block">dados sintéticos</span>
          </p>
        </div>
        <nav aria-label="Telas do dashboard" className="scrollbar-thin flex gap-1 overflow-x-auto px-4 pb-2 lg:hidden">
          {VIEWS.map((v) => (
            <TabLink key={v.id} id={v.id} label={v.label} on={v.id === view} />
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-5">{children}</main>
      <footer className="mx-auto max-w-[1400px] px-4 pb-8 pt-2 text-[11px] leading-relaxed text-muted-foreground">
        Rede fictícia de 4 supermercados. Marcas, lojas e números são inventados: o gerador (Python, seed fixa) simula o estoque dia a dia, e a ruptura e a perda nascem dessa simulação.
      </footer>
    </div>
  );
}

function TabLink({ id, label, on }: { id: ViewId; label: string; on: boolean }) {
  return (
    <Link
      to="/"
      search={{ view: id }}
      aria-current={on ? "page" : undefined}
      className={cn("relative shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors", on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}
    >
      {label}
    </Link>
  );
}
