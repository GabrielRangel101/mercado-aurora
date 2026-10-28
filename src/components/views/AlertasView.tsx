import { Fragment, useMemo, useState } from "react";
import { HeatGrid, Kpi, Panel, Segmented, Tag, type HeatCell, KpiStrip } from "@/components/aurora/kit";
import { DADOS, LOJAS_CURTAS } from "@/lib/aurora-data";
import { brlCompact, dec, int } from "@/lib/format";
import type { EventoAlerta } from "@/lib/types";

const SEV = { alta: "risco", media: "atencao", baixa: "neutro" } as const;
const ROT_SEV = { alta: "alta", media: "média", baixa: "baixa" } as const;

/** Troca *texto* por negrito, como no WhatsApp. */
function Whats({ texto }: { texto: string }) {
  return (
    <>
      {texto.split("\n").map((linha, i) => (
        <Fragment key={i}>
          {linha.split(/(\*[^*]+\*)/g).map((trecho, j) => (trecho.startsWith("*") && trecho.endsWith("*") && trecho.length > 2 ? <strong key={j}>{trecho.slice(1, -1)}</strong> : <Fragment key={j}>{trecho}</Fragment>))}
          <br />
        </Fragment>
      ))}
    </>
  );
}

function detalhe(e: EventoAlerta): string {
  if (e.regra === "R0") return `0 un · vende ~${int(e.venda_diaria_media)} por dia`;
  if (e.regra === "R3") return `${int(e.sobra_un ?? e.estoque)} un não vendem até vencer em ${e.dias_para_vencer} d · remarcar −${e.desconto_pct}% recupera ${brlCompact(e.recuperado_rs ?? 0)}${e.abaixo_do_custo ? " (abaixo do custo, mas melhor que descartar)" : ""}`;
  if (e.regra === "R4") return `${int(e.estoque)} un · ${dec(e.cobertura_dias, 0)} dias de estoque`;
  return `${int(e.estoque)} un · ${dec(e.cobertura_dias, 1)} d de cobertura · precisa durar ${e.dias_para_cobrir} d`;
}

