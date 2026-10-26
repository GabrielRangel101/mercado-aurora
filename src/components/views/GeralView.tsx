import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Panel, Kpi, ChartBox, ChartTip, COR, EIXO, Tag, Nota } from "@/components/aurora/kit";
import { DADOS, INSIGHTS } from "@/lib/aurora-data";
import { brlCompact, dec, mesLabel, pct, pp } from "@/lib/format";
import { ganhoSimulado, textoGanho } from "@/lib/insights";

const TOM = { risco: "risco", atencao: "atencao", info: "neutro" } as const;
const ROTULO = { risco: "Agir", atencao: "Atenção", info: "Informação" } as const;

export function GeralView() {
  const { meta, kpisMensais: km, categorias } = DADOS;
  const r = meta.resumo;
  const serie = (k: keyof (typeof km)[number]) => km.map((m) => m[k] as number);

  const mensal = km.map((m) => ({ mes: m.mes, receita: m.receita / 1e6, margemReal: m.margem_real_pct }));
  const ponte = [
    { nome: "Margem bruta", base: 0, valor: r.margem_bruta_pct, cor: COR.azul },
    { nome: "Perdas", base: r.margem_real_pct, valor: r.margem_bruta_pct - r.margem_real_pct, cor: COR.perigo },
    { nome: "Margem real", base: 0, valor: r.margem_real_pct, cor: COR.verde },
  ];
  const cats = [...categorias].sort((a, b) => b.receita - a.receita).map((c) => ({ categoria: c.categoria, bruta: c.margem_bruta_pct, real: c.margem_real_pct }));

  return (
    <div className="space-y-4">
      <section aria-label="Indicadores da rede" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Receita" valor={brlCompact(r.receita)} sub={`${dec(r.cupons / 1000, 0)} mil cupons · ticket R$ ${dec(r.ticket_medio, 0)}`} spark={serie("receita")} info="Receita dos 12 meses, quatro lojas." />
        <Kpi label="Margem bruta" valor={pct(r.margem_bruta_pct)} sub="Receita menos custo da mercadoria vendida" spark={serie("margem_bruta_pct")} />
        <Kpi label="Margem real" valor={pct(r.margem_real_pct)} tom="bom" destaque sub={`${pp(r.margem_real_pct - r.margem_bruta_pct)} por causa das perdas`} spark={serie("margem_real_pct")} info="(Receita − CMV − perda a custo) ÷ receita. É a métrica central do painel." />
        <Kpi label="Perdas" valor={pct(r.perda_pct_receita, 2)} tom="ruim" sub={`${brlCompact(r.perda_custo)} a custo`} spark={serie("perda_pct_receita")} info="Vencimento, avaria, furto e quebra operacional, valorizados a custo." />
        <Kpi label="Ruptura" valor={pct(r.taxa_ruptura_pct, 2)} tom="ruim" sub={`Classe A: ${pct(r.taxa_ruptura_A_pct, 2)}`} spark={serie("taxa_ruptura_pct")} info="SKU-loja-dias com demanda não atendida ÷ SKU-loja-dias com loja aberta." />
        <Kpi label="Venda perdida" valor={brlCompact(r.venda_perdida)} tom="ruim" sub={`${pct(r.venda_perdida_pct_receita, 2)} da receita`} spark={serie("venda_perdida")} info="Unidades não atendidas × preço × 0,75 (premissa: 25% dos clientes levam outro item)." />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Receita e margem real por mês" className="lg:col-span-2" summary="barras: receita (R$ mi) · linha: margem real (%)">
          <ChartBox height={270}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={mensal} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid stroke={COR.grade} vertical={false} />
                <XAxis dataKey="mes" tickFormatter={mesLabel} tick={EIXO} tickLine={false} axisLine={false} />
                <YAxis yAxisId="l" tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => dec(v, 0)} />
                <YAxis yAxisId="r" orientation="right" domain={[22, 28]} tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${dec(v, 0)}%`} />
                <RTooltip content={<ChartTip titulo={(l) => mesLabel(String(l))} formato={(v, n) => (n === "Receita" ? `R$ ${dec(v, 2)} mi` : pct(v, 2))} />} />
                <Bar yAxisId="l" dataKey="receita" name="Receita" fill={COR.azul} fillOpacity={0.35} radius={[3, 3, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="margemReal" name="Margem real" stroke={COR.verde} strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartBox>
        </Panel>

        <Panel title="Ponte da margem" info="Quanto da margem bruta sobra depois das perdas. A venda perdida por ruptura não entra aqui: é receita que nunca aconteceu.">
          <ChartBox height={200}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ponte} margin={{ top: 18, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={COR.grade} vertical={false} />
                <XAxis dataKey="nome" tick={EIXO} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 30]} tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                <Bar dataKey="base" stackId="p" fill="transparent" isAnimationActive={false} />
                <Bar dataKey="valor" stackId="p" radius={[3, 3, 0, 0]} isAnimationActive={false} label={{ position: "top", fontSize: 11, fill: "var(--foreground)", formatter: (v: number) => dec(v, 1) }}>
                  {ponte.map((p) => (
                    <Cell key={p.nome} fill={p.cor} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
          <Nota>
            As perdas consomem {pp(r.margem_bruta_pct - r.margem_real_pct)} de margem, ou {brlCompact(r.perda_custo)} em um ano. A ruptura tira mais {brlCompact(r.venda_perdida)} de venda.
          </Nota>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title="Margem bruta × real por categoria" className="lg:col-span-3" summary="ordenadas por receita">
          <ChartBox height={400}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cats} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }} barCategoryGap={6}>
                <CartesianGrid stroke={COR.grade} horizontal={false} />
                <XAxis type="number" tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                <YAxis type="category" dataKey="categoria" width={130} tick={EIXO} tickLine={false} axisLine={false} />
                <RTooltip content={<ChartTip formato={(v) => pct(v)} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="bruta" name="Margem bruta" fill={COR.azul} fillOpacity={0.45} radius={[0, 3, 3, 0]} isAnimationActive={false} />
                <Bar dataKey="real" name="Margem real" fill={COR.verde} radius={[0, 3, 3, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
        </Panel>

        <Panel title="Onde agir primeiro" className="lg:col-span-2" summary="leitura automática dos dados">
          <ul className="space-y-3">
            {INSIGHTS.map((i) => (
              <li key={i.id} className="rounded-lg border bg-background/40 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <Tag tom={TOM[i.tom]}>{ROTULO[i.tom]}</Tag>
                  <Link to="/" search={{ view: i.view }} className="ml-auto text-[11px] font-medium text-primary hover:underline">
                    Ver detalhe
                  </Link>
                </div>
                <h3 className="text-[13px] font-semibold leading-snug text-foreground">{i.titulo}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{i.texto}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Simulador />
    </div>
  );
}

function Simulador() {
  const [recupera, setRecupera] = useState(30);
  const [reduz, setReduz] = useState(20);
  const g = ganhoSimulado(DADOS, recupera, reduz);
  const r = DADOS.meta.resumo;
  return (
    <Panel title="Quanto vale agir" summary="simulador" info="Estimativa simples: venda recuperada rende a margem bruta média da rede; perda evitada economiza o custo. Sem efeitos de segunda ordem.">
      <div className="grid gap-6 md:grid-cols-3">
        <label className="block text-xs">
          <span className="flex justify-between font-medium text-foreground">
            Recuperar da venda perdida <span className="tabular-nums">{recupera}%</span>
          </span>
          <input type="range" min={0} max={80} step={5} value={recupera} onChange={(e) => setRecupera(Number(e.target.value))} className="mt-2 w-full" />
          <span className="mt-1 block text-[11px] text-muted-foreground">Venda perdida atual: {brlCompact(r.venda_perdida)}</span>
        </label>
        <label className="block text-xs">
          <span className="flex justify-between font-medium text-foreground">
            Reduzir a perda <span className="tabular-nums">{reduz}%</span>
          </span>
          <input type="range" min={0} max={60} step={5} value={reduz} onChange={(e) => setReduz(Number(e.target.value))} className="mt-2 w-full" />
          <span className="mt-1 block text-[11px] text-muted-foreground">Perda atual: {brlCompact(r.perda_custo)} a custo</span>
        </label>
        <div className="rounded-lg bg-primary/8 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ganho estimado</p>
          <p className="mt-1 font-display text-2xl font-semibold text-primary">{brlCompact(g.total)}</p>
          <p className="text-xs text-muted-foreground">
            {textoGanho(g)}. Margem real iria de {pct(r.margem_real_pct)} para {pct(r.margem_real_pct + g.ppMargem)}.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {brlCompact(g.margemRecuperada)} de margem em venda recuperada + {brlCompact(g.perdaEvitada)} de perda evitada.
          </p>
        </div>
      </div>
    </Panel>
  );
}
