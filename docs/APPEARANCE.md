# Aparência em Camadas — v0.4+

O sistema de aparência em camadas permite personalizar a superfície, os cantos, os espaçamentos, as bordas e as sombras do painel online e de cada widget individualmente, preservando total compatibilidade com configurações anteriores.

## Natureza opcional e compatibilidade

- Todas as propriedades de aparência estrutural são **opcionais**.
- Painéis existentes sem `preset` ou sem sobrescritas individuais continuam exatamente com o visual original do SmartFrame (`default`), mantendo seus cantos arredondados responsivos, sombras padrão, espaçamentos originais e cores do tema.

## Matriz de configurações e escopos

| Configuração                                    | Faixa / Valores                                      | Escopo Global (Painel) | Escopo Página _(planejado Fase 3)_ | Escopo Widget                   |
| :---------------------------------------------- | :--------------------------------------------------- | :--------------------- | :--------------------------------- | :------------------------------ |
| **Preset (`preset`)**                           | `default`, `cards`, `flat`, `borderless`, `seamless` | Sim                    | Sim                                | Sim                             |
| **Raio dos cantos (`cornerRadius`)**            | `0–32` px                                            | Sim                    | Sim                                | Sim                             |
| **Espaçamento entre widgets (`widgetSpacing`)** | `0–24` px                                            | Sim                    | Sim                                | _Ignorado_                      |
| **Espaçamento interno (`innerPadding`)**        | `0–24` px                                            | Sim                    | Sim                                | Sim _(não aplicado a `photos`)_ |
| **Margem da borda (`pageEdgePadding`)**         | `0–32` px                                            | Sim                    | Sim                                | _Ignorado_                      |
| **Borda (`border`)**                            | `null` (herdar), `true`, `false`                     | Sim                    | Sim                                | Sim                             |
| **Sombra (`shadow`)**                           | `null` (herdar), `true`, `false`                     | Sim                    | Sim                                | Sim                             |

> [!NOTE]
> `widgetSpacing` e `pageEdgePadding` pertencem ao layout do painel/página. Caso sejam enviados dentro do objeto `appearance` de um widget, os contratos (`@smartframe/contracts`) e o player (`smartframe-player`) descartam esses campos automaticamente.

## Presets disponíveis

| Preset       | Descrição                                                                | Raio (`cornerRadius`) | Espaço entre widgets (`widgetSpacing`) | Padding interno (`innerPadding`) | Margem da borda (`pageEdgePadding`) | Borda (`border`) | Sombra (`shadow`) |
| :----------- | :----------------------------------------------------------------------- | :-------------------- | :------------------------------------- | :------------------------------- | :---------------------------------- | :--------------- | :---------------- |
| `default`    | Original do SmartFrame                                                   | Padrão CSS            | Padrão CSS                             | Padrão CSS                       | Padrão CSS                          | Padrão CSS       | Padrão CSS        |
| `cards`      | Cartões arredondados                                                     | `18` px               | `12` px                                | `12` px                          | `12` px                             | `true`           | `false`           |
| `flat`       | Superfícies planas (remove blur decorativo de fundo nas fotos e sombras) | `12` px               | `12` px                                | `12` px                          | `12` px                             | `false`          | `false`           |
| `borderless` | Somente conteúdo (fundo transparente sem cor customizada)                | `0` px                | `12` px                                | `12` px                          | `12` px                             | `false`          | `false`           |
| `seamless`   | Painel contínuo sem lacunas                                              | `0` px                | `0` px                                 | `12` px                          | `0` px                              | `true`           | `false`           |

## Regras de herança e precedência

1. **Valores explícitos vs. herdados**:
   - `0` e `false` são **escolhas explícitas** e sempre prevalecem sobre o preset ou valor herdado do painel.
   - Campos omitidos ou definidos como `null` herdam o valor do preset (no escopo do painel) ou do painel (no escopo do widget).
2. **Troca de preset**:
   - Selecionar um preset no painel substitui as sobrescritas globais anteriores desse escopo, mantendo as cores (`backgroundColor`, `accentColor`, `textColor`). Ajustes individuais feitos depois sobrepõem o preset.
   - Selecionar um preset em um widget individual aplica os padrões daquele preset apenas naquele widget (inclusive permitindo restaurar `default` em um único cartão sob um painel `flat` ou `seamless`).
3. **Controles independentes**:
   - No modo `flat`, o raio dos cantos e o espaçamento continuam ajustáveis de forma independente (uma superfície plana pode ter cantos arredondados ou retos).
   - No modo `borderless`, caso o widget possua uma cor de fundo explícita (`backgroundColor`), o fundo escolhido pelo usuário é preservado; sem cor customizada, a superfície fica transparente sobre o fundo do painel.
4. **Limites e segurança**:
   - Os valores numéricos são validados como inteiros dentro das faixas permitidas pelo contrato Zod (`onlineDashboardSchema` e `widgetGridDashboardSchema`).
   - Strings de preset desconhecidas ou valores fora do intervalo são rejeitados na validação da API e ignorados pelo normalizador do player. Não há injeção livre de CSS.

## Uso no editor (`/layouts`)

1. Abra `/layouts`, selecione ou crie um painel e vá para a aba **Aparência**.
2. Em **Estilo e superfície do painel**, escolha um **Preset de aparência** ou ajuste individualmente raio dos cantos, espaçamento entre widgets, espaçamento interno, margem da borda, borda e sombra.
3. Clique em **Herdar do preset** em qualquer controle numérico para limpar apenas aquele ajuste, ou em **Restaurar aparência original do painel** para voltar ao estilo padrão.
4. Em **Fundo e tamanho dos widgets**, expanda **Aparência individual (sobrepor painel)** em qualquer um dos 10 widgets para personalizar apenas aquele cartão ou clicar em **Redefinir para aparência herdada**.
5. Confira o resultado na **Prévia do rascunho**, salve e publique para o dispositivo.

## Estrutura no contrato JSON

```json
{
  "appearance": {
    "backgroundColor": "#E8EEF5",
    "accentColor": "#2563EB",
    "textColor": "#172033",
    "preset": "cards",
    "cornerRadius": 18,
    "widgetSpacing": 12,
    "innerPadding": 12,
    "pageEdgePadding": 12,
    "border": true,
    "shadow": false
  },
  "widgets": {
    "clock": {
      "enabled": true,
      "backgroundColor": "",
      "cardSize": "normal",
      "appearance": {
        "preset": "flat",
        "cornerRadius": 24
      }
    }
  }
}
```