export function AlertasView() {
  const { alertas, lojas } = DADOS;
  const [regra, setRegra] = useState("todas");
  const [lojaMsg, setLojaMsg] = useState(lojas[0].nome);

  const totalPor = (id: string) => alertas.contagem_por_loja_regra.filter((c) => c.regra === id).reduce((a, c) => a + c.n, 0);
  const eventos = useMemo(() => alertas.eventos_destaque.filter((e) => regra === "todas" || e.regra === regra), [alertas, regra]);

  const linhas = alertas.regras.map((r) => {
    const cells: HeatCell[] = lojas.map((l) => ({ texto: String(alertas.contagem_por_loja_regra.find((c) => c.loja_id === l.loja_id && c.regra === r.id)?.n ?? 0) }));
    return { label: `${r.id} · ${r.nome}`, cells };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed text-foreground">
        <span className="shrink-0 text-base leading-none text-warning" aria-hidden>⚠</span>
        <p>
          <strong>Automação em desenvolvimento.</strong> {alertas.status} As regras abaixo são a especificação; a fila e as mensagens mostram o que elas gerariam sobre o estoque de fechamento de 30/09/2026.
        </p>
      </div>

      <div className="rounded-lg border bg-card/70 p-3 text-xs leading-relaxed text-foreground">
        <p>
          <strong>Um alerta por item e loja.</strong> {alertas.deduplicacao.regra} {int(alertas.deduplicacao.sku_loja_com_mais_de_uma_regra)} itens acionavam mais de uma regra e ficaram só com a de maior precedência.
        </p>
        <p className="mt-1.5 text-muted-foreground">
          Severidade pelo dinheiro em risco: alta a partir de {brlCompact(alertas.severidade_faixas.alta)}, média a partir de {brlCompact(alertas.severidade_faixas.media)}. A mensagem diária leva no máximo {alertas.max_itens_mensagem} itens, do maior R$ para o menor; o resto fica no link.
        </p>
      </div>

      <KpiStrip className="md:grid-cols-5 xl:grid-cols-5">
        {alertas.regras.map((r) => (
          <Kpi key={r.id} label={`${r.id} · ${r.nome}`} valor={int(totalPor(r.id))} sub={totalPor(r.id) === 0 ? `nenhum item passa do piso hoje · ${r.horario}` : `${r.horario} · para ${r.destino}`} tom={r.id === "R0" || r.id === "R1" ? "ruim" : "neutro"} info={`${r.condicao}. Ação: ${r.acao}.`} />
        ))}
      </KpiStrip>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel ask="Alertas R1" title="Fila de alertas" className="xl:col-span-3" summary={`${eventos.length} em destaque de ${int(alertas.total_eventos)} · risco do dia ${brlCompact(alertas.risco_total_rs)} (não é valor anual)`} actions={<Segmented label="Regra" value={regra} onChange={setRegra} options={[{ value: "todas", label: "Todas" }, ...alertas.regras.map((r) => ({ value: r.id, label: r.id }))]} />}>
          {regra === "R4" && eventos.length === 0 && (
            <div className="mb-3 rounded-lg border bg-background/40 p-3 text-xs leading-relaxed text-foreground">
              <p>
                <strong>Nenhum item passa do piso de {brlCompact(alertas.r4_piso_rs)} hoje.</strong> A regra continua ativa. Os mais próximos, abaixo do piso:
              </p>
              <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
                {alertas.r4_mais_proximos.map((x) => (
                  <li key={`${x.loja_id}-${x.produto}`}>
                    {x.produto} · {LOJAS_CURTAS[x.loja_id - 1]}: {dec(x.cobertura_dias, 0)} dias de estoque, {brlCompact(x.parado_rs)} parados
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="max-h-[34rem] overflow-auto scrollbar-thin">
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 bg-card">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Alerta</th>
                  <th className="px-2 py-1 font-medium">Loja</th>
                  <th className="px-2 py-1 font-medium">Situação</th>
                  <th className="px-2 py-1 text-right font-medium">R$ em risco</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((e, i) => (
                  <tr key={`${e.loja_id}-${e.sku_id}-${e.regra}-${i}`} className="border-t align-top">
                    <td className="py-1.5 pr-2">
                      <p className="font-medium text-foreground">{e.produto}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Tag tom={SEV[e.severidade]}>{e.regra} · {ROT_SEV[e.severidade]}</Tag>
                        {e.acao}
                      </p>
                    </td>
                    <td className="px-2 py-1.5 text-foreground">{LOJAS_CURTAS[e.loja_id - 1]}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{detalhe(e)}</td>
                    <td className="px-2 py-1.5 text-right text-foreground">{brlCompact(e.impacto_rs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-4 xl:col-span-2">
          <Panel title="Mensagem ao gerente" summary="exemplo de envio por WhatsApp" info="Texto montado a partir dos mesmos dados da fila. No fluxo real, um agendamento diário consulta o estoque, aplica as regras e envia por WhatsApp ou e-mail." actions={<Segmented label="Loja" value={lojaMsg} onChange={setLojaMsg} options={lojas.map((l, i) => ({ value: l.nome, label: LOJAS_CURTAS[i] }))} />}>
            <div className="rounded-xl bg-[hsl(95_25%_88%)] p-3">
              <div className="max-w-full rounded-lg rounded-tl-none bg-white p-3 text-[12px] leading-relaxed text-neutral-900 shadow-sm">
                <Whats texto={alertas.mensagens_exemplo[lojaMsg] ?? ""} />
              </div>
            </div>
          </Panel>

          <Panel ask="Quantos alertas por loja?" title="Alertas por loja e regra" summary="todos os eventos do dia">
            <HeatGrid corner="Regra" cols={LOJAS_CURTAS} rows={linhas} colWidth="3.5rem" />
          </Panel>
        </div>
      </div>
    </div>
  );
}
