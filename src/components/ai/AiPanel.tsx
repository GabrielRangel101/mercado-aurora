import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Sparkles, SendHorizontal, Trash2, X } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { useAi, type Mensagem } from "./ai-store";
import { ChartBox, useMounted } from "@/components/aurora/kit";
import type { Bloco, Resposta } from "@/lib/ask";
import { brlCompact, dec, int, pct } from "@/lib/format";
import { cn } from "@/lib/utils";

const GRUPOS: { titulo: string; itens: string[] }[] = [
  { titulo: "Margem e perdas", itens: ["Por que a perda do Jardins é alta?", "Margem real por categoria", "Perda por motivo"] },
  { titulo: "Ruptura", itens: ["Quais 10 SKUs concentram a venda perdida?", "Ruptura por dia da semana", "Venda perdida na Black Friday"] },
  { titulo: "Lojas e operação", itens: ["Compare Centro e Jardins", "Ticket médio no fim de semana", "Onde falta caixa?"] },
  { titulo: "Ação", itens: ["Simule recuperar 30% da venda perdida", "Resumo: onde agir primeiro?", "O que sai junto com leite?"] },
];

function fmtY(f: "brl" | "pct" | "int" | "dec", v: number): string {
  return f === "brl" ? brlCompact(v) : f === "pct" ? pct(v, 1) : f === "int" ? int(v) : dec(v, 1);
}

