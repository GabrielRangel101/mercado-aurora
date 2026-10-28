// Fonte única de dados da interface: JSONs estáticos gerados por scripts/gerar_dados.py.
// Os dois arquivos grandes (série diária e semanal por categoria) carregam sob demanda.
import alertas from "@/data/alertas.json";
import caixasPremissas from "@/data/caixas_premissas.json";
import categorias from "@/data/categorias.json";
import cesta from "@/data/cesta.json";
import curvaAbc from "@/data/curva_abc.json";
import horario from "@/data/horario_caixas.json";
import kpisMensais from "@/data/kpis_mensais.json";
import lojaCategoria from "@/data/loja_categoria.json";
import lojas from "@/data/lojas.json";
import marcas from "@/data/marcas.json";
import meta from "@/data/meta.json";
import perdasMes from "@/data/perdas_mensal_categoria.json";
import perdasMotivos from "@/data/perdas_motivos.json";
import rupturaDow from "@/data/ruptura_dia_semana.json";
import rupturaCausas from "@/data/ruptura_causas.json";
import rupturaSemanal from "@/data/ruptura_semanal.json";
import rupturaSkus from "@/data/ruptura_skus.json";
import { gerarInsights, type ViewId } from "./insights";
import type { Dados, VendaDia, VendaSemana } from "./types";

export type { ViewId } from "./insights";

export const DADOS = {
  meta,
  kpisMensais,
  categorias,
  lojas,
  lojaCategoria,
  curvaAbc,
  rupturaSemanal,
  rupturaDow,
  rupturaSkus,
  perdasMes,
  perdasMotivos,
  cesta,
  horario,
  alertas,
  rupturaCausas,
  marcas,
  caixasPremissas,
} as unknown as Dados;

export const INSIGHTS = gerarInsights(DADOS);

export const loadVendasSemanais = (): Promise<VendaSemana[]> =>
  import("@/data/vendas_semanais_categoria_loja.json").then((m) => m.default as unknown as VendaSemana[]);

export const loadVendasDiarias = (): Promise<VendaDia[]> =>
  import("@/data/vendas_diarias_loja.json").then((m) => m.default as unknown as VendaDia[]);

export const VIEW_IDS: ViewId[] = ["geral", "margem", "ruptura", "perdas", "lojas", "cesta", "alertas"];

export function parseView(v: unknown): ViewId | undefined {
  return typeof v === "string" && (VIEW_IDS as string[]).includes(v) ? (v as ViewId) : undefined;
}

/** Nome curto das lojas, indexado por id-1: ["Centro", "Jardins", ...]. */
export const LOJAS_CURTAS: string[] = DADOS.lojas.map((l) => l.nome.replace(/^Aurora\s+/, ""));

/** Eventos sazonais (semana de início, segunda-feira) para marcar nos gráficos semanais. */
export const EVENTOS_SEMANAIS: { semana: string; rotulo: string }[] = [
  { semana: "2025-11-24", rotulo: "Black Friday" },
  { semana: "2025-12-22", rotulo: "Natal" },
  { semana: "2026-03-30", rotulo: "Páscoa" },
];
