import { Fragment, useMemo, useState } from "react";
import { HeatGrid, Kpi, Nota, Panel, Segmented, Tag, type HeatCell } from "@/components/aurora/kit";
import { DADOS, LOJAS_CURTAS } from "@/lib/aurora-data";
import { brlCompact, dec, int } from "@/lib/format";
import type { EventoAlerta } from "@/lib/types";

const SEV = { alta: "risco", media: "atencao", baixa: "neutro" } as const;

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
  if (e.regra === "R3") return `${int(e.estoque)} un · vence em ${e.dias_para_vencer} d`;
  if (e.regra === "R4") return `${int(e.estoque)} un · ${dec(e.cobertura_dias, 0)} dias de estoque`;
  return `${int(e.estoque)} un · ${dec(e.cobertura_dias, 1)} d de cobertura`;
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

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Regras de alerta">
        {alertas.regras.map((r) => (
          <Kpi key={r.id} label={`${r.id} · ${r.nome}`} valor={int(totalPor(r.id))} sub={`${r.horario} · para ${r.destino}`} tom={r.id === "R1" ? "ruim" : "neutro"} info={`${r.condicao}. Ação: ${r.acao}.`} />
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title="Fila de alertas" className="lg:col-span-3" summary={`${eventos.length} em destaque de ${int(alertas.total_eventos)}`} actions={<Segmented label="Regra" value={regra} onChange={setRegra} options={[{ value: "todas", label: "Todas" }, ...alertas.regras.map((r) => ({ value: r.id, label: r.id }))]} />}>
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
                        <Tag tom={SEV[e.severidade]}>{e.regra}</Tag>
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

        <div className="space-y-4 lg:col-span-2">
          <Panel title="Mensagem ao gerente" summary="exemplo de envio por WhatsApp" actions={<Segmented label="Loja" value={lojaMsg} onChange={setLojaMsg} options={lojas.map((l, i) => ({ value: l.nome, label: LOJAS_CURTAS[i] }))} />}>
            <div className="rounded-xl bg-[hsl(95_25%_88%)] p-3">
              <div className="max-w-full rounded-lg rounded-tl-none bg-white p-3 text-[12px] leading-relaxed text-neutral-900 shadow-sm">
                <Whats texto={alertas.mensagens_exemplo[lojaMsg] ?? ""} />
              </div>
            </div>
            <Nota>Texto montado a partir dos mesmos dados da fila. No fluxo real, um agendamento diário consulta o estoque, aplica as regras e envia por WhatsApp ou e-mail.</Nota>
          </Panel>

          <Panel title="Alertas por loja e regra" summary="todos os eventos do dia">
            <HeatGrid corner="Regra" cols={LOJAS_CURTAS} rows={linhas} colWidth="3.5rem" />
          </Panel>
        </div>
      </div>
    </div>
  );
}
