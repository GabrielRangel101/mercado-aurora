import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { BarList, ChartBox, ChartTip, COR, COR_LOJA, EIXO, HeatGrid, Kpi, Panel, Segmented, KpiStrip } from "@/components/aurora/kit";
import { DADOS, EVENTOS_SEMANAIS, LOJAS_CURTAS } from "@/lib/aurora-data";
import { brl, brlCompact, dec, diaLabel, pct } from "@/lib/format";

const ORDEM_DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];

export function RupturaView() {
  const { rupturaSemanal, rupturaSkus, rupturaDow, categorias, meta, lojas } = DADOS;
  const r = meta.resumo;
  const [metrica, setMetrica] = useState<"geral" | "A">("geral");

  const semanas = useMemo(() => {
    const mapa = new Map<string, Record<string, number | string>>();
    for (const x of rupturaSemanal) {
      const linha = mapa.get(x.semana) ?? { semana: x.semana };
      linha[`g${x.loja_id}`] = x.taxa_ruptura_pct;
      linha[`a${x.loja_id}`] = x.taxa_ruptura_A_pct;
      linha[`v${x.loja_id}`] = x.venda_perdida;
      mapa.set(x.semana, linha);
    }
    return Array.from(mapa.values()).sort((a, b) => String(a["semana"]).localeCompare(String(b["semana"])));
  }, [rupturaSemanal]);

  // mesmos marcadores de semana nos dois gráficos semanais
  const ticksSemana = useMemo(() => semanas.filter((_, i) => i % 4 === 0).map((x) => String(x["semana"])), [semanas]);
  const topo = rupturaSkus.slice(0, 15);
  const maxVp = Math.max(...topo.map((s) => s.venda_perdida));
  const porCategoria = [...categorias].sort((a, b) => b.taxa_ruptura_pct - a.taxa_ruptura_pct);

  const linhasDow = ORDEM_DIAS.map((dia) => {
    const vals = lojas.map((l) => rupturaDow.find((x) => x.loja_id === l.loja_id && x.dia === dia)?.taxa_ruptura_pct ?? 0);
    return {
      label: dia,
      cells: vals.map((v) => ({ texto: pct(v), t: 1 - Math.max(0, Math.min(1, (v - 1.5) / 4.5)), dica: `${dia}: ${pct(v, 2)} de ruptura` })),
    };
  });

  return (
    <div className="space-y-4">
      <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="Taxa de ruptura" valor={pct(r.taxa_ruptura_pct, 2)} tom="ruim" sub="SKU-loja-dias sem produto" />
        <Kpi label="Ruptura classe A" valor={pct(r.taxa_ruptura_A_pct, 2)} tom="ruim" sub="itens que mais pesam na receita" />
        <Kpi label="Venda perdida" valor={brlCompact(r.venda_perdida)} tom="ruim" sub={`${pct(r.venda_perdida_pct_receita, 2)} da receita`} destaque />
        <Kpi label="Concentração" valor={pct(topo[topo.length - 1].pct_acum, 0)} sub={`da venda perdida está em ${topo.length} SKUs`} info="Pareto da venda perdida: agir sobre poucos itens resolve boa parte do problema." />
      </KpiStrip>

      <Panel
        ask="Como evoluiu a taxa de ruptura por mês?"
        title="Taxa de ruptura por semana"
        summary={`semanas de ${diaLabel(String(semanas[0]?.["semana"]))} a ${diaLabel(String(semanas[semanas.length - 1]?.["semana"]))} · marcadores: eventos sazonais`}
        actions={
          <Segmented
            label="Métrica"
            value={metrica}
            onChange={setMetrica}
            options={[
              { value: "geral", label: "Todos os SKUs" },
              { value: "A", label: "Classe A" },
            ]}
          />
        }
        info="A reposição segue a média recente de vendas, então demora a reagir a picos de demanda: a ruptura sobe nas semanas de Black Friday, Natal e Páscoa."
      >
        <ChartBox height={360}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={semanas} margin={{ top: 18, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={COR.grade} vertical={false} />
              <XAxis dataKey="semana" ticks={ticksSemana} interval={0} tickFormatter={diaLabel} tick={EIXO} tickLine={false} axisLine={false} />
              <YAxis tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
              <RTooltip content={<ChartTip titulo={(l) => `Semana de ${diaLabel(String(l))}`} formato={(v) => pct(v, 2)} />} />
              {EVENTOS_SEMANAIS.map((e) => (
                <ReferenceLine key={e.semana} x={e.semana} stroke={COR.laranja} strokeDasharray="4 3" label={{ value: e.rotulo, position: "top", fontSize: 10, fill: COR.laranja }} />
              ))}
              {lojas.map((l, i) => (
                <Line key={l.loja_id} type="monotone" dataKey={`${metrica === "geral" ? "g" : "a"}${l.loja_id}`} name={LOJAS_CURTAS[i]} stroke={COR_LOJA[i]} strokeWidth={1.8} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartBox>
        <Legenda />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel ask="Quais 10 SKUs concentram a venda perdida?" title="Pareto da venda perdida" className="xl:col-span-3" summary="top 15 SKUs" info="A última coluna compara a venda perdida do SKU com a receita que o próprio SKU fez: 6,6% significa que, para cada R$ 100 vendidos desse item, outros R$ 6,60 deixaram de ser vendidos por falta. Não é % da receita da rede.">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">SKU</th>
                  <th className="w-[38%] px-2 py-1 font-medium">Venda perdida</th>
                  <th className="px-2 py-1 text-right font-medium">% acum.</th>
                  <th className="py-1 pl-2 text-right font-medium" title="Venda perdida do SKU ÷ receita do próprio SKU">Perdido ÷ receita do SKU</th>
                </tr>
              </thead>
              <tbody>
                {topo.map((s) => (
                  <tr key={s.sku_id} className="border-t">
                    <td className="max-w-[14rem] truncate py-1.5 pr-2 text-foreground" title={`${s.nome} · ${s.categoria}`}>
                      {s.nome}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/70">
                          <div className="h-full rounded-full" style={{ width: `${(100 * s.venda_perdida) / maxVp}%`, background: COR.perigo }} />
                        </div>
                        <span className="w-14 shrink-0 text-right text-foreground">{brlCompact(s.venda_perdida)}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right">{pct(s.pct_acum, 0)}</td>
                    <td className="py-1.5 pl-2 text-right">{pct(s.perda_sobre_receita_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel ask="Ruptura por dia da semana" title="Ruptura por dia da semana" className="xl:col-span-2" info="Quanto mais vermelho, maior a taxa de ruptura naquele dia.">
          <HeatGrid corner="Dia" cols={LOJAS_CURTAS} rows={linhasDow} />
        </Panel>
      </div>

      <CausasRuptura />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel ask="Venda perdida por loja" title="Venda perdida por semana" summary="R$, empilhado por loja">
          <ChartBox height={300}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={semanas} margin={{ top: 8, right: 12, bottom: 0, left: -4 }}>
                <CartesianGrid stroke={COR.grade} vertical={false} />
                <XAxis dataKey="semana" ticks={ticksSemana} interval={0} tickFormatter={diaLabel} tick={EIXO} tickLine={false} axisLine={false} />
                <YAxis tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <RTooltip content={<ChartTip titulo={(l) => `Semana de ${diaLabel(String(l))}`} formato={(v) => brlCompact(v)} />} />
                {lojas.map((l, i) => (
                  <Bar key={l.loja_id} dataKey={`v${l.loja_id}`} stackId="v" name={LOJAS_CURTAS[i]} fill={COR_LOJA[i]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
        </Panel>

        <Panel ask="Qual a pior categoria em ruptura?" title="Ruptura por categoria" summary="% de SKU-loja-dias sem produto">
          <BarList
            items={porCategoria.map((c) => ({
              label: c.categoria,
              value: c.taxa_ruptura_pct,
              texto: pct(c.taxa_ruptura_pct, 2),
              cor: c.taxa_ruptura_pct > r.taxa_ruptura_pct ? COR.perigo : COR.cinza,
              sub: `Venda perdida ${brlCompact(c.venda_perdida)}`,
            }))}
          />
        </Panel>
      </div>
    </div>
  );
}

function Legenda() {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {LOJAS_CURTAS.map((n, i) => (
        <li key={n} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: COR_LOJA[i] }} aria-hidden />
          {n}
        </li>
      ))}
    </ul>
  );
}

const COR_CAUSA: Record<string, string> = { "Atraso do fornecedor": COR.perigo, "Pedido subdimensionado": COR.laranja, "Pico de demanda": COR.azul };

function CausasRuptura() {
  const { rupturaCausas: rc } = DADOS;
  const cats = Array.from(new Set(rc.por_categoria.map((x) => x.categoria)));
  const causas = rc.por_causa.map((c) => c.causa);
  const porCat = cats
    .map((c) => {
      const linha: Record<string, number | string> = { categoria: c };
      let tot = 0;
      for (const x of rc.por_categoria.filter((y) => y.categoria === c)) {
        linha[x.causa] = x.venda_perdida;
        tot += x.venda_perdida;
      }
      linha["total"] = tot;
      return linha;
    })
    .sort((a, b) => Number(b["total"]) - Number(a["total"]));
  const acaoPor: Record<string, string> = {
    "Atraso do fornecedor": "Cobrar fornecedor, negociar prazo e multa por atraso",
    "Pedido subdimensionado": "Rever estoque de segurança do SKU",
    "Pico de demanda": "Antecipar pedido em datas sazonais",
  };
  return (
    <Panel
      title="Quem aciona: causa da ruptura"
      summary="venda perdida por causa, 12 meses"
      ask="Quanto da venda perdida vem de atraso do fornecedor?"
      info={rc.nota}
    >
      <div className="grid gap-3 md:grid-cols-3">
        {rc.por_causa.map((c) => (
          <div key={c.causa} className="rounded-lg border bg-background/40 p-3">
            <p className="flex items-center gap-2 text-[12px] font-medium text-foreground">
              <span className="size-2 rounded-full" style={{ background: COR_CAUSA[c.causa] }} aria-hidden />
              {c.causa}
            </p>
            <p className="mt-1 font-display text-[22px] font-semibold leading-none text-foreground">{brlCompact(c.venda_perdida)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {pct(c.pct_venda_perdida, 0)} da venda perdida · {dec(c.dias, 0)} dias-SKU
            </p>
            <p className="mt-1.5 text-[11px] text-foreground">Quem aciona: {c.causa === "Atraso do fornecedor" ? "Compras" : c.causa === "Pedido subdimensionado" ? "Compras e planejamento" : "Planejamento de demanda"}. {acaoPor[c.causa]}.</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div>
          <p className="mb-1 text-[12px] font-medium text-foreground">Causa por categoria (R$ perdidos)</p>
          <ChartBox height={320}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porCat} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 16 }}>
                <CartesianGrid stroke={COR.grade} horizontal={false} />
                <XAxis type="number" tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <YAxis type="category" dataKey="categoria" width={118} tick={EIXO} tickLine={false} axisLine={false} interval={0} />
                <RTooltip content={<ChartTip formato={(v) => brlCompact(v)} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {causas.map((c) => (
                  <Bar key={c} dataKey={c} stackId="c" fill={COR_CAUSA[c]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-1 text-[12px] font-medium text-foreground">Fornecedores (a marca faz o papel de fornecedor)</p>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-left text-[11px] text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">Fornecedor</th>
                    <th className="px-2 py-1 text-right font-medium">Pedidos no prazo</th>
                    <th className="px-2 py-1 text-right font-medium">Atraso médio</th>
                    <th className="py-1 pl-2 text-right font-medium">Venda perdida por atraso</th>
                  </tr>
                </thead>
                <tbody>
                  {rc.fornecedores.map((f) => (
                    <tr key={f.fornecedor} className="border-t">
                      <td className="py-1.5 pr-2 text-foreground">{f.fornecedor}</td>
                      <td className="px-2 py-1.5 text-right">{pct(f.pct_no_prazo, 1)}</td>
                      <td className="px-2 py-1.5 text-right">{dec(f.atraso_medio_dias, 1)} d</td>
                      <td className="py-1.5 pl-2 text-right text-foreground">{brlCompact(f.venda_perdida_atraso)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <p className="mb-1 text-[12px] font-medium text-foreground">Prazo de entrega: planejado e realizado</p>
            <div className="max-h-52 overflow-auto scrollbar-thin">
              <table className="w-full text-xs tabular-nums">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-left text-[11px] text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">Categoria</th>
                    <th className="px-2 py-1 text-right font-medium">Prazo planejado</th>
                    <th className="px-2 py-1 text-right font-medium">No prazo</th>
                    <th className="py-1 pl-2 text-right font-medium">Atraso médio</th>
                  </tr>
                </thead>
                <tbody>
                  {rc.lead_time_categoria.map((l) => (
                    <tr key={l.categoria} className="border-t">
                      <td className="py-1.5 pr-2 text-foreground">{l.categoria}</td>
                      <td className="px-2 py-1.5 text-right">{l.lead_planejado_dias} d</td>
                      <td className="px-2 py-1.5 text-right">{pct(l.pct_no_prazo, 1)}</td>
                      <td className="py-1.5 pl-2 text-right">{dec(l.atraso_medio_dias, 1)} d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-[11.5px] leading-relaxed text-foreground">
        <strong>O que este painel ainda não separa:</strong> ruptura de gôndola (produto no fundo da loja, sem reposição na frente) de estoque zero, e acuracidade de inventário. Isso depende de leitura física de estoque e de cadastro real de fornecedores, que um conjunto sintético não tem. {rc.fornecedor_e_marca}
      </p>
    </Panel>
  );
}
