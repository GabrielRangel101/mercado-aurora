#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Mercado Aurora - gerador de dados sinteticos (rede ficticia de 4 supermercados).

Gera JSONs ja agregados para o dashboard "Radar de Margem e Ruptura".
Nada aqui e dado real: marcas, lojas e numeros sao inventados.

Como funciona:
  1. Cataloga ~280 SKUs em 12 categorias (preco, margem, giro, marca propria).
  2. Simula 365 dias x 4 lojas x 280 SKUs com estoque de verdade:
     demanda (Poisson) -> venda limitada ao estoque -> perda -> reposicao
     com ponto de pedido e lead time. Ruptura e perda NASCEM da simulacao,
     nao sao sorteadas depois.
  3. Injeta padroes de negocio (ver GABARITO.md) para o dashboard ter o que contar.
  4. Agrega tudo e exporta JSON pequeno (< 2 MB no total).

Uso:
  python scripts/gerar_dados.py                 # grava em src/data
  python scripts/gerar_dados.py --out outra/pasta
Seed fixa: mesma saida em toda execucao.
"""
from __future__ import annotations

import argparse
import json
import math
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------
# Parametros globais
# --------------------------------------------------------------------------
SEED = 20261024
INICIO = date(2025, 10, 1)
FIM = date(2026, 9, 30)
SUBSTITUICAO = 0.25          # % da demanda nao atendida que vira outro produto (nao e venda perdida)
INFLACAO_MENSAL = 0.004      # deriva de preco/custo ao longo do ano
RECEITA_DIA_CENTRO = 45_000  # receita media diaria da loja base (Centro)
SIGMA_GIRO = 0.80            # ruido aleatorio do giro entre SKUs
GIRO_EXP = 2.4               # expoente sobre o giro declarado (controla o Pareto)
N_CESTAS = 30_000
WARMUP_DIAS = 28            # dias simulados antes do periodo, descartados (estoque estabiliza)

MOTIVOS = ("Vencimento", "Avaria", "Furto/Desvio", "Quebra operacional")
DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"]

LOJAS = [
    dict(id=1, nome="Aurora Centro",     porte=1.00, ticket=92.0,  caixas=5),
    dict(id=2, nome="Aurora Jardins",    porte=1.30, ticket=128.0, caixas=7),
    dict(id=3, nome="Aurora Vila Nova",  porte=0.75, ticket=78.0,  caixas=4),
    dict(id=4, nome="Aurora Portal",     porte=0.90, ticket=96.0,  caixas=5),
]
IDX_CENTRO, IDX_JARDINS, IDX_VILA, IDX_PORTAL = 0, 1, 2, 3

# afinidade loja x categoria (1.0 = base). O que nao aparece = 1.0 (+ ruido)
AFINIDADE = {
    IDX_JARDINS: {"Higiene e Beleza": 1.25, "Bebidas": 1.20, "Pet": 1.30, "Mercearia": 0.90},
    IDX_VILA:    {"Mercearia": 1.10, "Limpeza": 1.20, "Acougue": 1.10, "Hortifruti": 1.10,
                  "Bebidas": 0.85, "Pet": 0.80},
    IDX_PORTAL:  {"Congelados": 1.20, "Bebidas": 1.10},
}

# marca: (fator de preco, delta de margem, popularidade relativa)
MARCAS = {
    "Aurora":      (0.88, +0.06, 1.0),   # marca propria
    "Campo Verde": (1.00,  0.00, 1.2),
    "Vale Dourado": (1.12, -0.01, 0.7),
    "Serra Azul":  (1.00,  0.00, 1.1),
    "Bom Sabor":   (0.93, +0.02, 0.9),
}


def I(nome, preco, flag="", giro=1.0):
    """flag 'T' = item de trafego (cesta basica, margem baixa)."""
    return (nome, preco, flag, giro)


# share = % da receita; margem = faixa de margem bruta; perda = alvo de perda (% das unidades vendidas)
# R = dias entre pedidos; L = lead time (dias); vida = validade (dias); motivos = share por motivo
CATEGORIAS = {
    "Mercearia": dict(
        share=0.18, marcas=["Aurora", "Campo Verde", "Vale Dourado"], margem=(0.17, 0.24),
        perda=0.005, perecivel=False, R=4, L=2, vida=365, alerta_venc=0,
        motivos=(.15, .40, .35, .10),
        itens=[
            I("Arroz Tipo 1 5kg", 27.9, "T", 2.5), I("Feijão Carioca 1kg", 8.9, "T", 2.5),
            I("Açúcar Refinado 1kg", 4.6, "T", 2.2), I("Óleo de Soja 900ml", 7.4, "T", 2.2),
            I("Café Torrado e Moído 500g", 19.9, "T", 2.0), I("Sal Refinado 1kg", 2.9, "", 0.8),
            I("Macarrão Espaguete 500g", 5.2, "", 1.6), I("Macarrão Parafuso 500g", 5.2, "", 1.0),
            I("Molho de Tomate 340g", 3.9, "", 1.4), I("Farinha de Trigo 1kg", 5.5, "", 1.0),
            I("Farinha de Mandioca 500g", 6.9, "", 0.7), I("Milho Verde Lata 170g", 3.9, "", 0.9),
            I("Atum Ralado Lata 170g", 9.5, "", 0.8), I("Maionese 500g", 8.9, "", 1.0),
            I("Azeite de Oliva 500ml", 34.9, "", 0.8), I("Farofa Pronta 500g", 6.5, "", 0.8),
        ]),
    "Bebidas": dict(
        share=0.11, marcas=["Serra Azul", "Bom Sabor"], margem=(0.15, 0.22),
        perda=0.006, perecivel=False, R=3, L=2, vida=365, alerta_venc=0,
        motivos=(.05, .65, .25, .05),
        itens=[
            I("Refrigerante Cola 2L", 9.9, "", 2.5), I("Refrigerante Guaraná 2L", 8.9, "", 1.6),
            I("Água Mineral 1,5L", 3.2, "", 2.0), I("Água com Gás 500ml", 3.0, "", 0.6),
            I("Suco de Laranja 1L", 8.5, "", 1.0), I("Cerveja Pilsen Lata 350ml", 3.5, "", 3.5),
            I("Cerveja Long Neck 355ml", 5.5, "", 1.5), I("Energético 250ml", 8.5, "", 0.9),
            I("Chá Gelado 1,5L", 7.9, "", 0.7), I("Vinho Tinto Suave 750ml", 28.9, "", 0.6),
            I("Água de Coco 1L", 11.9, "", 0.6), I("Isotônico 500ml", 6.5, "", 0.7),
        ]),
    "Frios e Laticínios": dict(
        share=0.11, marcas=["Aurora", "Vale Dourado"], margem=(0.22, 0.30),
        perda=0.040, perecivel=True, R=2, L=1, vida=30, alerta_venc=7,
        motivos=(.60, .20, .12, .08),
        itens=[
            I("Leite UHT Integral 1L", 5.4, "T", 3.0), I("Leite UHT Desnatado 1L", 5.6, "", 1.0),
            I("Iogurte Natural 170g", 3.2, "", 1.4), I("Iogurte de Frutas 900g", 11.5, "", 1.0),
            I("Queijo Mussarela Fatiado 150g", 9.9, "", 1.8), I("Presunto Fatiado 150g", 8.9, "", 1.6),
            I("Manteiga 200g", 13.9, "", 1.0), I("Requeijão Cremoso 200g", 8.5, "", 1.0),
            I("Margarina 500g", 8.9, "", 1.2), I("Queijo Minas Frescal 500g", 18.9, "", 0.7),
            I("Creme de Leite 200g", 3.9, "", 1.0), I("Leite Condensado 395g", 6.9, "", 1.0),
            I("Queijo Ralado 50g", 4.9, "", 1.0), I("Ovos Branco 12un", 12.9, "T", 2.2),
        ]),
    "Açougue": dict(
        share=0.17, marcas=[], margem=(0.24, 0.30),
        perda=0.035, perecivel=True, R=1, L=1, vida=5, alerta_venc=2,
        motivos=(.45, .15, .10, .30),
        itens=[
            I("Frango Inteiro kg", 11.9, "", 3.0), I("Peito de Frango kg", 17.9, "", 1.8),
            I("Coxa e Sobrecoxa kg", 12.9, "", 1.6), I("Carne Moída kg", 34.9, "", 2.5),
            I("Alcatra kg", 54.9, "", 1.0), I("Contrafilé kg", 59.9, "", 0.9),
            I("Picanha kg", 89.9, "", 0.9), I("Costela Bovina kg", 29.9, "", 1.2),
            I("Linguiça Toscana kg", 21.9, "", 2.0), I("Linguiça de Frango kg", 19.9, "", 0.8),
            I("Bisteca Suína kg", 22.9, "", 0.9), I("Pernil Suíno kg", 18.9, "", 0.8),
            I("Filé de Tilápia kg", 39.9, "", 0.7), I("Hambúrguer Bovino 672g", 18.9, "", 0.8),
        ]),
    "Hortifruti": dict(
        share=0.08, marcas=[], margem=(0.30, 0.38),
        perda=0.100, perecivel=True, R=1, L=1, vida=6, alerta_venc=3,
        motivos=(.55, .30, .05, .10),
        itens=[
            I("Banana Prata kg", 6.9, "", 3.0), I("Maçã Fuji kg", 9.9, "", 1.4),
            I("Laranja Pera kg", 5.5, "", 1.2), I("Mamão Formosa kg", 6.9, "", 1.0),
            I("Melancia kg", 3.9, "", 1.0), I("Uva Verde kg", 16.9, "", 0.8),
            I("Limão Tahiti kg", 6.9, "", 1.0), I("Abacate kg", 9.9, "", 0.6),
            I("Tomate kg", 7.9, "", 2.5), I("Cebola kg", 5.9, "", 2.5),
            I("Batata Inglesa kg", 6.5, "", 2.5), I("Cenoura kg", 5.5, "", 1.5),
            I("Alho 100g", 4.5, "", 1.5), I("Alface Crespa un", 3.5, "", 1.5),
            I("Couve-flor un", 6.9, "", 0.6), I("Brócolis un", 7.5, "", 0.8),
            I("Pepino kg", 6.9, "", 0.6), I("Pimentão Verde kg", 11.9, "", 0.7),
            I("Abobrinha kg", 7.9, "", 0.7), I("Chuchu kg", 4.9, "", 0.7),
            I("Mandioca kg", 6.5, "", 0.8), I("Batata Doce kg", 7.5, "", 0.7),
            I("Cheiro-Verde maço", 3.0, "", 1.2), I("Repolho kg", 4.2, "", 0.7),
            I("Abóbora Cabotiá kg", 5.5, "", 0.6), I("Morango 250g", 9.9, "", 0.9),
            I("Manga kg", 9.5, "", 0.8), I("Beterraba kg", 5.9, "", 0.6),
        ]),
    "Padaria": dict(
        share=0.05, marcas=[], margem=(0.45, 0.55),
        perda=0.100, perecivel=True, R=1, L=1, vida=2, alerta_venc=0,
        motivos=(.70, .05, .05, .20),
        itens=[
            I("Pão Francês kg", 16.9, "", 4.0), I("Pão Sovado kg", 14.9, "", 1.2),
            I("Pão de Queijo 400g", 14.9, "", 1.4), I("Pão Doce un", 3.5, "", 1.5),
            I("Sonho un", 6.5, "", 1.0), I("Bolo Simples 500g", 17.9, "", 0.8),
            I("Croissant un", 7.9, "", 0.8), I("Rosca de Coco un", 6.9, "", 0.8),
            I("Broa de Milho un", 3.2, "", 0.8), I("Torta Salgada fatia", 9.5, "", 0.7),
            I("Salgado Assado un", 7.5, "", 1.4), I("Baguete un", 6.9, "", 0.8),
        ]),
    "Limpeza": dict(
        share=0.05, marcas=["Aurora", "Serra Azul"], margem=(0.27, 0.33),
        perda=0.005, perecivel=False, R=5, L=2, vida=365, alerta_venc=0,
        motivos=(.05, .45, .40, .10),
        itens=[
            I("Detergente Líquido 500ml", 2.8, "", 2.0), I("Sabão em Pó 1kg", 14.9, "", 1.4),
            I("Amaciante 2L", 13.9, "", 1.0), I("Desinfetante 1L", 7.9, "", 1.0),
            I("Água Sanitária 2L", 6.9, "", 1.0), I("Limpador Multiuso 500ml", 5.9, "", 0.8),
            I("Esponja Multiuso 3un", 5.5, "", 1.0), I("Lã de Aço 8un", 3.5, "", 0.6),
            I("Sabão em Barra 5un", 8.9, "", 0.7), I("Saco de Lixo 30L 20un", 9.9, "", 0.9),
            I("Papel Toalha 2un", 8.5, "", 0.8), I("Álcool 70% 1L", 8.9, "", 0.7),
        ]),
    "Higiene e Beleza": dict(
        share=0.07, marcas=["Aurora", "Vale Dourado"], margem=(0.30, 0.38),
        perda=0.012, perecivel=False, R=5, L=3, vida=365, alerta_venc=0,
        motivos=(.05, .15, .70, .10),
        itens=[
            I("Papel Higiênico 12un", 21.9, "", 2.5), I("Shampoo 350ml", 13.9, "", 1.2),
            I("Condicionador 350ml", 13.9, "", 1.0), I("Sabonete 85g", 2.5, "", 2.0),
            I("Creme Dental 90g", 4.5, "", 2.0), I("Desodorante Aerosol 150ml", 12.9, "", 1.2),
            I("Escova Dental", 4.9, "", 0.8), I("Absorvente 8un", 6.9, "", 1.2),
            I("Fio Dental 50m", 5.9, "", 0.5), I("Fralda Descartável M 30un", 39.9, "", 1.3),
            I("Enxaguante Bucal 500ml", 14.9, "", 0.6), I("Cotonete 75un", 4.5, "", 0.6),
            I("Lenço Umedecido 50un", 9.9, "", 0.7), I("Protetor Solar 120ml", 29.9, "", 0.4),
        ]),
    "Congelados": dict(
        share=0.04, marcas=["Bom Sabor", "Vale Dourado"], margem=(0.20, 0.26),
        perda=0.007, perecivel=False, R=4, L=2, vida=180, alerta_venc=0,
        motivos=(.30, .45, .15, .10),
        itens=[
            I("Pizza Congelada 460g", 19.9, "", 2.0), I("Lasanha Congelada 600g", 18.9, "", 1.0),
            I("Nuggets 300g", 14.9, "", 1.2), I("Hambúrguer Congelado 672g", 17.9, "", 1.0),
            I("Batata Palito 400g", 11.9, "", 1.0), I("Sorvete Pote 2L", 24.9, "", 1.4),
            I("Polpa de Fruta 400g", 8.9, "", 0.7), I("Pão de Alho 300g", 12.9, "", 1.2),
            I("Empanado de Frango 400g", 15.9, "", 0.8), I("Legumes Congelados 300g", 6.9, "", 0.5),
        ]),
    "Biscoitos e Matinais": dict(
        share=0.07, marcas=["Campo Verde", "Aurora"], margem=(0.22, 0.28),
        perda=0.008, perecivel=False, R=4, L=2, vida=270, alerta_venc=0,
        motivos=(.35, .30, .25, .10),
        itens=[
            I("Biscoito Recheado 130g", 3.5, "", 2.2), I("Biscoito Cream Cracker 400g", 5.9, "", 1.2),
            I("Biscoito Maisena 350g", 5.5, "", 1.0), I("Cereal Matinal 300g", 12.9, "", 0.9),
            I("Achocolatado em Pó 400g", 9.9, "", 1.5), I("Barra de Cereal 3un", 5.5, "", 0.9),
            I("Chocolate ao Leite 90g", 7.5, "", 1.2), I("Bombom Caixa 300g", 18.9, "", 0.6),
            I("Torrada 140g", 5.5, "", 0.6), I("Geleia 320g", 9.5, "", 0.5),
            I("Pão de Forma 500g", 8.9, "", 1.8), I("Granola 800g", 16.9, "", 0.5),
        ]),
    "Bazar": dict(
        share=0.03, marcas=[], margem=(0.35, 0.45),
        perda=0.006, perecivel=False, R=7, L=3, vida=365, alerta_venc=0,
        motivos=(.0, .35, .50, .15),
        itens=[
            I("Pilha AA 4un", 12.9, "", 1.0), I("Lâmpada LED 9W", 8.9, "", 1.0),
            I("Garrafa Térmica 1L", 49.9, "", 0.3), I("Copo Descartável 100un", 7.9, "", 1.4),
            I("Prato Descartável 10un", 5.9, "", 1.0), I("Carvão 3kg", 15.9, "", 2.0),
            I("Fósforo 10un", 4.5, "", 1.0), I("Guardanapo 50un", 3.9, "", 1.2),
            I("Papel Alumínio 30m", 8.9, "", 1.0), I("Filme PVC 30m", 6.5, "", 0.8),
            I("Vassoura", 14.9, "", 0.5), I("Rodo", 18.9, "", 0.4),
            I("Pano de Prato", 6.9, "", 0.8), I("Tábua de Corte", 22.9, "", 0.3),
        ]),
    "Pet": dict(
        share=0.04, marcas=["Serra Azul", "Aurora"], margem=(0.28, 0.34),
        perda=0.005, perecivel=False, R=7, L=3, vida=365, alerta_venc=0,
        motivos=(.20, .25, .45, .10),
        itens=[
            I("Ração Cães Adultos 1kg", 17.9, "", 2.0), I("Ração Gatos Adultos 1kg", 22.9, "", 1.2),
            I("Sachê Cães 85g", 3.5, "", 1.6), I("Sachê Gatos 85g", 3.2, "", 1.2),
            I("Areia Sanitária 4kg", 16.9, "", 1.0), I("Petisco Cães 65g", 8.5, "", 0.8),
            I("Shampoo Pet 500ml", 19.9, "", 0.4), I("Tapete Higiênico 7un", 23.9, "", 0.6),
        ]),
}

# missoes de compra para a analise de cesta: (item, prob. de entrar na cesta)
MISSOES = {
    "Churrasco": (0.06, [
        ("Picanha kg", .50), ("Alcatra kg", .40), ("Linguiça Toscana kg", .75), ("Costela Bovina kg", .30),
        ("Carvão 3kg", .85), ("Cerveja Pilsen Lata 350ml", .80), ("Refrigerante Cola 2L", .60),
        ("Farofa Pronta 500g", .60), ("Pão de Alho 300g", .50), ("Tomate kg", .40), ("Cebola kg", .40),
        ("Limão Tahiti kg", .30), ("Copo Descartável 100un", .25)]),
    "Café da manhã": (0.18, [
        ("Pão Francês kg", .80), ("Leite UHT Integral 1L", .85), ("Café Torrado e Moído 500g", .60),
        ("Manteiga 200g", .45), ("Presunto Fatiado 150g", .50), ("Queijo Mussarela Fatiado 150g", .50),
        ("Margarina 500g", .30), ("Biscoito Cream Cracker 400g", .30), ("Banana Prata kg", .40),
        ("Iogurte Natural 170g", .30), ("Açúcar Refinado 1kg", .35)]),
    "Macarronada": (0.08, [
        ("Macarrão Espaguete 500g", .90), ("Molho de Tomate 340g", .85), ("Queijo Ralado 50g", .60),
        ("Carne Moída kg", .60), ("Cebola kg", .50), ("Tomate kg", .40), ("Alho 100g", .40),
        ("Azeite de Oliva 500ml", .15)]),
    "Arroz e feijão": (0.22, [
        ("Arroz Tipo 1 5kg", .70), ("Feijão Carioca 1kg", .75), ("Óleo de Soja 900ml", .55),
        ("Alho 100g", .40), ("Cebola kg", .60), ("Frango Inteiro kg", .30), ("Peito de Frango kg", .35),
        ("Ovos Branco 12un", .40), ("Sal Refinado 1kg", .25), ("Batata Inglesa kg", .35),
        ("Tomate kg", .40), ("Cenoura kg", .25), ("Alface Crespa un", .25)]),
    "Limpeza da casa": (0.10, [
        ("Detergente Líquido 500ml", .85), ("Sabão em Pó 1kg", .60), ("Amaciante 2L", .45),
        ("Desinfetante 1L", .50), ("Água Sanitária 2L", .40), ("Esponja Multiuso 3un", .50),
        ("Saco de Lixo 30L 20un", .30), ("Papel Toalha 2un", .30), ("Limpador Multiuso 500ml", .30)]),
    "Higiene pessoal": (0.09, [
        ("Papel Higiênico 12un", .80), ("Shampoo 350ml", .50), ("Condicionador 350ml", .40),
        ("Sabonete 85g", .60), ("Creme Dental 90g", .60), ("Desodorante Aerosol 150ml", .40),
        ("Escova Dental", .20), ("Absorvente 8un", .25)]),
    "Lanche das crianças": (0.10, [
        ("Biscoito Recheado 130g", .70), ("Achocolatado em Pó 400g", .50), ("Suco de Laranja 1L", .40),
        ("Iogurte de Frutas 900g", .35), ("Pão de Forma 500g", .45), ("Presunto Fatiado 150g", .40),
        ("Queijo Mussarela Fatiado 150g", .40), ("Cereal Matinal 300g", .30), ("Barra de Cereal 3un", .30),
        ("Maçã Fuji kg", .30), ("Chocolate ao Leite 90g", .20)]),
    "Pet": (0.06, [
        ("Ração Cães Adultos 1kg", .55), ("Sachê Cães 85g", .50), ("Petisco Cães 65g", .35),
        ("Ração Gatos Adultos 1kg", .30), ("Sachê Gatos 85g", .30), ("Areia Sanitária 4kg", .25)]),
    "Reposição rápida": (0.30, [
        ("Pão Francês kg", .70), ("Leite UHT Integral 1L", .60), ("Banana Prata kg", .30),
        ("Ovos Branco 12un", .25), ("Refrigerante Guaraná 2L", .15), ("Cerveja Pilsen Lata 350ml", .10)]),
    "Jantar congelado": (0.05, [
        ("Pizza Congelada 460g", .70), ("Refrigerante Cola 2L", .65), ("Sorvete Pote 2L", .35),
        ("Nuggets 300g", .30), ("Batata Palito 400g", .30), ("Cerveja Pilsen Lata 350ml", .25),
        ("Lasanha Congelada 600g", .25)]),
}


# --------------------------------------------------------------------------
# Calendario e sazonalidade
# --------------------------------------------------------------------------
def gerar_datas():
    n = (FIM - INICIO).days + 1
    return [INICIO + timedelta(days=i) for i in range(n)]


def sazonalidade(datas, cats):
    """Retorna (S[t, cat], catdow[t, cat], aberto[t])."""
    ci = {c: i for i, c in enumerate(cats)}
    T = len(datas)
    S = np.ones((T, len(cats)))
    cdow = np.ones((T, len(cats)))
    aberto = np.ones(T)

    def jan(d, a, b):
        return a <= d <= b

    for t, d in enumerate(datas):
        m = d.month
        if m in (12, 1, 2):
            S[t, ci["Bebidas"]] *= 1.15
            S[t, ci["Hortifruti"]] *= 1.05
        if m in (6, 7, 8):
            S[t, ci["Bebidas"]] *= 0.90
            S[t, ci["Mercearia"]] *= 1.06
            S[t, ci["Congelados"]] *= 1.08
            S[t, ci["Padaria"]] *= 1.05
        # Dia das Criancas
        if jan(d, date(2025, 10, 6), date(2025, 10, 12)):
            S[t, ci["Bazar"]] *= 1.50
            S[t, ci["Biscoitos e Matinais"]] *= 1.15
        # Black Friday
        if jan(d, date(2025, 11, 24), date(2025, 11, 30)):
            S[t, ci["Bazar"]] *= 1.70
        # Natal: rampa de 17 a 24/12 (demanda sobe rapido e o pedido nao acompanha)
        if jan(d, date(2025, 12, 17), date(2025, 12, 24)):
            p = ((d - date(2025, 12, 17)).days + 1) / 8.0
            S[t, ci["Bebidas"]] *= 1 + 0.90 * p
            S[t, ci["Frios e Laticínios"]] *= 1 + 1.20 * p
            S[t, ci["Mercearia"]] *= 1 + 0.60 * p
            S[t, ci["Açougue"]] *= 1 + 0.90 * p
            S[t, ci["Hortifruti"]] *= 1 + 0.35 * p
            S[t, ci["Biscoitos e Matinais"]] *= 1 + 0.35 * p
            S[t, ci["Bazar"]] *= 1 + 0.30 * p
            S[t, ci["Padaria"]] *= 1 + 0.30 * p
        # Reveillon
        if jan(d, date(2025, 12, 26), date(2025, 12, 31)):
            S[t, ci["Bebidas"]] *= 1.40
            S[t, ci["Frios e Laticínios"]] *= 1.25
            S[t, ci["Açougue"]] *= 1.20
            S[t, ci["Hortifruti"]] *= 1.15
            S[t, ci["Mercearia"]] *= 1.15
        # Volta as aulas
        if jan(d, date(2026, 1, 19), date(2026, 2, 8)):
            S[t, ci["Bazar"]] *= 1.15
            S[t, ci["Biscoitos e Matinais"]] *= 1.10
        # Carnaval 2026 (13 a 17/02)
        if jan(d, date(2026, 2, 13), date(2026, 2, 17)):
            for c in cats:
                S[t, ci[c]] *= 0.92
            S[t, ci["Bebidas"]] *= 1.35 / 0.92
            S[t, ci["Açougue"]] *= 1.18 / 0.92
        # Pascoa 2026 (05/04)
        if jan(d, date(2026, 3, 23), date(2026, 4, 4)):
            S[t, ci["Biscoitos e Matinais"]] *= 1.60
            S[t, ci["Mercearia"]] *= 1.06
            S[t, ci["Padaria"]] *= 1.10
        if jan(d, date(2026, 3, 30), date(2026, 4, 3)):
            S[t, ci["Congelados"]] *= 1.35
        # Dia das Maes
        if jan(d, date(2026, 5, 4), date(2026, 5, 10)):
            S[t, ci["Higiene e Beleza"]] *= 1.25
            S[t, ci["Bazar"]] *= 1.20
            S[t, ci["Biscoitos e Matinais"]] *= 1.10
        # Copa do Mundo (jun-jul) - premissa sintetica de demanda
        if jan(d, date(2026, 6, 11), date(2026, 7, 19)):
            S[t, ci["Bebidas"]] *= 1.22
            S[t, ci["Açougue"]] *= 1.10
            S[t, ci["Biscoitos e Matinais"]] *= 1.05
        # fim de semana: churrasco
        if d.weekday() in (5, 6):
            cdow[t, ci["Bebidas"]] = 1.12
            cdow[t, ci["Açougue"]] = 1.12
        if d.weekday() == 6:
            cdow[t, ci["Padaria"]] = 1.10
        if (d.month, d.day) in ((12, 25), (1, 1)):
            aberto[t] = 0.0
    return S, cdow, aberto


def fatores_dia(datas):
    dow = np.array([0.85, 0.80, 0.85, 0.95, 1.15, 1.40, 0.95])

    def dom(dia):
        if dia <= 5:
            return 1.20
        if dia <= 10:
            return 1.10
        if dia <= 14:
            return 0.95
        if dia <= 22:
            return 0.88
        if dia <= 27:
            return 0.95
        return 1.12

    return np.array([dow[d.weekday()] * dom(d.day) for d in datas])


# --------------------------------------------------------------------------
# Catalogo
# --------------------------------------------------------------------------
def montar_catalogo(rng):
    produtos = []
    for cat, spec in CATEGORIAS.items():
        linhas = []
        for nome, preco, flag, giro in spec["itens"]:
            variantes = spec["marcas"] if spec["marcas"] else [None]
            for marca in variantes:
                pf, md, pp = MARCAS[marca] if marca else (1.0, 0.0, 1.0)
                p = preco * pf
                p = round(round(p, 1) - 0.01, 2) if p >= 3 else round(p, 2)
                lo, hi = spec["margem"]
                if flag == "T":
                    lo, hi = 0.06, 0.11
                elif "cerveja" in nome.lower():
                    lo, hi = 0.11, 0.16
                m = float(rng.uniform(lo, hi)) + (md * 0.5 if flag == "T" else md)
                m = float(min(max(m, 0.04), 0.62))
                w = (giro ** GIRO_EXP) * pp * float(np.exp(rng.normal(0, SIGMA_GIRO)))
                longa = any(k in nome for k in ("UHT", "Condensado", "Creme de Leite"))
                pmult = 0.15 if longa else (0.5 if "Ovos" in nome else 1.0)
                linhas.append(dict(base_item=nome, marca=marca, categoria=cat, preco=p,
                                   margem=m, flag=flag, w=w, perda_mult=pmult,
                                   perecivel_item=bool(spec["perecivel"] and not longa)))
        tot_w = sum(l["w"] for l in linhas)
        rec_cat = spec["share"] * RECEITA_DIA_CENTRO
        for l in linhas:
            rec_i = rec_cat * l["w"] / tot_w
            l["un_dia_centro"] = rec_i / l["preco"]
            l["rec_dia_centro"] = rec_i
        produtos.extend(linhas)
    for i, p in enumerate(produtos, start=1):
        p["sku_id"] = i
        p["codigo"] = f"A{i:04d}"
        p["nome"] = f"{p['base_item']} {p['marca']}" if p["marca"] else p["base_item"]
        p["custo"] = round(p["preco"] * (1 - p["margem"]), 4)
    return produtos


# --------------------------------------------------------------------------
# Simulacao de estoque
# --------------------------------------------------------------------------
def preparar(rng, produtos, datas):
    cats = list(CATEGORIAS)
    ci = {c: i for i, c in enumerate(cats)}
    n, nl, T = len(produtos), len(LOJAS), len(datas)
    W = WARMUP_DIAS
    datas_sim = [INICIO - timedelta(days=W - i) for i in range(W)] + list(datas)
    Ttot = T + W
    N = n * nl
    sku_idx = np.repeat(np.arange(n), nl)
    loja_idx = np.tile(np.arange(nl), n)
    cat_sku = np.array([ci[p["categoria"]] for p in produtos])
    cat_N = cat_sku[sku_idx]

    # afinidade loja x categoria
    aff = np.exp(rng.normal(0, 0.10, (nl, len(cats))))
    aff[IDX_CENTRO, :] = 1.0
    for l, d in AFINIDADE.items():
        for c, v in d.items():
            aff[l, ci[c.replace("Acougue", "Açougue")]] *= v
    porte = np.array([l["porte"] for l in LOJAS])

    un_centro = np.array([p["un_dia_centro"] for p in produtos])
    base = (un_centro[sku_idx] * porte[loja_idx] * aff[loja_idx, cat_N]
            * np.exp(rng.normal(0, 0.10, N)))

    # classe preliminar (ranking de receita base) para definir nivel de servico
    rec_base = np.array([p["rec_dia_centro"] for p in produtos])
    ordem = np.argsort(-rec_base)
    rank = np.empty(n, dtype=int)
    rank[ordem] = np.arange(n)
    cls_pre = np.where(rank < int(0.20 * n), 0, np.where(rank < int(0.50 * n), 1, 2))

    R = np.array([CATEGORIAS[c]["R"] for c in cats])[cat_N].astype(int)
    L = np.array([CATEGORIAS[c]["L"] for c in cats])[cat_N].astype(int)
    perec = np.array([CATEGORIAS[c]["perecivel"] for c in cats])[cat_N]
    expo = np.array([EXPO[c] for c in cats])[cat_N].astype(float)

    # Vila Nova: pedidos mais espacados (+4 dias) nas categorias nao perecoveis
    R = R + np.where((loja_idx == IDX_VILA) & (~perec), 4, 0)
    off = rng.integers(0, 1000, N) % R

    z_por_classe = np.array([Z_A, Z_B, Z_C])
    z = z_por_classe[cls_pre[sku_idx]].astype(float)
    # Jardins: superdimensiona perecoveis (gera sobra e perda)
    z = np.where((loja_idx == IDX_JARDINS) & perec, Z_JARDINS_PEREC, z)

    # SKUs-problema: classe A com fornecedor ruim (z baixo + janelas de atraso)
    candidatos = [i for i in ordem[:60]]
    problema = sorted(rng.choice(candidatos, size=N_PROBLEMA, replace=False).tolist())
    is_prob_N = np.isin(sku_idx, problema)
    z = np.where(is_prob_N, Z_PROBLEMA, z)

    extra = np.zeros((Ttot, N), dtype=np.int16)
    # falhas aleatorias de fornecedor (todos os SKUs)
    falha = rng.random((Ttot, N)) < P_FALHA
    extra += (falha * 3).astype(np.int16)
    # janelas de atraso nos SKUs-problema
    for s in problema:
        for _ in range(3):
            ini = int(rng.integers(W + 5, Ttot - 12))
            lojas_afetadas = [0, 1, 2, 3] if rng.random() < 0.5 else [int(rng.integers(0, 4))]
            for l in lojas_afetadas:
                extra[ini:ini + 7, s * nl + l] += 5

    # perda: p diario inicial como fracao do estoque
    alvo = np.array([CATEGORIAS[c]["perda"] for c in cats])
    pmult_sku = np.array([p["perda_mult"] for p in produtos])
    ploss_base = alvo[cat_N] / (R / 2.0 + L + 1.5) * pmult_sku[sku_idx]
    ploss_store = np.where((loja_idx == IDX_JARDINS) & perec, MULT_PERDA_JARDINS, 1.0)

    seas, cdow, aberto = sazonalidade(datas_sim, cats)
    dayfac = fatores_dia(datas_sim)
    sd = np.exp(rng.normal(0, 0.05, (Ttot, nl)))

    return dict(
        T=T, W=W, Ttot=Ttot, N=N, n=n, cats=cats, ci=ci, sku_idx=sku_idx, loja_idx=loja_idx, cat_N=cat_N,
        base=base, R=R, L=L, off=off, z=z, extra=extra, problema=problema,
        ploss_base=ploss_base, ploss_store=ploss_store, alvo=alvo,
        seas=seas, cdow=cdow, aberto=aberto, dayfac=dayfac, sd=sd,
        cls_pre=cls_pre, perec=perec, expo=expo,
    )


def simular(P, p_scale):
    rng = np.random.default_rng(SEED + 100)
    T, N = P["Ttot"], P["N"]
    W = P["W"]
    To = T - W
    base, R, L, off, z = P["base"], P["R"], P["L"], P["off"], P["z"]
    cat_N, loja_N = P["cat_N"], P["loja_idx"]
    ploss = np.clip(P["ploss_base"] * p_scale[cat_N] * P["ploss_store"], 0, 0.9)
    Pn = (R + L).astype(float)
    idx = np.arange(N)
    alpha = 0.10

    stock = np.ceil(base * (R + L) * 1.2).astype(np.int64)
    m = base.copy()
    var = base + (0.3 * base) ** 2
    pipe = np.zeros(N)
    arrivals = np.zeros((T + 40, N))

    units = np.zeros((To, N))
    lost = np.zeros((To, N))
    perda = np.zeros((To, N))
    stock_end = np.zeros((To, N))
    m_hist = np.zeros((To, N))

    for t in range(T):
        arr = arrivals[t]
        stock = stock + arr.astype(np.int64)
        pipe -= arr
        if P["aberto"][t] > 0:
            lam = (base * P["dayfac"][t] * P["seas"][t][cat_N] * P["cdow"][t][cat_N]
                   * P["sd"][t][loja_N] * rng.lognormal(0, 0.15, N))
            d = rng.poisson(lam).astype(np.int64)
        else:
            d = np.zeros(N, dtype=np.int64)
        v = np.minimum(stock, d)
        lo = d - v
        stock = stock - v
        pe = rng.binomial(stock, ploss)
        stock = stock - pe

        if P["aberto"][t] > 0:
            err = d - m
            m = m + alpha * err
            var = (1 - alpha) * var + alpha * err ** 2

        # pedido
        mask = ((t + off) % R) == 0
        nivel = m * Pn + z * np.sqrt(np.maximum(var, 1e-6) * Pn)
        ordem = np.where(mask, np.ceil(np.maximum(0.0, nivel - (stock + pipe))), 0.0)
        chega = np.minimum(t + L + P["extra"][t].astype(int), T + 39)
        arrivals[chega, idx] += ordem
        pipe += ordem

        if t >= W:
            k = t - W
            units[k], lost[k], perda[k], stock_end[k], m_hist[k] = v, lo, pe, stock, m
    return dict(units=units, lost=lost, perda=perda, stock_end=stock_end, m=m_hist)


def calibrar_perdas(P, iteracoes=3):
    ncat = len(P["cats"])
    p_scale = np.ones(ncat)
    for _ in range(iteracoes):
        out = simular(P, p_scale)
        un = out["units"].sum(axis=0)
        pe = out["perda"].sum(axis=0)
        for c in range(ncat):
            sel = P["cat_N"] == c
            real = pe[sel].sum() / max(un[sel].sum(), 1.0)
            if real > 0:
                p_scale[c] = float(np.clip(p_scale[c] * P["alvo"][c] / real, 0.05, 8.0))
    return p_scale, simular(P, p_scale)


# --------------------------------------------------------------------------
# Parametros de politica de estoque (ajustaveis)
# --------------------------------------------------------------------------
Z_A, Z_B, Z_C = 0.90, 0.60, 0.30
Z_JARDINS_PEREC = 2.4
Z_PROBLEMA = -0.50
N_PROBLEMA = 14
P_FALHA = 0.0025
MULT_PERDA_JARDINS = 1.35
# dias de venda em estoque minimo de exposicao (frente de gondola), por categoria.
# So entra nas metricas de cobertura e giro; a ruptura e a perda vem do estoque vendavel simulado.
EXPO = {"Mercearia": 8, "Bebidas": 6, "Frios e Laticínios": 3, "Açougue": 0.8, "Hortifruti": 1.0,
        "Padaria": 0.3, "Limpeza": 10, "Higiene e Beleza": 12, "Congelados": 6,
        "Biscoitos e Matinais": 8, "Bazar": 18, "Pet": 14}


# --------------------------------------------------------------------------
# Utilidades de saida
# --------------------------------------------------------------------------
def registros(df, casas=2):
    df = df.copy()
    for c in df.columns:
        if pd.api.types.is_float_dtype(df[c]):
            df[c] = df[c].round(casas)
    return json.loads(df.to_json(orient="records", force_ascii=False))


def gravar(pasta: Path, nome, obj):
    caminho = pasta / nome
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    return caminho.stat().st_size


def pct(a, b, casas=2):
    return round(100.0 * a / b, casas) if b else 0.0


# --------------------------------------------------------------------------
# Cesta de compras
# --------------------------------------------------------------------------
def gerar_cestas(produtos, datas):
    rng = np.random.default_rng(SEED + 500)
    base_items = sorted({p["base_item"] for p in produtos})
    pos = {b: i for i, b in enumerate(base_items)}
    for nome, (_, itens) in MISSOES.items():
        for it, _ in itens:
            assert it in pos, f"item de missao inexistente no catalogo: {it}"

    rec_base = {}
    for p in produtos:
        rec_base[p["base_item"]] = rec_base.get(p["base_item"], 0) + p["rec_dia_centro"]
    w_ruido = np.array([math.sqrt(rec_base[b]) for b in base_items])
    w_ruido = w_ruido / w_ruido.sum()

    nomes_m = list(MISSOES)
    w_m = np.array([MISSOES[m][0] for m in nomes_m])
    dow_w = np.array([0.85, 0.80, 0.85, 0.95, 1.15, 1.40, 0.95])
    dow_w = dow_w / dow_w.sum()

    B = np.zeros((N_CESTAS, len(base_items)), dtype=np.uint8)
    cont_missao = {m: 0 for m in nomes_m}
    for k in range(N_CESTAS):
        dow = int(rng.choice(7, p=dow_w))
        w = w_m.copy()
        if dow in (5, 6):
            w[nomes_m.index("Churrasco")] *= 3.0 if dow == 5 else 2.0
        if dow in (4, 5):
            w[nomes_m.index("Jantar congelado")] *= 2.0
        if dow < 5:
            w[nomes_m.index("Reposição rápida")] *= 1.3
        w = w / w.sum()
        n_m = int(rng.choice([1, 2, 3], p=[0.45, 0.35, 0.20]))
        escolhidas = rng.choice(len(nomes_m), size=n_m, replace=False, p=w)
        for mi in escolhidas:
            nome = nomes_m[mi]
            cont_missao[nome] += 1
            itens = MISSOES[nome][1]
            probs = np.array([p for _, p in itens]) * rng.uniform(0.9, 1.1)
            sel = rng.random(len(itens)) < probs
            for (it, _), s in zip(itens, sel):
                if s:
                    B[k, pos[it]] = 1
        k_ruido = int(rng.poisson(2.5))
        if k_ruido:
            for j in rng.choice(len(base_items), size=k_ruido, replace=False, p=w_ruido):
                B[k, j] = 1
    # cestas vazias nao existem
    vazias = B.sum(axis=1) == 0
    B[vazias, pos["Pão Francês kg"]] = 1

    Bf = B.astype(np.float32)
    co = Bf.T @ Bf
    freq = np.diag(co).copy()
    sup = freq / N_CESTAS
    pares = []
    ni = len(base_items)
    for i in range(ni):
        for j in range(i + 1, ni):
            c = co[i, j]
            if c < 200:
                continue
            s_ab = c / N_CESTAS
            lift = s_ab / (sup[i] * sup[j])
            pares.append(dict(
                item_a=base_items[i], item_b=base_items[j],
                suporte_pct=round(100 * float(s_ab), 2),
                confianca_a_b_pct=round(100 * float(c / freq[i]), 1),
                confianca_b_a_pct=round(100 * float(c / freq[j]), 1),
                lift=round(float(lift), 2), cestas=int(c)))
    df = pd.DataFrame(pares)
    top_lift = df[df.suporte_pct >= 0.6].sort_values("lift", ascending=False).head(30)
    top_sup = df.sort_values("suporte_pct", ascending=False).head(15)
    top_itens = sorted(
        [dict(item=base_items[i], penetracao_pct=round(100 * float(sup[i]), 1)) for i in range(ni)],
        key=lambda x: -x["penetracao_pct"])[:20]
    out = dict(
        n_cestas=N_CESTAS,
        itens_por_cesta_media=round(float(B.sum(axis=1).mean()), 1),
        pares_maior_lift=registros(top_lift, 2),
        pares_maior_suporte=registros(top_sup, 2),
        itens_mais_presentes=top_itens,
        nota="Cestas sinteticas geradas por missoes de compra (churrasco, cafe da manha etc.). "
             "Lift > 1 = os itens aparecem juntos mais do que o acaso.")
    missoes_part = {m: round(100 * cont_missao[m] / N_CESTAS, 1) for m in nomes_m}
    return out, missoes_part


# --------------------------------------------------------------------------
# Programa principal
# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "src" / "data"))
    args = ap.parse_args()
    pasta = Path(args.out)
    pasta.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(SEED)
    datas = gerar_datas()
    produtos = montar_catalogo(rng)
    P = preparar(rng, produtos, datas)
    T, N, n = P["T"], P["N"], P["n"]
    nl = len(LOJAS)
    cats = P["cats"]

    p_scale, out = calibrar_perdas(P)
    units, lost, perda, stock_end, m_hist = (out[k] for k in ("units", "lost", "perda", "stock_end", "m"))

    # precos e custos no tempo
    mes_idx = np.array([(d.year - 2025) * 12 + d.month - 10 for d in datas])
    infl = (1 + INFLACAO_MENSAL) ** mes_idx
    preco0 = np.array([p["preco"] for p in produtos])
    custo0 = np.array([p["custo"] for p in produtos])
    sku_idx, loja_idx, cat_N = P["sku_idx"], P["loja_idx"], P["cat_N"]
    preco_t = infl[:, None] * preco0[sku_idx][None, :]
    custo_t = infl[:, None] * custo0[sku_idx][None, :]

    rec = units * preco_t
    cmv = units * custo_t
    perda_c = perda * custo_t
    vperd = lost * preco_t * (1 - SUBSTITUICAO)
    rupt = (lost > 0).astype(np.int8)
    aberto = np.repeat(P["aberto"][P["W"]:][:, None], N, axis=1)

    seg = np.array([d - timedelta(days=d.weekday()) for d in datas])
    mes_str = np.array([d.strftime("%Y-%m") for d in datas])
    dow_t = np.array([d.weekday() for d in datas])

    df = pd.DataFrame({
        "t": np.repeat(np.arange(T), N),
        "sku": np.tile(sku_idx, T),
        "loja": np.tile(loja_idx, T),
        "cat": np.tile(cat_N, T),
        "un": units.ravel(), "lost": lost.ravel(), "perda": perda.ravel(),
        "rec": rec.ravel(), "cmv": cmv.ravel(), "perda_c": perda_c.ravel(),
        "vperd": vperd.ravel(), "rupt": rupt.ravel(), "aberto": aberto.ravel(),
        "stock_c": ((stock_end + P["expo"][None, :] * m_hist) * custo_t).ravel(),
    })
    df["mes"] = mes_str[df.t.values]
    df["semana"] = seg[df.t.values]
    df["dow"] = dow_t[df.t.values]
    df["cat_nome"] = np.array(cats)[df.cat.values]
    df["loja_nome"] = np.array([l["nome"] for l in LOJAS])[df.loja.values]

    # ---------------- curva ABC ----------------
    sk = df.groupby("sku").agg(receita=("rec", "sum"), qtd=("un", "sum"), cmv=("cmv", "sum"),
                               perda_custo=("perda_c", "sum"), venda_perdida=("vperd", "sum"),
                               dias_ruptura=("rupt", "sum")).reset_index()
    sk["margem_valor"] = sk.receita - sk.cmv
    sk["margem_real_valor"] = sk.margem_valor - sk.perda_custo
    sk = sk.sort_values("receita", ascending=False).reset_index(drop=True)
    sk["pct_receita"] = 100 * sk.receita / sk.receita.sum()
    sk["pct_acum"] = sk.pct_receita.cumsum()
    sk["classe"] = np.where(sk.pct_acum.shift(fill_value=0) < 80, "A",
                            np.where(sk.pct_acum.shift(fill_value=0) < 95, "B", "C"))
    sk["rank"] = np.arange(1, len(sk) + 1)
    sk["margem_pct"] = 100 * sk.margem_valor / sk.receita
    sk["margem_real_pct"] = 100 * sk.margem_real_valor / sk.receita
    sk["perda_pct_receita"] = 100 * sk.perda_custo / sk.receita
    sk["classe_margem"] = "C"
    ordm = sk.sort_values("margem_real_valor", ascending=False)
    acm = 100 * ordm.margem_real_valor.cumsum() / ordm.margem_real_valor.sum()
    sk.loc[ordm.index, "classe_margem"] = np.where(acm.shift(fill_value=0) < 80, "A",
                                                   np.where(acm.shift(fill_value=0) < 95, "B", "C"))
    pinfo = pd.DataFrame(produtos).reset_index(drop=True)
    pinfo["sku"] = np.arange(len(pinfo))
    sk = sk.merge(pinfo[["sku", "sku_id", "codigo", "nome", "base_item", "categoria", "marca", "preco", "flag"]],
                  on="sku")
    classe_sku = dict(zip(sk.sku, sk.classe))
    df["classe"] = df.sku.map(classe_sku)

    curva_abc = sk[["rank", "sku_id", "codigo", "nome", "categoria", "marca", "classe", "classe_margem",
                    "receita", "qtd", "pct_receita", "pct_acum", "margem_pct", "margem_real_pct",
                    "perda_pct_receita", "venda_perdida", "dias_ruptura"]].copy()

    # ---------------- vendas diarias por loja + cupons ----------------
    dl = df.groupby(["t", "loja"]).agg(receita=("rec", "sum"), cmv=("cmv", "sum"),
                                       perda_custo=("perda_c", "sum"),
                                       venda_perdida=("vperd", "sum")).reset_index()
    rng_t = np.random.default_rng(SEED + 900)
    dow_tk = np.array([0.88, 0.85, 0.88, 0.95, 1.05, 1.12, 1.00])

    def dom_tk(dia):
        if dia <= 7:
            return 1.22
        if dia <= 14:
            return 1.00
        if dia <= 22:
            return 0.90
        if dia <= 27:
            return 0.95
        return 1.10

    tick = []
    media_loja = dl.groupby("loja").receita.mean().to_dict()
    for _, r in dl.iterrows():
        t, l = int(r.t), int(r.loja)
        d = datas[t]
        razao = max(r.receita, 1) / media_loja[l]
        tk = (LOJAS[l]["ticket"] * dow_tk[d.weekday()] * dom_tk(d.day)
              * (min(max(razao, 0.3), 2.5) ** 0.4) * float(np.exp(rng_t.normal(0, 0.03))))
        tick.append(tk)
    dl["ticket_medio"] = tick
    dl["cupons"] = np.where(dl.receita > 0, dl.receita / dl.ticket_medio, 0).round().astype(int)
    dl["ticket_medio"] = np.where(dl.cupons > 0, dl.receita / dl.cupons.clip(lower=1), 0)
    dl["data"] = [datas[int(t)].isoformat() for t in dl.t]
    dl["loja_id"] = dl.loja + 1
    dl["margem_valor"] = dl.receita - dl.cmv
    vendas_diarias = dl[["data", "loja_id", "receita", "margem_valor", "perda_custo", "venda_perdida",
                         "cupons", "ticket_medio"]]

    # ---------------- semanal categoria x loja (semanas completas) ----------------
    primeira = INICIO + timedelta(days=(7 - INICIO.weekday()) % 7)
    ult_dom = FIM - timedelta(days=(FIM.weekday() + 1) % 7)
    sem_ini = pd.Timestamp(primeira).date()
    sem_fim = pd.Timestamp(ult_dom - timedelta(days=6)).date()
    dfs = df[(df.semana >= sem_ini) & (df.semana <= sem_fim)]
    sc = dfs.groupby(["semana", "loja", "cat"]).agg(
        receita=("rec", "sum"), cmv=("cmv", "sum"), perda_custo=("perda_c", "sum"),
        venda_perdida=("vperd", "sum"), qtd=("un", "sum")).reset_index()
    sc["margem_valor"] = sc.receita - sc.cmv
    sc["semana"] = sc.semana.astype(str)
    sc["loja_id"] = sc.loja + 1
    sc["categoria"] = np.array(cats)[sc.cat.values]
    vendas_semanais = sc[["semana", "loja_id", "categoria", "receita", "margem_valor",
                          "perda_custo", "venda_perdida", "qtd"]]

    # ---------------- ruptura ----------------
    dfo = df[df.aberto > 0]
    rs = dfo.groupby(["semana", "loja"]).agg(dias_sku=("rupt", "size"), rup=("rupt", "sum"),
                                              venda_perdida=("vperd", "sum")).reset_index()
    ra = dfo[dfo.classe == "A"].groupby(["semana", "loja"]).agg(dias_a=("rupt", "size"),
                                                                 rup_a=("rupt", "sum")).reset_index()
    rs = rs.merge(ra, on=["semana", "loja"])
    rs = rs[(rs.semana >= sem_ini) & (rs.semana <= sem_fim)].copy()
    rs["taxa_ruptura_pct"] = 100 * rs.rup / rs.dias_sku
    rs["taxa_ruptura_A_pct"] = 100 * rs.rup_a / rs.dias_a
    rs["semana"] = rs.semana.astype(str)
    rs["loja_id"] = rs.loja + 1
    ruptura_semanal = rs[["semana", "loja_id", "taxa_ruptura_pct", "taxa_ruptura_A_pct", "venda_perdida"]]

    rd = dfo.groupby(["loja", "dow"]).agg(dias_sku=("rupt", "size"), rup=("rupt", "sum"),
                                           venda_perdida=("vperd", "sum")).reset_index()
    rd["taxa_ruptura_pct"] = 100 * rd.rup / rd.dias_sku
    rd["loja_id"] = rd.loja + 1
    rd["dia"] = [DIAS[i] for i in rd.dow]
    ruptura_dow = rd[["loja_id", "dow", "dia", "taxa_ruptura_pct", "venda_perdida"]]

    rsku = df.groupby("sku").agg(venda_perdida=("vperd", "sum"), dias_ruptura=("rupt", "sum")).reset_index()
    rsku_l = df.groupby(["sku", "loja"]).vperd.sum().unstack()
    rsku = rsku.merge(sk[["sku", "sku_id", "nome", "categoria", "classe", "receita"]], on="sku")
    rsku = rsku.sort_values("venda_perdida", ascending=False).reset_index(drop=True)
    tot_vp = rsku.venda_perdida.sum()
    rsku["pct_do_total"] = 100 * rsku.venda_perdida / tot_vp
    rsku["pct_acum"] = rsku.pct_do_total.cumsum()
    rsku["perda_sobre_receita_pct"] = 100 * rsku.venda_perdida / rsku.receita
    top = rsku.head(30).copy()
    for l in range(nl):
        top[f"venda_perdida_loja{l + 1}"] = [float(rsku_l.loc[s, l]) for s in top.sku]
    ruptura_skus = top[["sku_id", "nome", "categoria", "classe", "receita", "venda_perdida", "dias_ruptura",
                        "pct_do_total", "pct_acum", "perda_sobre_receita_pct"]
                       + [f"venda_perdida_loja{l + 1}" for l in range(nl)]]

    rc = dfo.groupby("cat").agg(dias_sku=("rupt", "size"), rup=("rupt", "sum"),
                                 venda_perdida=("vperd", "sum")).reset_index()
    rc["taxa_ruptura_pct"] = 100 * rc.rup / rc.dias_sku

    # ---------------- perdas ----------------
    pm = df.groupby(["mes", "loja", "cat"]).agg(unidades=("perda", "sum"), valor_custo=("perda_c", "sum"),
                                                 receita=("rec", "sum")).reset_index()
    rng_m = np.random.default_rng(SEED + 700)
    linhas_m = []
    for _, r in pm.iterrows():
        cat = cats[int(r["cat"])]
        sh = np.array(CATEGORIAS[cat]["motivos"], dtype=float)
        if int(r.loja) == IDX_JARDINS and CATEGORIAS[cat]["perecivel"]:
            sh = sh + np.array([0.15, 0, 0, 0])
        sh = sh * (1 + rng_m.normal(0, 0.06, 4))
        sh = np.clip(sh, 0, None)
        sh = sh / sh.sum() if sh.sum() > 0 else np.array([0.25] * 4)
        for k, mo in enumerate(MOTIVOS):
            linhas_m.append((r.mes, int(r.loja), cat, mo, r.unidades * sh[k], r.valor_custo * sh[k]))
    pmot = pd.DataFrame(linhas_m, columns=["mes", "loja", "categoria", "motivo", "unidades", "valor_custo"])
    perdas_motivos = pmot.groupby(["mes", "categoria", "motivo"], as_index=False)[["unidades", "valor_custo"]].sum()

    perdas_mensal = df.groupby(["mes", "cat"]).agg(unidades=("perda", "sum"), valor_custo=("perda_c", "sum"),
                                                    receita=("rec", "sum")).reset_index()
    perdas_mensal["categoria"] = np.array(cats)[perdas_mensal.cat.values]
    perdas_mensal["perda_pct_receita"] = 100 * perdas_mensal.valor_custo / perdas_mensal.receita
    perdas_mensal = perdas_mensal[["mes", "categoria", "unidades", "valor_custo", "receita", "perda_pct_receita"]]

    # ---------------- loja x categoria ----------------
    lc = df.groupby(["loja", "cat"]).agg(receita=("rec", "sum"), cmv=("cmv", "sum"),
                                          perda_custo=("perda_c", "sum"), perda_un=("perda", "sum"),
                                          un=("un", "sum"), venda_perdida=("vperd", "sum")).reset_index()
    lco = dfo.groupby(["loja", "cat"]).agg(dias_sku=("rupt", "size"), rup=("rupt", "sum")).reset_index()
    lc = lc.merge(lco, on=["loja", "cat"])
    lc["categoria"] = np.array(cats)[lc.cat.values]
    lc["loja_id"] = lc.loja + 1
    lc["margem_bruta_pct"] = 100 * (lc.receita - lc.cmv) / lc.receita
    lc["perda_pct_receita"] = 100 * lc.perda_custo / lc.receita
    lc["perda_pct_unidades"] = 100 * lc.perda_un / lc.un
    lc["margem_real_pct"] = 100 * (lc.receita - lc.cmv - lc.perda_custo) / lc.receita
    lc["taxa_ruptura_pct"] = 100 * lc.rup / lc.dias_sku
    loja_categoria = lc[["loja_id", "categoria", "receita", "margem_bruta_pct", "perda_pct_receita",
                         "perda_pct_unidades", "margem_real_pct", "taxa_ruptura_pct", "venda_perdida"]]

    # ---------------- categorias ----------------
    cg = df.groupby("cat").agg(receita=("rec", "sum"), cmv=("cmv", "sum"), perda_custo=("perda_c", "sum"),
                                venda_perdida=("vperd", "sum"), un=("un", "sum")).reset_index()
    est_medio = df.groupby("cat").stock_c.sum() / T
    cg["estoque_medio_custo"] = cg.cat.map(est_medio)
    cg = cg.merge(rc[["cat", "taxa_ruptura_pct"]], on="cat")
    cg["categoria"] = np.array(cats)[cg.cat.values]
    cg["share_receita_pct"] = 100 * cg.receita / cg.receita.sum()
    cg["margem_bruta_pct"] = 100 * (cg.receita - cg.cmv) / cg.receita
    cg["perda_pct_receita"] = 100 * cg.perda_custo / cg.receita
    cg["margem_real_pct"] = 100 * (cg.receita - cg.cmv - cg.perda_custo) / cg.receita
    cg["margem_real_valor"] = cg.receita - cg.cmv - cg.perda_custo
    cg["giro_estoque_ano"] = cg.cmv / (cg.estoque_medio_custo * (T / 365.0))
    cg["cobertura_media_dias"] = 365.0 / cg.giro_estoque_ano
    cg["perecivel"] = [bool(CATEGORIAS[c]["perecivel"]) for c in cg.categoria]
    cg = cg.sort_values("receita", ascending=False)
    categorias = cg[["categoria", "perecivel", "receita", "share_receita_pct", "margem_bruta_pct", "perda_pct_receita",
                     "margem_real_pct", "margem_real_valor", "taxa_ruptura_pct", "venda_perdida",
                     "giro_estoque_ano", "cobertura_media_dias"]]

    # ---------------- lojas ----------------
    lj = df.groupby("loja").agg(receita=("rec", "sum"), cmv=("cmv", "sum"), perda_custo=("perda_c", "sum"),
                                 venda_perdida=("vperd", "sum")).reset_index()
    ljo = dfo.groupby("loja").agg(dias_sku=("rupt", "size"), rup=("rupt", "sum")).reset_index()
    ljc = dl.groupby("loja").agg(cupons=("cupons", "sum")).reset_index()
    lj = lj.merge(ljo, on="loja").merge(ljc, on="loja")
    lj["loja_id"] = lj.loja + 1
    lj["nome"] = [LOJAS[int(l)]["nome"] for l in lj.loja]
    lj["margem_bruta_pct"] = 100 * (lj.receita - lj.cmv) / lj.receita
    lj["perda_pct_receita"] = 100 * lj.perda_custo / lj.receita
    lj["margem_real_pct"] = 100 * (lj.receita - lj.cmv - lj.perda_custo) / lj.receita
    lj["taxa_ruptura_pct"] = 100 * lj.rup / lj.dias_sku
    lj["ticket_medio"] = lj.receita / lj.cupons
    lj["venda_perdida_pct_receita"] = 100 * lj.venda_perdida / lj.receita
    lojas_out = lj[["loja_id", "nome", "receita", "margem_bruta_pct", "perda_pct_receita", "margem_real_pct",
                    "taxa_ruptura_pct", "venda_perdida", "venda_perdida_pct_receita", "cupons", "ticket_medio"]]

    # ---------------- KPIs mensais ----------------
    km = df.groupby("mes").agg(receita=("rec", "sum"), cmv=("cmv", "sum"), perda_custo=("perda_c", "sum"),
                                venda_perdida=("vperd", "sum")).reset_index()
    kmo = dfo.groupby("mes").agg(dias_sku=("rupt", "size"), rup=("rupt", "sum")).reset_index()
    dl["mes"] = [datas[int(t)].strftime("%Y-%m") for t in dl.t]
    kmc = dl.groupby("mes").agg(cupons=("cupons", "sum")).reset_index()
    km = km.merge(kmo, on="mes").merge(kmc, on="mes")
    km["margem_bruta_pct"] = 100 * (km.receita - km.cmv) / km.receita
    km["perda_pct_receita"] = 100 * km.perda_custo / km.receita
    km["margem_real_pct"] = 100 * (km.receita - km.cmv - km.perda_custo) / km.receita
    km["taxa_ruptura_pct"] = 100 * km.rup / km.dias_sku
    km["ticket_medio"] = km.receita / km.cupons
    kpis_mensais = km[["mes", "receita", "margem_bruta_pct", "perda_pct_receita", "margem_real_pct",
                       "taxa_ruptura_pct", "venda_perdida", "cupons", "ticket_medio"]]

    rec_tot, cmv_tot, perda_tot, vp_tot = df.rec.sum(), df.cmv.sum(), df.perda_c.sum(), df.vperd.sum()
    cupons_tot = int(dl.cupons.sum())
    n_a = int((sk.classe == "A").sum())
    resumo = dict(
        receita=round(float(rec_tot), 2),
        margem_bruta_pct=pct(rec_tot - cmv_tot, rec_tot),
        perda_custo=round(float(perda_tot), 2),
        perda_pct_receita=pct(perda_tot, rec_tot),
        margem_real_pct=pct(rec_tot - cmv_tot - perda_tot, rec_tot),
        taxa_ruptura_pct=pct(dfo.rupt.sum(), len(dfo)),
        taxa_ruptura_A_pct=pct(dfo[dfo.classe == "A"].rupt.sum(), (dfo.classe == "A").sum()),
        venda_perdida=round(float(vp_tot), 2),
        venda_perdida_pct_receita=pct(vp_tot, rec_tot),
        cupons=cupons_tot,
        ticket_medio=round(float(rec_tot / cupons_tot), 2),
        n_skus=int(n), n_skus_classe_A=n_a,
        pct_skus_classe_A=pct(n_a, n),
    )

    # ---------------- horario e caixas ----------------
    prof_sem = {7: 2, 8: 3.5, 9: 4.5, 10: 5, 11: 6, 12: 7.5, 13: 6.5, 14: 4.5, 15: 4.5, 16: 5.5,
                17: 8, 18: 10, 19: 8, 20: 5, 21: 2.5}
    prof_sab = {7: 1.5, 8: 3, 9: 6, 10: 9, 11: 10, 12: 9, 13: 7, 14: 5, 15: 5, 16: 6, 17: 7,
                18: 6, 19: 4, 20: 2.5, 21: 1}
    prof_dom = {8: 2, 9: 4, 10: 7, 11: 9, 12: 9, 13: 8, 14: 6, 15: 6, 16: 6, 17: 5, 18: 4, 19: 2}
    dl["dow"] = [datas[int(t)].weekday() for t in dl.t]
    tk_dow = dl[dl.cupons > 0].groupby(["loja", "dow"]).cupons.mean()
    CAP, UTIL = 18.0, 0.85
    linhas_h = []
    for l in range(nl):
        N_cx = LOJAS[l]["caixas"]
        for dw in range(7):
            prof = prof_sem if dw < 5 else (prof_sab if dw == 5 else prof_dom)
            tot = sum(prof.values())
            for h, w in prof.items():
                cup_h = tk_dow[(l, dw)] * w / tot
                nec = max(1, math.ceil(cup_h / (CAP * UTIL)))
                if dw < 5:
                    f = 0.5 if (h < 9 or h >= 20) else 0.7 if (9 <= h < 11 or 14 <= h < 16) else 0.85 if h < 14 or h < 17 else 1.0
                elif dw == 5:
                    f = 0.8 if 8 <= h < 20 else 0.5
                else:
                    f = 0.7
                esc = max(2, int(math.floor(N_cx * f + 0.5)))
                linhas_h.append(dict(loja_id=l + 1, dow=dw, dia=DIAS[dw], hora=h,
                                     cupons_medios=round(float(cup_h), 1),
                                     caixas_necessarios=nec, caixas_escalados=esc, gap=nec - esc))
    horario = linhas_h

    # ---------------- alertas (snapshot do ultimo dia) ----------------
    rng_a = np.random.default_rng(SEED + 800)
    est_final = stock_end[-1]
    m_final = m_hist[-1]
    sku_cls = np.array([classe_sku[s] for s in range(n)])
    eventos = []
    for j in range(N):
        s, l = int(sku_idx[j]), int(loja_idx[j])
        p = produtos[s]
        spec = CATEGORIAS[p["categoria"]]
        cob = float(est_final[j] / max(m_final[j], 0.05))
        cls = sku_cls[s]
        preco_hoje = p["preco"] * infl[-1]
        custo_hoje = p["custo"] * infl[-1]
        dias_venc = int(rng_a.integers(1, spec["vida"] + 1)) if p["perecivel_item"] else None
        base_ev = dict(loja_id=l + 1, sku_id=p["sku_id"], produto=p["nome"], categoria=p["categoria"],
                       classe=cls, estoque=int(est_final[j]), cobertura_dias=round(cob, 1),
                       venda_diaria_media=round(float(m_final[j]), 1))
        if cls == "A" and cob < 1.0:
            eventos.append(dict(base_ev, regra="R1", regra_nome="Ruptura iminente (classe A)",
                                severidade="alta",
                                impacto_rs=round(float(m_final[j] * preco_hoje * (1 - SUBSTITUICAO)), 2),
                                acao="Pedido de emergência / transferir entre lojas"))
        elif cls in ("A", "B") and cob < 1.5:
            eventos.append(dict(base_ev, regra="R2", regra_nome="Cobertura baixa (A/B)",
                                severidade="media",
                                impacto_rs=round(float(m_final[j] * preco_hoje * (1 - SUBSTITUICAO)), 2),
                                acao="Antecipar próximo pedido"))
        if (p["perecivel_item"] and spec["alerta_venc"] > 0 and dias_venc is not None
                and dias_venc <= spec["alerta_venc"] and est_final[j] > 0):
            risco = float(est_final[j] * custo_hoje)
            eventos.append(dict(base_ev, regra="R3", regra_nome="Vencimento próximo",
                                severidade="alta" if risco >= 300 else "media",
                                dias_para_vencer=dias_venc, impacto_rs=round(risco, 2),
                                acao="Remarcar -30% hoje e levar para ponta de gôndola"))
        expo_d = EXPO[p["categoria"]]
        if (not p["perecivel_item"]) and cls == "C" and cob + expo_d > 30:
            base_ev = dict(base_ev, cobertura_dias=round(cob + expo_d, 1))
            eventos.append(dict(base_ev, regra="R4", regra_nome="Excesso de estoque (C)",
                                severidade="baixa",
                                impacto_rs=round(float((est_final[j] + expo_d * m_final[j]) * custo_hoje), 2),
                                acao="Suspender pedido até cobertura < 20 dias"))
    ev = pd.DataFrame(eventos)
    sev_ord = {"alta": 0, "media": 1, "baixa": 2}
    ev["_s"] = ev.severidade.map(sev_ord)
    ev = ev.sort_values(["_s", "impacto_rs"], ascending=[True, False]).drop(columns="_s")
    contagem = (ev.groupby(["loja_id", "regra"]).size().reset_index(name="n"))
    top_ev = pd.concat([g.head(12) for _, g in ev.groupby("regra")]).copy()
    top_ev["_s"] = top_ev.severidade.map(sev_ord)
    top_ev = top_ev.sort_values(["_s", "impacto_rs"], ascending=[True, False]).drop(columns="_s")
    top_ev["dias_para_vencer"] = top_ev["dias_para_vencer"].astype("Int64")

    def msg_loja(l):
        nome = LOJAS[l]["nome"]
        e = ev[ev.loja_id == l + 1]
        linhas = [f"*{nome} — Alertas do dia 01/10 07:30*", ""]
        for rid, titulo in (("R1", "🔴 Ruptura iminente (A)"), ("R3", "🟠 Vencimento próximo"),
                            ("R2", "🟡 Cobertura baixa"), ("R4", "⚪ Excesso de estoque")):
            sub = e[e.regra == rid].head(3)
            tot = int((e.regra == rid).sum())
            if tot == 0:
                continue
            linhas.append(f"*{titulo}* ({tot} itens)")
            for _, r in sub.iterrows():
                if rid == "R3":
                    linhas.append(f"• {r.produto}: {int(r.estoque)} un, vence em {int(r.dias_para_vencer)} d → remarcar -30%")
                elif rid == "R4":
                    linhas.append(f"• {r.produto}: {r.cobertura_dias:.0f} dias de estoque (R$ {r.impacto_rs:,.0f} parados)")
                else:
                    linhas.append(f"• {r.produto}: {int(r.estoque)} un ({r.cobertura_dias:.1f} d de cobertura)")
            linhas.append("")
        linhas.append("Responda *OK* para confirmar ciência.")
        return "\n".join(linhas)

    regras = [
        dict(id="R1", nome="Ruptura iminente (classe A)", severidade="alta",
             condicao="SKU classe A com cobertura < 1 dia (estoque / venda diária média)",
             acao="Pedido de emergência ou transferência entre lojas", destino="Comprador + gerente da loja",
             horario="Diário 07:30"),
        dict(id="R2", nome="Cobertura baixa (A/B)", severidade="media",
             condicao="SKU classe A ou B com cobertura entre 1 e 1,5 dia",
             acao="Antecipar próximo pedido", destino="Comprador", horario="Diário 07:30"),
        dict(id="R3", nome="Vencimento próximo", severidade="alta/media",
             condicao="Perecível (FLV ≤ 3 d, Açougue ≤ 2 d, Frios ≤ 7 d) com estoque > 0; alta se custo em risco ≥ R$ 300",
             acao="Remarcar -30% e ponta de gôndola", destino="Gerente da loja", horario="Diário 07:30"),
        dict(id="R4", nome="Excesso de estoque (C)", severidade="baixa",
             condicao="Não perecível classe C com cobertura > 30 dias",
             acao="Suspender pedido", destino="Comprador", horario="Semanal (segunda 07:30)"),
    ]
    alertas = dict(
        status="Especificação das regras + simulação sobre o estoque de 30/09/2026. Automação (n8n / Supabase) ainda não conectada.",
        regras=regras,
        contagem_por_loja_regra=registros(contagem, 0),
        total_eventos=int(len(ev)),
        eventos_destaque=registros(top_ev, 2),
        mensagens_exemplo={LOJAS[l]["nome"]: msg_loja(l) for l in range(nl)},
    )

    # ---------------- cesta ----------------
    cesta, missoes_part = gerar_cestas(produtos, datas)

    # ---------------- produtos + meta ----------------
    prod_out = pd.DataFrame(produtos)[["sku_id", "codigo", "nome", "base_item", "categoria", "marca", "preco", "margem"]]
    prod_out["margem"] = (prod_out.margem * 100).round(1)
    prod_out = prod_out.rename(columns={"margem": "margem_pct_lista"})
    meta = dict(
        marca="Mercado Aurora",
        aviso="Dados 100% sintéticos. Marcas, lojas e valores são fictícios.",
        periodo=dict(inicio=INICIO.isoformat(), fim=FIM.isoformat(), dias=T,
                     semanas_completas=int(((pd.Timestamp(sem_fim) - pd.Timestamp(sem_ini)).days // 7) + 1)),
        lojas=[dict(id=l["id"], nome=l["nome"]) for l in LOJAS],
        categorias=cats,
        resumo=resumo,
        definicoes=dict(
            receita="Unidades vendidas x preço (preço com deriva de 0,4% ao mês).",
            margem_bruta="(Receita - CMV) / Receita.",
            perda="Quebra (vencimento, avaria, furto, operacional) valorizada a custo.",
            margem_real="(Receita - CMV - Perda a custo) / Receita.",
            taxa_ruptura="SKU-loja-dias com demanda não atendida / SKU-loja-dias em dias de loja aberta.",
            venda_perdida=f"Unidades não atendidas x preço x (1 - {SUBSTITUICAO:.2f}); {int(SUBSTITUICAO*100)}% assumido como substituição por outro item.",
            classe_abc="Curva ABC por receita anual: A até 80% acumulado, B até 95%, C o restante.",
            cobertura_dias="Estoque / venda diária média (média móvel exponencial). Nas métricas de giro e de excesso, o estoque inclui o mínimo de exposição na gôndola.",
            lift="Suporte(A,B) / (suporte(A) x suporte(B)). > 1 indica afinidade.",
        ),
        cestas_missoes_pct=missoes_part,
    )

    # ---------------- gravar ----------------
    tamanhos = {}
    arquivos = {
        "meta.json": meta,
        "produtos.json": registros(prod_out, 2),
        "kpis_mensais.json": registros(kpis_mensais, 2),
        "categorias.json": registros(categorias, 2),
        "lojas.json": registros(lojas_out, 2),
        "loja_categoria.json": registros(loja_categoria, 2),
        "curva_abc.json": registros(curva_abc, 2),
        "vendas_diarias_loja.json": registros(vendas_diarias, 2),
        "vendas_semanais_categoria_loja.json": registros(vendas_semanais, 2),
        "ruptura_semanal.json": registros(ruptura_semanal, 2),
        "ruptura_dia_semana.json": registros(ruptura_dow, 2),
        "ruptura_skus.json": registros(ruptura_skus, 2),
        "perdas_mensal_categoria.json": registros(perdas_mensal, 2),
        "perdas_motivos.json": registros(perdas_motivos, 1),
        "cesta.json": cesta,
        "horario_caixas.json": horario,
        "alertas.json": alertas,
    }
    for nome, obj in arquivos.items():
        tamanhos[nome] = gravar(pasta, nome, obj)

    # ---------------- validacao (nao vai para o front) ----------------
    prob_ids = [produtos[s]["sku_id"] for s in P["problema"]]
    vp_prob = rsku[rsku.sku_id.isin(prob_ids)].venda_perdida.sum()
    top15_share = float(rsku.head(15).pct_do_total.sum())
    fds = dfo[dfo.loja == IDX_VILA]
    taxa_vila_fds = 100 * fds[fds.dow >= 5].rupt.mean()
    taxa_vila_sem = 100 * fds[fds.dow < 5].rupt.mean()
    outras = dfo[dfo.loja != IDX_VILA]
    taxa_out_fds = 100 * outras[outras.dow >= 5].rupt.mean()
    taxa_out_sem = 100 * outras[outras.dow < 5].rupt.mean()
    flv = loja_categoria[loja_categoria.categoria == "Hortifruti"].set_index("loja_id")
    mensal_rup = kpis_mensais.set_index("mes").taxa_ruptura_pct
    validacao = dict(
        resumo=resumo,
        receita_media_dia_por_loja={LOJAS[int(r.loja)]["nome"]: round(float(r.receita / T), 0) for _, r in lj.iterrows()},
        pareto=dict(n_A=n_a, n_B=int((sk.classe == "B").sum()), n_C=int((sk.classe == "C").sum()),
                    pct_skus_A=pct(n_a, n)),
        ruptura=dict(
            problema_skus=prob_ids,
            share_venda_perdida_dos_14_problema_pct=round(100 * float(vp_prob / tot_vp), 1),
            share_venda_perdida_top15_skus_pct=round(top15_share, 1),
            vila_nova_fds_pct=round(taxa_vila_fds, 2), vila_nova_semana_pct=round(taxa_vila_sem, 2),
            outras_fds_pct=round(taxa_out_fds, 2), outras_semana_pct=round(taxa_out_sem, 2),
            mensal=mensal_rup.round(2).to_dict(),
        ),
        perdas=dict(
            por_categoria={r.categoria: round(float(r.perda_pct_receita), 2) for _, r in categorias.iterrows()},
            flv_perda_pct_receita_por_loja={LOJAS[i - 1]["nome"]: round(float(flv.loc[i, "perda_pct_receita"]), 2) for i in flv.index},
            p_scale={c: round(float(p_scale[i]), 3) for i, c in enumerate(cats)},
        ),
        margem_por_categoria={r.categoria: dict(bruta=round(float(r.margem_bruta_pct), 1),
                                                 real=round(float(r.margem_real_pct), 1))
                              for _, r in categorias.iterrows()},
        top_ruptura=[dict(nome=r.nome, classe=r.classe, vp=round(float(r.venda_perdida), 0),
                          pct=round(float(r.pct_do_total), 1)) for _, r in rsku.head(10).iterrows()],
        horario_gaps=[dict(loja=g.loja_id, dia=g.dia, hora=g.hora, gap=g.gap)
                      for g in map(lambda d: pd.Series(d), horario) if g.gap >= 1][:12],
        alertas=dict(total=int(len(ev)), por_regra=ev.groupby("regra").size().to_dict()),
        cesta_top_lift=[(r["item_a"], r["item_b"], r["lift"], r["suporte_pct"]) for r in cesta["pares_maior_lift"][:8]],
        arquivos_kb={k: round(v / 1024, 1) for k, v in tamanhos.items()},
        total_kb=round(sum(tamanhos.values()) / 1024, 1),
    )
    with open(pasta.parent.parent / "_validacao.json", "w", encoding="utf-8") as f:
        json.dump(validacao, f, ensure_ascii=False, indent=2, default=str)
    print(json.dumps(validacao, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
