import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { perguntar, type Bloco, type Fontes } from "../lib/ask";
import { ganhoSimulado } from "../lib/insights";
import type { Dados } from "../lib/types";

const dir = join(__dirname, "..", "data");
const j = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));

const d = {
  meta: j("meta.json"),
  kpisMensais: j("kpis_mensais.json"),
  categorias: j("categorias.json"),
  lojas: j("lojas.json"),
  lojaCategoria: j("loja_categoria.json"),
  curvaAbc: j("curva_abc.json"),
  rupturaSemanal: j("ruptura_semanal.json"),
  rupturaDow: j("ruptura_dia_semana.json"),
  rupturaSkus: j("ruptura_skus.json"),
  perdasMes: j("perdas_mensal_categoria.json"),
  perdasMotivos: j("perdas_motivos.json"),
  cesta: j("cesta.json"),
  horario: j("horario_caixas.json"),
  alertas: j("alertas.json"),
} as unknown as Dados;

const f: Fontes = { d, diarias: j("vendas_diarias_loja.json"), semanais: j("vendas_semanais_categoria_loja.json") };

const barras = (b: Bloco | undefined) => (b && b.tipo === "barras" ? b.itens : []);

describe("Modo IA: números vêm dos dados", () => {
  it("receita total bate com o resumo da rede", () => {
    const r = perguntar("Qual a receita total?", f);
    expect(r.cobertura).toBe("ok");
    expect(r.texto).toContain("R$ 70,3 mi");
  });

  it("ranking por loja traz a loja de maior perda e usa a taxa da tabela", () => {
    const r = perguntar("Qual loja tem a maior perda?", f);
    const maior = [...d.lojas].sort((a, b) => b.perda_pct_receita - a.perda_pct_receita)[0];
    expect(r.texto).toContain(maior.nome.replace("Aurora ", ""));
    expect(barras(r.blocos[0])[0].rotulo).toBe(maior.nome.replace("Aurora ", ""));
    expect(barras(r.blocos[0])[0].valor).toBeCloseTo(maior.perda_pct_receita, 1);
  });

  it("recorte loja x categoria usa a tabela exata", () => {
    const r = perguntar("Perda do Jardins em hortifruti", f);
    const x = d.lojaCategoria.find((l) => l.loja_id === 2 && l.categoria === "Hortifruti");
    expect(r.texto).toContain(`${x?.perda_pct_receita.toFixed(2).replace(".", ",")}%`);
  });

  it("evolução mensal devolve 12 pontos", () => {
    const r = perguntar("Como evoluiu a margem real por mês?", f);
    const b = r.blocos[0];
    expect(b.tipo).toBe("linha");
    expect(b.tipo === "linha" ? b.pontos.length : 0).toBe(12);
  });

  it("soma das lojas fecha com a rede em receita", () => {
    const r = perguntar("receita por loja", f);
    const soma = barras(r.blocos[0]).reduce((a, i) => a + i.valor, 0);
    expect(Math.abs(soma - d.meta.resumo.receita) / d.meta.resumo.receita).toBeLessThan(0.001);
  });

  it("ruptura por loja usa a tabela de lojas", () => {
    const r = perguntar("taxa de ruptura por loja", f);
    const centro = barras(r.blocos[0]).find((i) => i.rotulo === "Centro");
    expect(centro?.valor).toBeCloseTo(d.lojas[0].taxa_ruptura_pct, 2);
  });

  it("Black Friday filtra a semana certa", () => {
    const r = perguntar("Quanto vendemos na Black Friday?", f);
    expect(r.texto).toContain("Black Friday");
    expect(r.cobertura).toBe("ok");
  });

  it("comparação de lojas devolve as duas", () => {
    const r = perguntar("Compare Centro e Jardins em margem real", f);
    expect(barras(r.blocos[0])).toHaveLength(2);
  });

  it("continuação herda métrica e recorte", () => {
    const a = perguntar("Compare Centro e Jardins", f);
    const b = perguntar("e em perda?", f, a.consulta);
    expect(barras(b.blocos[0])).toHaveLength(2);
    expect(b.texto).toContain("Perda");
  });

  it("produto por nome cruza com a curva ABC", () => {
    const r = perguntar("margem do pão francês", f);
    expect(r.texto).toContain("Pão Francês");
  });

  it("simulação reproduz o simulador do painel", () => {
    const r = perguntar("simule recuperar 50% da venda perdida e reduzir 30% da perda", f);
    const g = ganhoSimulado(d, 50, 30);
    expect(r.blocos[0].tipo).toBe("stats");
    expect(r.texto).toContain(`${Math.round(g.total / 1000)} mil`);
  });

  it("por que: explica o desvio por categoria", () => {
    const r = perguntar("por que a perda do Jardins é alta?", f);
    expect(r.texto).toContain("Hortifruti");
  });

  it("pergunta fora do dado é recusada com honestidade", () => {
    const r = perguntar("previsão de vendas para dezembro", f);
    expect(r.cobertura).toBe("fora");
  });

  it("recorte que não existe é avisado, não inventado", () => {
    const r = perguntar("perda por vencimento no Jardins", f);
    expect(r.cobertura).toBe("parcial");
    expect(r.texto).toContain("Não existe o recorte");
  });

  it("resposta nunca traz NaN, undefined ou Infinity", () => {
    const qs = ["resumo", "receita por categoria", "margem real por mês", "ticket médio por loja", "dias de ruptura por produto", "giro por categoria", "o que sai junto com café?", "onde falta caixa?", "alertas R3", "perda por motivo", "qual dia da semana tem mais ruptura?", "venda perdida por categoria em março"];
    for (const q of qs) {
      const r = perguntar(q, f);
      const flat = JSON.stringify(r);
      expect(flat).not.toContain("NaN");
      expect(flat).not.toContain("undefined");
      expect(flat).not.toContain("Infinity");
    }
  });
});
