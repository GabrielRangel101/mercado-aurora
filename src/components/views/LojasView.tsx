import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { ChartBox, ChartTip, COR, EIXO, HeatGrid, Kpi, Panel, Segmented, useLazy, type HeatCell, KpiStrip } from "@/components/aurora/kit";
import { DADOS, LOJAS_CURTAS, loadVendasDiarias } from "@/lib/aurora-data";
import { brl, brlCompact, dec, int, pct } from "@/lib/format";

const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];
const FAIXAS = [
  { rotulo: "Dias 1–7", de: 1, ate: 7 },
  { rotulo: "Dias 8–14", de: 8, ate: 14 },
  { rotulo: "Dias 15–22", de: 15, ate: 22 },
  { rotulo: "Dias 23–27", de: 23, ate: 27 },
  { rotulo: "Dias 28–31", de: 28, ate: 31 },
];

export function LojasView() {
  const { lojas, horario } = DADOS;
  const diario = useLazy(loadVendasDiarias);
  const maiorReceita = [...lojas].sort((a, b) => b.receita - a.receita)[0];
  const melhorMargem = [...lojas].sort((a, b) => b.margem_real_pct - a.margem_real_pct)[0];
  const maiorPerda = [...lojas].sort((a, b) => b.perda_pct_receita - a.perda_pct_receita)[0];
  const [lojaSel, setLojaSel] = useState("3");

  const melhor = (f: (l: (typeof lojas)[number]) => number, maior = true) => {
    const vals = lojas.map(f);
    return maior ? Math.max(...vals) : Math.min(...vals);
  };

  const { porDow, porFaixa } = useMemo(() => {
    if (!diario) return { porDow: [], porFaixa: [] };
    const rec = new Map<string, number>(); // data -> receita da rede
    const cup = new Map<string, number>();
    for (const x of diario) {
      rec.set(x.data, (rec.get(x.data) ?? 0) + x.receita);
      cup.set(x.data, (cup.get(x.data) ?? 0) + x.cupons);
    }
    const dow = DIAS.map(() => ({ soma: 0, n: 0 }));
    const faixa = FAIXAS.map(() => ({ rec: 0, cup: 0 }));
    for (const [data, valor] of rec) {
      if (valor <= 0) continue;
      const d = new Date(`${data}T12:00:00`);
      const i = (d.getDay() + 6) % 7; // segunda = 0
      dow[i].soma += valor;
      dow[i].n += 1;
      const dia = d.getDate();
      const f = FAIXAS.findIndex((x) => dia >= x.de && dia <= x.ate);
      faixa[f].rec += valor;
      faixa[f].cup += cup.get(data) ?? 0;
    }
    return {
      porDow: DIAS.map((dia, i) => ({ dia, receita: dow[i].n ? dow[i].soma / dow[i].n : 0 })),
      porFaixa: FAIXAS.map((f, i) => ({ faixa: f.rotulo, ticket: faixa[i].cup ? faixa[i].rec / faixa[i].cup : 0 })),
    };
  }, [diario]);

  const horas = Array.from(new Set(horario.map((h) => h.hora))).sort((a, b) => a - b);
  const linhasCaixa = horas.map((hora) => {
    const cells: HeatCell[] = DIAS.map((dia) => {
      const h = horario.find((x) => x.loja_id === Number(lojaSel) && x.dia === dia && x.hora === hora);
      if (!h) return { texto: "" };
      const t = h.gap >= 2 ? 0 : h.gap === 1 ? 0.2 : 0.85;
      return {
        texto: h.gap >= 1 ? `−${h.gap}` : `${h.caixas_escalados}`,
        t: h.cupons_medios < 8 ? undefined : t,
        dica: `${h.dia} ${hora}h · ${dec(h.cupons_medios, 0)} cupons/h · ${h.caixas_necessarios} caixas necessários, ${h.caixas_escalados} escalados`,
      };
    });
    return { label: `${hora}h`, cells };
  });
  const lojaNome = LOJAS_CURTAS[Number(lojaSel) - 1];
  const faltas = horario.filter((h) => h.loja_id === Number(lojaSel) && h.gap >= 1).length;

  return (
    <div className="space-y-4">
      <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="Maior receita" valor={maiorReceita.nome.replace("Aurora ", "")} sub={brlCompact(maiorReceita.receita)} ask="Receita por loja" />
        <Kpi label="Melhor margem real" valor={melhorMargem.nome.replace("Aurora ", "")} sub={pct(melhorMargem.margem_real_pct)} tom="bom" ask="Margem real por loja" />
        <Kpi label="Maior perda" valor={maiorPerda.nome.replace("Aurora ", "")} sub={`${pct(maiorPerda.perda_pct_receita, 2)} da receita`} tom="ruim" destaque ask={`Por que a perda do ${maiorPerda.nome.replace("Aurora ", "")} é alta?`} />
        <Kpi label="Faixas sem caixa suficiente" valor={String(horario.filter((h) => h.gap >= 1).length)} sub="loja × dia × hora com falta" tom="ruim" ask="Onde falta caixa?" />
      </KpiStrip>

      <Panel ask="Compare Centro e Jardins" title="Comparativo entre lojas" summary="12 meses" info="Verde: melhor da rede no indicador. Vermelho: pior.">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Loja</th>
                <th className="px-2 py-1 text-right font-medium">Receita</th>
                <th className="px-2 py-1 text-right font-medium">Ticket</th>
                <th className="px-2 py-1 text-right font-medium">Mg bruta</th>
                <th className="px-2 py-1 text-right font-medium">Perda</th>
                <th className="px-2 py-1 text-right font-medium">Mg real</th>
                <th className="px-2 py-1 text-right font-medium">Ruptura</th>
                <th className="py-1 pl-2 text-right font-medium">Venda perdida</th>
              </tr>
            </thead>
            <tbody>
              {lojas.map((l) => (
                <tr key={l.loja_id} className="border-t">
                  <td className="py-2 pr-2 font-medium text-foreground">{l.nome}</td>
                  <td className="px-2 py-2 text-right">{brlCompact(l.receita)}</td>
                  <td className="px-2 py-2 text-right">{brl(l.ticket_medio)}</td>
                  <td className="px-2 py-2 text-right">{pct(l.margem_bruta_pct)}</td>
                  <Celula v={l.perda_pct_receita} bom={melhor((x) => x.perda_pct_receita, false)} ruim={melhor((x) => x.perda_pct_receita)} f={(v) => pct(v, 2)} />
                  <Celula v={l.margem_real_pct} bom={melhor((x) => x.margem_real_pct)} ruim={melhor((x) => x.margem_real_pct, false)} f={(v) => pct(v)} />
                  <Celula v={l.taxa_ruptura_pct} bom={melhor((x) => x.taxa_ruptura_pct, false)} ruim={melhor((x) => x.taxa_ruptura_pct)} f={(v) => pct(v, 2)} />
                  <Celula v={l.venda_perdida_pct_receita} bom={melhor((x) => x.venda_perdida_pct_receita, false)} ruim={melhor((x) => x.venda_perdida_pct_receita)} f={(v) => `${pct(v, 2)} · ${brlCompact(l.venda_perdida)}`} ultima />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel ask="Qual dia da semana vende mais?" title="Receita média por dia da semana" summary="rede, R$ mil por dia">
          <ChartBox height={300}>
            {porDow.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={porDow} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke={COR.grade} vertical={false} />
                  <XAxis dataKey="dia" tick={EIXO} tickLine={false} axisLine={false} />
                  <YAxis tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${Math.round(v / 1000)}`} />
                  <RTooltip content={<ChartTip formato={(v) => brlCompact(v)} />} />
                  <Bar dataKey="receita" name="Receita média" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {porDow.map((d) => (
                      <Cell key={d.dia} fill={d.dia === "Sab" || d.dia === "Dom" ? COR.laranja : COR.verde} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Carregando />
            )}
          </ChartBox>
        </Panel>

        <Panel ask="Ticket médio por loja" title="Ticket médio ao longo do mês" summary="R$ por cupom, rede" info="O ticket sobe no início e no fim do mês (pagamento e compra grande) e cai no meio.">
          <ChartBox height={300}>
            {porFaixa.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={porFaixa} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke={COR.grade} vertical={false} />
                  <XAxis dataKey="faixa" tick={EIXO} tickLine={false} axisLine={false} />
                  <YAxis tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${int(v)}`} />
                  <RTooltip content={<ChartTip formato={(v) => brl(v)} />} />
                  <Bar dataKey="ticket" name="Ticket médio" fill={COR.azul} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Carregando />
            )}
          </ChartBox>
        </Panel>
      </div>

      <Panel
        ask="Onde falta caixa?"
        title="Caixas por hora"
        summary={faltas ? `${lojaNome}: ${faltas} faixas com falta` : `${lojaNome}: sem falta`}
        actions={<Segmented label="Loja" value={lojaSel} onChange={setLojaSel} options={lojas.map((l, i) => ({ value: String(l.loja_id), label: LOJAS_CURTAS[i] }))} />}
        info="Cupons por hora × capacidade de um caixa (18 cupons/h a 85% de uso). Número em cada célula: caixas escalados. −1 ou −2: faltam caixas naquela hora. A escala atual é fixa por dia da semana, então não acompanha o pico de fim de semana entre 10h e 13h."
      >
        <HeatGrid corner="Hora" cols={DIAS} rows={linhasCaixa} colWidth="3.5rem" />
      </Panel>
    </div>
  );
}

function Celula({ v, bom, ruim, f, ultima }: { v: number; bom: number; ruim: number; f: (v: number) => string; ultima?: boolean }) {
  const cor = v === bom ? "text-positive" : v === ruim ? "text-danger" : "text-foreground";
  return <td className={`${ultima ? "pl-2" : "px-2"} py-2 text-right font-medium ${cor}`}>{f(v)}</td>;
}

function Carregando() {
  return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Carregando série diária…</div>;
}
