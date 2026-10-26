import { useState } from "react";
import { BarList, COR, Kpi, Nota, Panel, Segmented } from "@/components/aurora/kit";
import { DADOS } from "@/lib/aurora-data";
import { dec, int, pct } from "@/lib/format";

export function CestaView() {
  const { cesta, meta } = DADOS;
  const [ordem, setOrdem] = useState<"lift" | "suporte">("lift");
  const pares = ordem === "lift" ? cesta.pares_maior_lift : cesta.pares_maior_suporte;
  const maxLift = Math.max(...cesta.pares_maior_lift.map((p) => p.lift));

  // melhor oportunidade de cross-sell: maior confiança em qualquer direção, com suporte relevante
  const candidatas = cesta.pares_maior_lift
    .filter((p) => p.suporte_pct >= 1)
    .flatMap((p) => [
      { de: p.item_a, para: p.item_b, conf: p.confianca_a_b_pct, par: p },
      { de: p.item_b, para: p.item_a, conf: p.confianca_b_a_pct, par: p },
    ])
    .sort((a, b) => b.conf - a.conf);
  const melhor = candidatas[0];

  const missoes = Object.entries(meta.cestas_missoes_pct).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Cestas analisadas" valor={int(cesta.n_cestas)} sub="cupons sintéticos por missão de compra" />
        <Kpi label="Itens por cesta" valor={dec(cesta.itens_por_cesta_media, 1)} sub="média de produtos distintos" />
        <Kpi label="Item mais presente" valor={pct(cesta.itens_mais_presentes[0].penetracao_pct, 0)} sub={cesta.itens_mais_presentes[0].item} info="Penetração: % das cestas que levam o item." />
        <Kpi
          label="Melhor cross-sell"
          valor={melhor ? pct(melhor.conf, 0) : "—"}
          sub={melhor ? `quem leva ${melhor.de} também leva ${melhor.para}` : ""}
          destaque
          info="Confiança: entre as cestas com o primeiro item, % que também têm o segundo."
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel
          title="Pares que saem juntos"
          className="lg:col-span-3"
          actions={
            <Segmented
              label="Ordenar por"
              value={ordem}
              onChange={setOrdem}
              options={[
                { value: "lift", label: "Maior lift" },
                { value: "suporte", label: "Maior suporte" },
              ]}
            />
          }
          info="Suporte: % das cestas com os dois itens. Confiança: dado o item A, chance de levar B. Lift: quantas vezes o par aparece mais do que o acaso (1 = sem relação)."
        >
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Par</th>
                  <th className="px-2 py-1 text-right font-medium">Suporte</th>
                  <th className="px-2 py-1 text-right font-medium">A → B</th>
                  <th className="px-2 py-1 text-right font-medium">B → A</th>
                  <th className="py-1 pl-2 font-medium">Lift</th>
                </tr>
              </thead>
              <tbody>
                {pares.slice(0, 15).map((p) => (
                  <tr key={`${p.item_a}|${p.item_b}`} className="border-t">
                    <td className="max-w-[18rem] py-1.5 pr-2 text-foreground">
                      <span className="block truncate" title={`${p.item_a} + ${p.item_b}`}>
                        {p.item_a} <span className="text-muted-foreground">+</span> {p.item_b}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">{pct(p.suporte_pct, 1)}</td>
                    <td className="px-2 py-1.5 text-right">{pct(p.confianca_a_b_pct, 0)}</td>
                    <td className="px-2 py-1.5 text-right">{pct(p.confianca_b_a_pct, 0)}</td>
                    <td className="py-1.5 pl-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted/70">
                          <div className="h-full rounded-full" style={{ width: `${(100 * p.lift) / maxLift}%`, background: COR.laranja }} />
                        </div>
                        <span className="w-8 text-right text-foreground">{dec(p.lift, 1)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Nota>Lift acima de 1 significa que os itens saem juntos mais do que o acaso. Os valores aqui são altos por construção: as cestas são geradas por missões de compra (churrasco, café da manhã, macarronada...). Em dado real, lift entre 1,5 e 4 já é um sinal forte.</Nota>
        </Panel>

        <div className="space-y-4 lg:col-span-2">
          <Panel title="Itens mais presentes" summary="% das cestas">
            <BarList items={cesta.itens_mais_presentes.slice(0, 10).map((i) => ({ label: i.item, value: i.penetracao_pct, texto: pct(i.penetracao_pct, 1), cor: COR.verde }))} />
          </Panel>
          <Panel title="Missões de compra" summary="% das cestas (uma cesta pode ter mais de uma)">
            <BarList items={missoes.map(([nome, v]) => ({ label: nome, value: v, texto: pct(v, 1), cor: COR.azul }))} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
