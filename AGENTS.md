<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Mercado Aurora: rede fictícia de supermercados, dados 100% sintéticos. Os JSONs de src/data são gerados por scripts/gerar_dados.py (seed fixa); não editar à mão, regerar.
- src/lib/insights.ts e src/lib/format.ts são puros (sem React, sem alias "@") e testados em src/test; todo número exibido em texto sai dos dados.
- A UI lê dados só via src/lib/aurora-data.ts. Telas em src/components/views, selecionadas pelo search param ?view= em "/".
- Tokens de design em src/styles.css (tema único "amanhecer"); cores de série via variáveis --cat-1..6; gráficos Recharts montam só no cliente (ChartBox).
