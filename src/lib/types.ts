// Formato dos JSONs gerados por scripts/gerar_dados.py (src/data/*.json).

export interface Resumo {
  receita: number;
  margem_bruta_pct: number;
  perda_custo: number;
  perda_pct_receita: number;
  margem_real_pct: number;
  taxa_ruptura_pct: number;
  taxa_ruptura_A_pct: number;
  venda_perdida: number;
  venda_perdida_pct_receita: number;
  cupons: number;
  ticket_medio: number;
  n_skus: number;
  n_skus_classe_A: number;
  pct_skus_classe_A: number;
}

export interface Meta {
  marca: string;
  aviso: string;
  periodo: { inicio: string; fim: string; dias: number; semanas_completas: number };
  lojas: { id: number; nome: string }[];
  categorias: string[];
  resumo: Resumo;
  definicoes: Record<string, string>;
  cestas_missoes_pct: Record<string, number>;
}

export interface KpiMes {
  mes: string;
  receita: number;
  margem_bruta_pct: number;
  perda_pct_receita: number;
  margem_real_pct: number;
  taxa_ruptura_pct: number;
  venda_perdida: number;
  cupons: number;
  ticket_medio: number;
}

export interface Categoria {
  categoria: string;
  perecivel: boolean;
  receita: number;
  share_receita_pct: number;
  margem_bruta_pct: number;
  perda_pct_receita: number;
  margem_real_pct: number;
  margem_real_valor: number;
  taxa_ruptura_pct: number;
  venda_perdida: number;
  giro_estoque_ano: number;
  cobertura_media_dias: number;
}

export interface Loja {
  loja_id: number;
  nome: string;
  receita: number;
  margem_bruta_pct: number;
  perda_pct_receita: number;
  margem_real_pct: number;
  taxa_ruptura_pct: number;
  venda_perdida: number;
  venda_perdida_pct_receita: number;
  cupons: number;
  ticket_medio: number;
}

export interface LojaCategoria {
  loja_id: number;
  categoria: string;
  receita: number;
  margem_bruta_pct: number;
  perda_pct_receita: number;
  perda_pct_unidades: number;
  margem_real_pct: number;
  taxa_ruptura_pct: number;
  venda_perdida: number;
}

export interface SkuAbc {
  rank: number;
  sku_id: number;
  codigo: string;
  nome: string;
  categoria: string;
  marca: string | null;
  classe: "A" | "B" | "C";
  classe_margem: "A" | "B" | "C";
  receita: number;
  qtd: number;
  pct_receita: number;
  pct_acum: number;
  margem_pct: number;
  margem_real_pct: number;
  perda_pct_receita: number;
  venda_perdida: number;
  dias_ruptura: number;
}

export interface VendaDia {
  data: string;
  loja_id: number;
  receita: number;
  margem_valor: number;
  perda_custo: number;
  venda_perdida: number;
  cupons: number;
  ticket_medio: number;
}

export interface VendaSemana {
  semana: string;
  loja_id: number;
  categoria: string;
  receita: number;
  margem_valor: number;
  perda_custo: number;
  venda_perdida: number;
  qtd: number;
}

export interface RupturaSemana {
  semana: string;
  loja_id: number;
  taxa_ruptura_pct: number;
  taxa_ruptura_A_pct: number;
  venda_perdida: number;
}

export interface RupturaDow {
  loja_id: number;
  dow: number;
  dia: string;
  taxa_ruptura_pct: number;
  venda_perdida: number;
}

export interface RupturaSku {
  sku_id: number;
  nome: string;
  categoria: string;
  classe: "A" | "B" | "C";
  receita: number;
  venda_perdida: number;
  dias_ruptura: number;
  pct_do_total: number;
  pct_acum: number;
  perda_sobre_receita_pct: number;
  venda_perdida_loja1: number;
  venda_perdida_loja2: number;
  venda_perdida_loja3: number;
  venda_perdida_loja4: number;
}

export interface PerdaMes {
  mes: string;
  categoria: string;
  unidades: number;
  valor_custo: number;
  receita: number;
  perda_pct_receita: number;
}

export interface PerdaMotivo {
  mes: string;
  categoria: string;
  motivo: string;
  unidades: number;
  valor_custo: number;
}

export interface ParCesta {
  item_a: string;
  item_b: string;
  suporte_pct: number;
  confianca_a_b_pct: number;
  confianca_b_a_pct: number;
  lift: number;
  cestas: number;
}

export interface Cesta {
  n_cestas: number;
  itens_por_cesta_media: number;
  pares_maior_lift: ParCesta[];
  pares_maior_suporte: ParCesta[];
  itens_mais_presentes: { item: string; penetracao_pct: number }[];
  nota: string;
}

export interface HoraCaixa {
  loja_id: number;
  dow: number;
  dia: string;
  hora: number;
  cupons_medios: number;
  caixas_necessarios: number;
  caixas_escalados: number;
  gap: number;
}

export interface RegraAlerta {
  id: string;
  nome: string;
  severidade: string;
  condicao: string;
  acao: string;
  destino: string;
  horario: string;
}

export interface EventoAlerta {
  loja_id: number;
  sku_id: number;
  produto: string;
  categoria: string;
  classe: string;
  estoque: number;
  cobertura_dias: number;
  venda_diaria_media: number;
  regra: string;
  regra_nome: string;
  severidade: "alta" | "media" | "baixa";
  impacto_rs: number;
  acao: string;
  dias_para_vencer?: number | null;
}

export interface Alertas {
  status: string;
  regras: RegraAlerta[];
  contagem_por_loja_regra: { loja_id: number; regra: string; n: number }[];
  total_eventos: number;
  eventos_destaque: EventoAlerta[];
  mensagens_exemplo: Record<string, string>;
}

export interface Dados {
  meta: Meta;
  kpisMensais: KpiMes[];
  categorias: Categoria[];
  lojas: Loja[];
  lojaCategoria: LojaCategoria[];
  curvaAbc: SkuAbc[];
  rupturaSemanal: RupturaSemana[];
  rupturaDow: RupturaDow[];
  rupturaSkus: RupturaSku[];
  perdasMes: PerdaMes[];
  perdasMotivos: PerdaMotivo[];
  cesta: Cesta;
  horario: HoraCaixa[];
  alertas: Alertas;
}
