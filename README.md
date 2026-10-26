# Mercado Aurora · Radar de margem e ruptura

Dashboard de uma **rede fictícia de 4 supermercados**: onde a margem é ganha e perdida, quais produtos faltam na gôndola, quanto se joga fora e o que um alerta automático avisaria ao gerente. Todos os dados são **100% sintéticos** (nenhuma empresa ou cliente real), gerados em Python com seed fixa.

Projeto de portfólio de **Gabriel Rangel**.

## O que responde

| Tela | Pergunta |
|---|---|
| **Visão geral** | Quanto a rede ganha de fato? Margem bruta × margem real, ponte da margem, leituras automáticas e um simulador do que vale agir. |
| **Margem** | Quais SKUs sustentam a receita (curva ABC) e quais deixam pouca margem (itens de tráfego)? Margem real por categoria e loja. |
| **Ruptura** | Quais itens faltam, quando e quanto isso custa? Pareto de venda perdida, ruptura por semana (com Black Friday, Natal e Páscoa) e por dia da semana. |
| **Perdas** | Onde se joga fora, por quê e em qual loja? Perda por categoria, loja, mês e motivo; giro e cobertura de estoque. |
| **Lojas e caixas** | Como as lojas se comparam? Receita por dia da semana, ticket ao longo do mês e dimensionamento de caixas por hora. |
| **Cesta** | O que sai junto? Pares por suporte, confiança e lift, e missões de compra. |
| **Alertas** | O que a automação avisaria? Regras, fila do dia e mensagem de WhatsApp ao gerente (especificação; automação ainda não conectada). |

## Como os dados são feitos

`scripts/gerar_dados.py` não sorteia números em cima de uma tabela pronta: **simula o estoque de cada SKU em cada loja, dia a dia** (demanda → venda limitada pelo estoque → quebra → pedido com ponto de reposição e lead time). Ruptura e perda nascem dessa simulação. Por cima entram sazonalidade (fim de semana, virada do mês, Black Friday, Natal, Páscoa, Copa), fornecedor irregular em parte dos itens de maior giro e uma loja que compra demais.

```bash
pip install -r scripts/requirements.txt
python scripts/gerar_dados.py          # regrava src/data/*.json (5 s, seed fixa)
```

## Arquitetura

- `src/data/`: JSONs já agregados (~950 KB). As duas séries grandes carregam sob demanda.
- `src/lib/insights.ts`: cálculos e leituras automáticas, funções puras. Todo número em texto é calculado dos dados, não digitado.
- `src/components/views/`: uma tela por arquivo; `src/components/aurora/kit.tsx`: painéis, KPIs, mapa de calor e barras.
- `src/test/insights.test.ts`: confere a coerência dos dados (margem real = bruta − perda, lojas e meses somam a rede, curva ABC fecha em 100%) e as leituras.
- Stack: TanStack Start, React 19, Tailwind v4, Recharts. Sem banco: o front lê JSON estático.

## Limites assumidos

- A taxa de ruptura (≈3%) vem da política de reposição simulada. Em operação real tende a ser maior, porque boa parte da ruptura é de execução (produto no depósito, fora da gôndola), e isso não está modelado.
- Venda perdida assume que 25% dos clientes levam outro item.
- Os motivos de perda são uma apropriação por regra sobre a perda simulada; em dado real viriam do registro de quebra.
- Os lifts da cesta são altos por construção (cestas geradas por missões de compra).
- Sem centro de distribuição, sem promoções, 280 SKUs.

## Rodar localmente

```bash
bun install   # ou npm install
bun dev       # ou npm run dev
bun run test
```