function BlocoView({ b }: { b: Bloco }) {
  const mounted = useMounted();
  if (b.tipo === "stats") {
    return (
      <div className="grid grid-cols-2 gap-2">
        {b.itens.map((i, k) => (
          <div key={k} className={cn("rounded-lg bg-[var(--ai-card)] p-3", b.itens.length % 2 === 1 && k === 0 && "col-span-2")}>
            <p className="text-[11px] text-[var(--ai-muted)]">{i.rotulo}</p>
            <p className="mt-0.5 font-display text-[22px] font-semibold leading-tight text-[var(--ai-fg)]">{i.valor}</p>
            {i.sub && <p className="mt-0.5 text-[11px] text-[var(--ai-muted)]">{i.sub}</p>}
          </div>
        ))}
      </div>
    );
  }
  if (b.tipo === "barras") {
    const max = Math.max(...b.itens.map((i) => Math.abs(i.valor)), 0.0001);
    return (
      <ul className="space-y-2.5 rounded-lg bg-[var(--ai-card)] p-3">
        {b.itens.map((i, k) => (
          <li key={k}>
            <div className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="min-w-0 truncate text-[var(--ai-fg)]">{i.rotulo}</span>
              <span className="shrink-0 font-medium tabular-nums text-[var(--ai-fg)]">{i.texto}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, (100 * Math.abs(i.valor)) / max)}%`, background: k === b.destaque ? "var(--brand)" : "hsl(150 45% 52%)" }} />
            </div>
            {i.sub && <p className="mt-0.5 text-[10.5px] text-[var(--ai-muted)]">{i.sub}</p>}
          </li>
        ))}
      </ul>
    );
  }
  if (b.tipo === "linha") {
    const ys = b.pontos.map((p) => p.y);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const folga = (max - min) * 0.2 || 1;
    return (
      <div className="rounded-lg bg-[var(--ai-card)] p-2 pt-3">
        <ChartBox height={170}>
          {mounted && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={b.pontos} margin={{ top: 4, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                <XAxis dataKey="x" tick={{ fontSize: 10, fill: "var(--ai-muted)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis domain={[min - folga, max + folga]} tick={{ fontSize: 10, fill: "var(--ai-muted)" }} tickLine={false} axisLine={false} width={46} tickFormatter={(v: number) => fmtY(b.formato, v)} />
                <RTooltip contentStyle={{ background: "hsl(165 30% 14%)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, fontSize: 12, color: "#f6efe0" }} formatter={(v: number) => [fmtY(b.formato, v), b.rotuloY]} />
                <Line type="monotone" dataKey="y" stroke="var(--brand)" strokeWidth={2.2} dot={{ r: 2.5, fill: "var(--brand)" }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartBox>
      </div>
    );
  }
  return (
    <div className="scrollbar-thin overflow-x-auto rounded-lg bg-[var(--ai-card)] p-2">
      <table className="w-full text-[11.5px]">
        <thead>
          <tr className="text-left text-[10px] text-[var(--ai-muted)]">
            {b.colunas.map((c, i) => (
              <th key={i} className="px-1.5 py-1 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.linhas.map((l, i) => (
            <tr key={i} className="border-t border-white/8 align-top">
              {l.map((c, k) => (
                <td key={k} className={cn("px-1.5 py-1.5 tabular-nums text-[var(--ai-fg)]", k === 0 ? "min-w-[8rem] font-medium" : "")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RespostaView({ r, onPergunta }: { r: Resposta; onPergunta: (q: string) => void }) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-[15px] font-semibold leading-snug text-[var(--ai-fg)]">{r.titulo}</h3>
        {r.cobertura === "parcial" && <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">recorte parcial</span>}
        {r.cobertura === "fora" && <span className="rounded bg-white/12 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ai-muted)]">fora do dado</span>}
      </div>
      <p className="text-[12.5px] leading-relaxed text-[var(--ai-fg)]/90">{r.texto}</p>
      {r.blocos.map((b, i) => (
        <BlocoView key={i} b={b} />
      ))}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-[var(--ai-muted)]">
        {r.fonte && <span>{r.fonte}</span>}
        {r.view && (
          <Link to="/" search={{ view: r.view }} className="inline-flex items-center gap-0.5 font-medium text-[var(--brand)] hover:underline">
            Abrir tela <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        )}
      </div>
      {r.seguintes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {r.seguintes.map((s) => (
            <button key={s} type="button" onClick={() => onPergunta(s)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-[var(--ai-fg)]/85 transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Conversa({ m, onPergunta }: { m: Mensagem; onPergunta: (q: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <p className="max-w-[88%] rounded-2xl rounded-br-sm bg-[var(--brand)] px-3 py-2 text-[12.5px] font-medium leading-snug text-white">{m.pergunta}</p>
      </div>
      {m.resposta ? (
        <RespostaView r={m.resposta} onPergunta={onPergunta} />
      ) : (
        <p className="flex items-center gap-2 text-[12px] text-[var(--ai-muted)]" role="status">
          <span className="inline-flex gap-1" aria-hidden>
            <span className="size-1.5 animate-bounce rounded-full bg-[var(--brand)]" />
            <span className="size-1.5 animate-bounce rounded-full bg-[var(--brand)] [animation-delay:120ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-[var(--brand)] [animation-delay:240ms]" />
          </span>
          Consultando os dados
        </p>
      )}
    </div>
  );
}

export function AiPanel() {
  const ai = useAi();
  const [texto, setTexto] = useState("");
  const fim = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ai.aberto) input.current?.focus();
  }, [ai.aberto]);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [ai.mensagens]);

  useEffect(() => {
    if (!ai.aberto) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") ai.fechar();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [ai]);

  const enviar = (q: string) => {
    if (!q.trim()) return;
    ai.perguntar(q);
    setTexto("");
  };

  return (
    <>
      {ai.aberto && <button type="button" aria-label="Fechar Modo IA" onClick={ai.fechar} className="fixed inset-0 z-40 bg-black/40 xl:hidden" />}
      <aside
        aria-label="Modo IA"
        inert={!ai.aberto}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-[26.5rem] flex-col border-l border-white/10 bg-[var(--ai-bg)] text-[var(--ai-fg)] shadow-2xl transition-transform duration-200 xl:w-[26.5rem]",
          ai.aberto ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
      >
        <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <span className="grid size-7 place-items-center rounded-lg bg-[var(--brand)] text-white">
            <Sparkles className="size-4" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="font-display text-[15px] font-semibold">Modo IA</p>
            <p className="text-[10.5px] text-[var(--ai-muted)]">Pergunte sobre qualquer dado do painel</p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {ai.mensagens.length > 0 && (
              <button type="button" onClick={ai.limpar} aria-label="Limpar conversa" className="grid size-8 place-items-center rounded-md text-[var(--ai-muted)] hover:bg-white/10 hover:text-[var(--ai-fg)]">
                <Trash2 className="size-4" aria-hidden />
              </button>
            )}
            <button type="button" onClick={ai.fechar} aria-label="Fechar Modo IA" className="grid size-8 place-items-center rounded-md text-[var(--ai-muted)] hover:bg-white/10 hover:text-[var(--ai-fg)]">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </header>

        <div className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {ai.mensagens.length === 0 ? (
            <div className="space-y-4">
              <p className="text-[12.5px] leading-relaxed text-[var(--ai-fg)]/85">
                Cruzo loja, categoria, mês, dia da semana, SKU e marca, e entendo Black Friday, Natal e Páscoa. Todo número sai dos mesmos arquivos do dashboard; se o dado não existe, eu digo.
              </p>
              {GRUPOS.map((g) => (
                <div key={g.titulo}>
                  <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ai-muted)]">{g.titulo}</p>
                  <div className="flex flex-col gap-1.5">
                    {g.itens.map((s) => (
                      <button key={s} type="button" onClick={() => enviar(s)} className="rounded-lg border border-white/12 px-3 py-2 text-left text-[12.5px] text-[var(--ai-fg)]/90 transition-colors hover:border-[var(--brand)] hover:bg-white/5">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            ai.mensagens.map((m) => <Conversa key={m.id} m={m} onPergunta={enviar} />)
          )}
          <div ref={fim} />
        </div>

        <form
          className="flex items-center gap-2 border-t border-white/10 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            enviar(texto);
          }}
        >
          <label htmlFor="ai-input" className="sr-only">
            Pergunta ao Modo IA
          </label>
          <input
            id="ai-input"
            ref={input}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Ex.: qual categoria perde mais no Jardins?"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/6 px-3 py-2.5 text-[13px] text-[var(--ai-fg)] outline-none placeholder:text-[var(--ai-muted)] focus:border-[var(--brand)]"
          />
          <button type="submit" disabled={!texto.trim()} aria-label="Enviar pergunta" className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--brand)] text-white transition-opacity disabled:opacity-40">
            <SendHorizontal className="size-4" aria-hidden />
          </button>
        </form>
      </aside>
    </>
  );
}

