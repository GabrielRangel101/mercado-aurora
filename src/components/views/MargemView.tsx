import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip as RTooltip, XAxis, YAxis, ZAxis, Area } from "recharts";
import { Panel, ChartBox, COR, EIXO, HeatGrid, Kpi, Nota, Tag, type HeatCell, KpiStrip } from "@/components/aurora/kit";
import { DADOS, LOJAS_CURTAS } from "@/lib/aurora-data";
import { brlCompact, dec, pct, pp } from "@/lib/format";
import { LIMITE_TRAFEGO, media, resumoAbc, trafego } from "@/lib/insights";

export function MargemView() {
  const { curvaAbc, lojaCategoria, categorias, meta } = DADOS;
  const classes = resumoAbc(curvaAbc);
  const t = trafego(curvaAbc);
  const r = meta.resumo;

  const pareto = curvaAbc.map((s) => ({ rank: s.rank, acum: s.pct_acum }));
  const nA = classes[0].skus;
  const pontos = (c: "A" | "B" | "C") =>
    curvaAbc.filter((s) => s.classe === c).map((s) => ({ x: s.pct_receita, y: s.margem_real_pct, nome: s.nome, receita: s.receita, categoria: s.categoria }));

  const menores = curvaAbc.filter((s) => s.classe === "A").sort((a, b) => a.margem_real_pct - b.margem_real_pct).slice(0, 10);
  const maiores = curvaAbc.slice(0, 12);

  // mapa de calor: margem real por categoria x loja, colorido pelo desvio contra a média da linha
  const linhas = [...categorias]
    .sort((a, b) => b.receita - a.receita)
    .map((c) => {
      const vals = DADOS.lojas.map((l) => lojaCategoria.find((x) => x.loja_id === l.loja_id && x.categoria === c.categoria)?.margem_real_pct ?? 0);
      const m = media(vals);
      const cells: HeatCell[] = vals.map((v) => ({ texto: pct(v), t: 0.5 + Math.max(-1, Math.min(1, (v - m) / 3)) / 2, dica: `${c.categoria} · ${pp(v - m)} vs média da categoria` }));
      return { label: c.categoria, cells };
    });

  return (
    <div className="space-y-4">
      <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="SKUs classe A" valor={String(nA)} sub={`${pct(r.pct_skus_classe_A, 0)} do catálogo geram ${pct(classes[0].receitaPct, 0)} da receita`} info="Curva ABC por receita anual: A até 80% acumulado, B até 95%, C o restante." />
        <Kpi label="Margem real classe A" valor={pct(classes[0].margemRealPct)} sub={`Classe C: ${pct(classes[2].margemRealPct)}`} tom="bom" />
        <Kpi label="Itens de tráfego" valor={String(t.skus)} sub={`Classe A com margem real abaixo de ${LIMITE_TRAFEGO}%`} info="Itens de alto giro e margem apertada: atraem cliente, mas deixam pouco para a loja." />
        <Kpi label="Peso do tráfego" valor={`${pct(t.receitaPct, 0)} → ${pct(t.margemRealPct, 0)}`} tom="ruim" sub="da receita → da margem real" destaque />
      </KpiStrip>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel ask="Quantos SKUs são classe A?" title="Curva ABC (receita acumulada)" summary={`${nA} SKUs = 80%`}>
          <ChartBox height={340}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={pareto} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                <CartesianGrid stroke={COR.grade} vertical={false} />
                <XAxis dataKey="rank" type="number" domain={[1, curvaAbc.length]} tick={EIXO} tickLine={false} axisLine={false} label={{ value: "SKUs ordenados por receita", position: "insideBottom", offset: -2, fontSize: 11, fill: "var(--muted-foreground)" }} />
                <YAxis domain={[0, 100]} tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                <ReferenceLine y={80} stroke={COR.laranja} strokeDasharray="4 3" label={{ value: "80%", position: "right", fontSize: 10, fill: COR.laranja }} />
                <ReferenceLine x={nA} stroke={COR.laranja} strokeDasharray="4 3" />
                <ReferenceLine y={95} stroke={COR.cinza} strokeDasharray="4 3" />
                <RTooltip formatter={(v: number) => [pct(v), "Receita acumulada"]} labelFormatter={(l) => `SKU nº ${l}`} />
                <Area type="monotone" dataKey="acum" stroke={COR.verde} fill={COR.verde} fillOpacity={0.14} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartBox>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            {classes.map((c) => (
              <div key={c.classe} className="rounded-md bg-muted/50 px-2 py-1.5">
                <p className="font-semibold text-foreground">
                  Classe {c.classe} · {c.skus} SKUs
                </p>
                <p className="text-muted-foreground">
                  {pct(c.receitaPct, 0)} da receita · margem real {pct(c.margemRealPct)}
                </p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel ask="Quais SKUs classe A têm a menor margem real?" title="Receita × margem real por SKU" summary="cada ponto é um SKU" info="Eixo X: participação do SKU na receita. Eixo Y: margem real (já descontada a perda). A faixa inferior marca os itens de tráfego.">
          <ChartBox height={340}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                <CartesianGrid stroke={COR.grade} />
                <XAxis type="number" dataKey="x" name="Receita" tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${dec(v, 1)}%`} label={{ value: "% da receita", position: "insideBottom", offset: -2, fontSize: 11, fill: "var(--muted-foreground)" }} />
                <YAxis type="number" dataKey="y" name="Margem real" tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                <ZAxis range={[30, 30]} />
                <ReferenceArea y1={0} y2={LIMITE_TRAFEGO} fill={COR.perigo} fillOpacity={0.07} />
                <ReferenceLine y={r.margem_real_pct} stroke={COR.cinza} strokeDasharray="4 3" label={{ value: "média da rede", position: "insideTopRight", fontSize: 10, fill: COR.texto }} />
                <RTooltip cursor={{ strokeDasharray: "3 3" }} content={<TipSku />} />
                <Scatter name="Classe C" data={pontos("C")} fill={COR.cinza} fillOpacity={0.55} isAnimationActive={false} />
                <Scatter name="Classe B" data={pontos("B")} fill={COR.dourado} fillOpacity={0.75} isAnimationActive={false} />
                <Scatter name="Classe A" data={pontos("A")} fill={COR.verde} fillOpacity={0.85} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          </ChartBox>
          <Nota>Verde: classe A · dourado: B · cinza: C. Faixa vermelha: margem real abaixo de {LIMITE_TRAFEGO}%.</Nota>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel ask="Quais SKUs classe A têm a menor margem real?" title="Menores margens reais entre os classe A" summary="onde a venda mais pesa e menos paga">
          <TabelaSku linhas={menores} />
        </Panel>
        <Panel ask="Quais os 10 maiores SKUs por receita?" title="SKUs de maior receita" summary="top 12">
          <TabelaSku linhas={maiores} />
        </Panel>
      </div>

      <Panel ask="Qual categoria tem maior margem real no Centro?" title="Margem real por categoria e loja" summary="cor: desvio contra a média da categoria" info="Verde: a loja rende acima da média da categoria. Vermelho: abaixo. Diferenças de 2 a 3 p.p. já são relevantes.">
        <HeatGrid corner="Categoria" cols={LOJAS_CURTAS} rows={linhas} />
      </Panel>
    </div>
  );
}

function TipSku({ active, payload }: { active?: boolean; payload?: { payload?: { nome: string; categoria: string; x: number; y: number; receita: number } }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium text-foreground">{p.nome}</p>
      <p className="text-muted-foreground">{p.categoria}</p>
      <p className="mt-1 tabular-nums text-foreground">
        Receita {brlCompact(p.receita)} ({pct(p.x, 2)}) · margem real {pct(p.y)}
      </p>
    </div>
  );
}

function TabelaSku({ linhas }: { linhas: typeof DADOS.curvaAbc }) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="py-1 pr-2 font-medium">SKU</th>
            <th className="px-2 py-1 text-right font-medium">Receita</th>
            <th className="px-2 py-1 text-right font-medium">Mg bruta</th>
            <th className="px-2 py-1 text-right font-medium">Mg real</th>
            <th className="py-1 pl-2 text-right font-medium">Classe</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((s) => (
            <tr key={s.sku_id} className="border-t">
              <td className="max-w-[16rem] truncate py-1.5 pr-2 text-foreground" title={s.nome}>
                {s.nome}
              </td>
              <td className="px-2 py-1.5 text-right">{brlCompact(s.receita)}</td>
              <td className="px-2 py-1.5 text-right">{pct(s.margem_pct)}</td>
              <td className={`px-2 py-1.5 text-right font-medium ${s.margem_real_pct < LIMITE_TRAFEGO ? "text-danger" : "text-foreground"}`}>{pct(s.margem_real_pct)}</td>
              <td className="py-1.5 pl-2 text-right">
                <Tag tom={s.classe === "A" ? "ok" : "neutro"}>{s.classe}</Tag>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
