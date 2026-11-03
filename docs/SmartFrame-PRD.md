# SmartFrame — Documento de Requisitos do Produto

**Versão:** 1.0  
**Data:** 30/10/2026  
**Status:** Base de produto e planejamento; implementação não iniciada por este documento.  
**Produto:** Porta-retratos digital inteligente com personalização remota.

## 1. Visão do produto

Transformar tablets Android antigos em porta-retratos digitais com fotos, relógio, calendário, previsão do tempo e layouts configuráveis remotamente por um painel web responsivo.

A experiência principal é a exibição de fotos. O tablet deve permanecer simples, leve e funcional sem conexão. Processamento de imagens, administração e integrações ficam no servidor.

O PRITOM P7_A1 é o dispositivo de referência de desempenho, não uma dependência exclusiva do produto.

## 2. Problema e público-alvo

### Problema

Tablets antigos frequentemente deixam de ser utilizados, enquanto soluções de porta-retratos conectados podem depender de hardware específico, serviços pagos ou configurações locais pouco práticas.

### Público-alvo

- Pessoas que desejam reutilizar tablets Android em casa.
- Famílias que querem atualizar fotos de um dispositivo remotamente, inclusive pelo celular.
- Usuários que desejam administrar vários porta-retratos em uma única instalação.

### Proposta de valor

Um produto auto-hospedável, personalizável e offline-first, com administração remota e sem assinatura obrigatória.

## 3. Objetivos e princípios

1. Fotos em primeiro lugar, sem aparência de painel administrativo no tablet.
2. Personalização remota de conteúdo, layouts e comportamento.
3. Baixo consumo de memória e processamento no dispositivo.
4. Reprodução persistente sem rede, inclusive após reiniciar o aplicativo.
5. Uma conta capaz de administrar vários dispositivos.
6. Funcionamento local sem dependência obrigatória de serviços pagos.
7. Arquitetura compatível com outros tablets Android suportados.
8. Segurança por isolamento de contas, credenciais individuais e permissões mínimas.

## 4. Hardware e ambiente de referência

| Item                          | Referência              |
| ----------------------------- | ----------------------- |
| Tablet                        | PRITOM P7_A1            |
| Sistema operacional           | Android 11, 32 bits     |
| Tela                          | 7 polegadas, 1024 × 600 |
| RAM utilizável                | Aproximadamente 1,4 GB  |
| Processador                   | 4 × Cortex-A53          |
| Armazenamento livre informado | Aproximadamente 19 GB   |
| Android mínimo pretendido     | Android 8.0, API 26     |

As características informadas devem ser verificadas no equipamento real. A versão do Android System WebView, a ABI e o comportamento do fabricante com processos em segundo plano fazem parte da validação inicial.

## 5. Decisões de arquitetura

### 5.1 Arquitetura aprovada

```text
Painel web responsivo
Next.js + React + TypeScript
          |
          | HTTPS / API REST
          v
Servidor SmartFrame
Next.js Route Handlers + Prisma + SQLite
Storage local + Sharp + worker Node.js
          |
          | Manifesto JSON + mídias autorizadas
          v
Aplicativo Android
Kotlin + WebView + HTML/CSS/JavaScript leve
Cache persistente + sincronização + recuperação
```

| Camada                   | Escolha                                                     |
| ------------------------ | ----------------------------------------------------------- |
| Painel administrativo    | Next.js, React e TypeScript                                 |
| API REST                 | Route Handlers do Next.js, runtime Node.js                  |
| Persistência no servidor | SQLite com Prisma e migrations                              |
| Imagens                  | Sharp, com processamento fora das requisições web           |
| Trabalhos assíncronos    | Worker Node.js separado e fila persistida                   |
| Editor visual            | Biblioteca compatível com React, a selecionar por protótipo |
| Aplicativo Android       | Kotlin, minSdk 26                                           |
| Renderizador do player   | HTML/CSS/JavaScript local em WebView                        |
| Armazenamento de mídia   | Disco local do servidor, fora da pasta pública              |
| Sincronização            | REST, polling e revisão de manifesto                        |
| Implantação              | Docker Compose, Nginx e volumes persistentes                |

### 5.2 Substituições em relação à proposta inicial

- Next.js com TypeScript substitui Laravel/PHP e Vue.
- React é utilizado no painel administrativo, não React Native no Android.
- Sharp substitui a integração direta com Imagick/libvips.
- O aplicativo permanece em Kotlin com WebView; não será apenas um site remoto aberto no tablet.

### 5.3 Restrições técnicas

- Servidor com armazenamento persistente; não depender de exportação estática ou hospedagem com disco efêmero.
- Não exigir Redis no MVP. A estratégia da fila persistida será validada para o volume doméstico esperado.
- Processos web e worker devem coordenar acesso ao mesmo SQLite e aos mesmos arquivos.
- Não usar renderização React/Next.js dentro do player; o renderizador será independente e leve.
- Compartilhar contratos e, quando viável, o renderizador entre a prévia web e o player.
- Recursos do renderizador devem respeitar a versão mínima de WebView validada, não apenas a versão do Android.

## 6. Escopo de entrega

### 6.1 MVP — primeiro marco utilizável

- Instalação local com Docker Compose.
- Cadastro inicial controlado do administrador e autenticação.
- Painel responsivo utilizável no celular.
- Upload múltiplo de fotos e processamento de versões otimizadas.
- Biblioteca e álbuns básicos, com ordenação e exclusão.
- Cadastro de dispositivos por pareamento temporário.
- Credenciais individuais e revogáveis para cada tablet.
- Modo Foto com carrossel e relógio opcional.
- Configuração remota de intervalo, ordem, enquadramento e relógio.
- Publicação, manifesto versionado e sincronização automática.
- Cache persistente, aplicação segura de atualizações e recuperação da última versão funcional.
- Status básico do dispositivo e registro de último contato.

O MVP não depende do editor visual livre: configurações e um layout inicial são suficientes para comprovar o fluxo completo.

### 6.2 Versão 1.0 completa

Além do MVP:

- Modos Foto, Híbrido e Dashboard.
- Editor visual com widgets, camadas, grade, alinhamento e desfazer/refazer.
- Rascunhos, duplicação, prévia e publicação de layouts.
- Temas, transparência, fontes e fundos.
- Relógio, calendário, clima e blocos de fotos.
- Favoritos e organização ampliada da biblioteca.
- Eventos manuais e integração opcional com Google Calendar.
- Agendamento de layouts por horário e dia da semana.
- Agrupamento e administração de múltiplos dispositivos.
- Permissões administrativas e auditoria.
- Testes de estabilidade, segurança, recuperação e entrega do APK de release.

### 6.3 Fora do escopo da versão 1.0

- Aplicativo iOS ou cliente Android em React Native.
- Reprodução de vídeo e áudio, reconhecimento facial ou recursos de IA.
- Loja de widgets, plugins arbitrários e execução de código enviado pelo administrador.
- Sincronização obrigatória em tempo real por WebSocket.
- Serviço SaaS comercial, cobrança e administração de assinaturas.
- Kiosk inviolável, provisionamento corporativo e garantia de abertura automática no boot em qualquer fabricante.
- Alta disponibilidade com múltiplas réplicas gravando no mesmo banco SQLite.

## 7. Experiência do usuário

### 7.1 Modos de exibição

| Modo      | Comportamento                                                            |
| --------- | ------------------------------------------------------------------------ |
| Foto      | Imagem em tela cheia, com informações opcionais sobrepostas; modo padrão |
| Híbrido   | Foto em aproximadamente 75% da área, com widgets na região restante      |
| Dashboard | Distribuição livre de widgets e um ou mais blocos de fotos               |

Todos os modos devem admitir orientação horizontal e vertical, além de temas claro e escuro. O layout precisa definir sua orientação e área lógica de referência.

### 7.2 Fluxo inicial

1. Administrador instala o servidor e conclui a configuração inicial.
2. Instala o APK no tablet e informa ou configura o endereço do servidor.
3. O player solicita uma sessão de pareamento e mostra um código temporário.
4. Administrador autenticado informa o código no painel e nomeia o dispositivo.
5. O servidor vincula o dispositivo à conta e entrega sua credencial pelo fluxo de pareamento.
6. Administrador envia fotos, escolhe um álbum e publica a configuração inicial.
7. O tablet baixa o conteúdo, valida e inicia a reprodução.

### 7.3 Fluxo de edição e publicação

Editar → pré-visualizar → salvar rascunho → publicar → sincronizar → confirmar aplicação pelo dispositivo.

Salvar rascunho não altera a versão em reprodução. O painel deve distinguir publicação no servidor de aplicação confirmada no tablet.

## 8. Requisitos funcionais

Prioridades: **MVP** = obrigatório no primeiro marco; **V1** = obrigatório para completar a versão 1.0.

| ID    | Prioridade | Requisito                                                                                |
| ----- | ---------- | ---------------------------------------------------------------------------------------- |
| RF-01 | MVP        | Autenticar administradores e permitir encerramento seguro da sessão                      |
| RF-02 | MVP        | Permitir upload múltiplo com progresso e erros por arquivo                               |
| RF-03 | MVP        | Validar arquivos e gerar imagens otimizadas no servidor                                  |
| RF-04 | MVP        | Criar álbuns, associar fotos, ordenar e excluir conteúdo                                 |
| RF-05 | MVP        | Parear tablet por código temporário, de uso único e com tentativas limitadas             |
| RF-06 | MVP        | Listar, renomear e desvincular dispositivos com revogação de credenciais                 |
| RF-07 | MVP        | Configurar carrossel sequencial ou aleatório, intervalo, transição e enquadramento       |
| RF-08 | MVP        | Exibir relógio digital opcional, com formato de 12 ou 24 horas                           |
| RF-09 | MVP        | Publicar configuração identificada por revisão e disponibilizar manifesto ao dispositivo |
| RF-10 | MVP        | Consultar atualizações normalmente a cada 30 segundos, enquanto o player estiver ativo   |
| RF-11 | MVP        | Baixar apenas arquivos ausentes ou alterados e verificar integridade                     |
| RF-12 | MVP        | Reproduzir a última configuração funcional sem conexão e após reabrir o aplicativo       |
| RF-13 | MVP        | Informar revisão aplicada, último contato e falhas de sincronização                      |
| RF-14 | MVP        | Operar em tela cheia e manter a tela ligada durante a reprodução                         |
| RF-15 | V1         | Marcar favoritos e usar filtros na biblioteca de fotos                                   |
| RF-16 | V1         | Criar, duplicar, editar, pré-visualizar e publicar layouts                               |
| RF-17 | V1         | Adicionar, mover, redimensionar, sobrepor e remover widgets                              |
| RF-18 | V1         | Oferecer grade opcional, alinhamento e desfazer/refazer no editor                        |
| RF-19 | V1         | Configurar cores, fontes, fundos e transparência                                         |
| RF-20 | V1         | Exibir calendário mensal ou semanal e eventos manuais                                    |
| RF-21 | V1         | Consultar eventos do Google Calendar por integração autorizada no servidor               |
| RF-22 | V1         | Exibir cidade, temperatura, previsão e horário da última atualização do clima            |
| RF-23 | V1         | Agendar layouts por horário e dias da semana, respeitando o fuso do dispositivo          |
| RF-24 | V1         | Agrupar dispositivos e atribuir conteúdo a múltiplos tablets autorizados                 |
| RF-25 | V1         | Aplicar permissões administrativas e registrar ações relevantes em auditoria             |

### 8.1 Fotos e processamento

- Aceitar inicialmente JPEG, PNG e WebP; outros formatos dependem de validação posterior.
- Validar tamanho, conteúdo decodificável e dimensões máximas; não confiar apenas na extensão ou no MIME declarado pelo cliente.
- Corrigir orientação e produzir derivados adequados à tela e à orientação do destino.
- Remover metadados sensíveis dos derivados, incluindo localização quando presente.
- Informar estados de processamento: recebido, processando, pronto e erro.
- Não publicar referências a derivados ainda indisponíveis.
- Definir na etapa de implementação os limites de upload, dimensões máximas e política de retenção dos originais.

### 8.2 Editor visual

- Área lógica inicial de 1024 × 600 em paisagem e 600 × 1024 em retrato.
- Prévia proporcional à resolução do dispositivo selecionado.
- Widgets com identificador, tipo, versão de esquema, posição, tamanho, camada e propriedades validadas.
- Coordenadas e dimensões independentes do zoom aplicado ao editor.
- Salvamento de rascunhos sem modificar versões publicadas.
- Histórico de desfazer/refazer durante a sessão de edição.
- Compatibilidade com toque; os fluxos básicos de upload e configuração devem funcionar no celular.
- A extensão dos controles avançados do editor em telas pequenas deve ser validada por protótipo.

### 8.3 Calendário e clima

- Integrações externas executadas no servidor, nunca diretamente com segredos no tablet.
- Google Calendar com acesso de leitura e menor escopo necessário.
- Falhas de integração não podem bloquear fotos e relógio.
- Dados em cache devem identificar sua última atualização; dados expirados não devem aparentar estar atualizados.
- Provedor de clima a selecionar considerando licença, limites e disponibilidade de plano gratuito. Ausência de assinatura obrigatória não implica disponibilidade ilimitada de APIs externas.

### 8.4 Agendamentos

- Dispositivo mantém um layout padrão para horários sem regra aplicável.
- Conflitos devem ser rejeitados ou resolvidos por uma prioridade explícita, nunca implicitamente.
- Regras publicadas e versões necessárias devem ser persistidas no dispositivo para execução offline.
- Fuso horário e horário de verão devem ser considerados.
- A política exata de prioridade será definida antes da implementação do módulo.

## 9. Sincronização e operação offline

### 9.1 Manifesto

O contrato do manifesto deve incluir, no mínimo:

- Versão do esquema e revisão efetiva do conteúdo destinado ao dispositivo.
- Identificação do dispositivo, geração do manifesto e fuso horário.
- Layout, dimensões lógicas, tema, widgets e propriedades.
- Configuração do carrossel e referências ordenadas às mídias.
- Identificador, tamanho, hash e referência de download de cada arquivo necessário.
- Configuração de sincronização, cache e agendamentos quando aplicável.
- Dados ou referências de snapshots de integrações, sem credenciais externas.

Alterações relevantes em layouts, seleção de fotos, atribuições, agendamentos ou dados externos devem gerar uma revisão efetiva nova ou um mecanismo versionado equivalente. Mudanças no álbum não podem ficar invisíveis por manter a revisão do layout.

### 9.2 Atualização segura

1. Consultar a revisão disponível usando a credencial do dispositivo.
2. Comparar com a revisão aplicada e validar a compatibilidade do esquema.
3. Baixar arquivos novos para uma área temporária, sem interromper a reprodução atual.
4. Verificar tamanhos, hashes, espaço disponível e completude.
5. Persistir a nova configuração e ativá-la de forma atômica.
6. Manter a última versão funcional para recuperação.
7. Informar ao servidor a revisão aplicada ou a falha encontrada.

Downloads interrompidos e falhas de energia não podem corromper a versão ativa. Repetir uma sincronização deve ser seguro.

### 9.3 Cache e falhas

- Limite inicial de 2 GB por dispositivo, configurável.
- A contabilização deve considerar conteúdo ativo, recuperação e arquivos temporários.
- Não remover arquivos necessários à versão ativa, à recuperação protegida ou aos agendamentos offline configurados.
- Remover primeiro temporários abandonados e arquivos sem referência.
- Se não houver espaço para uma atualização segura, manter a versão atual e reportar o erro; não ultrapassar silenciosamente o limite.
- Sem conexão, manter a reprodução e aplicar retentativas com espera progressiva; o polling de 30 segundos é o comportamento normal com conectividade.
- Na primeira abertura sem conteúdo local, apresentar uma tela de configuração ou espera, sem falha ou tela permanentemente vazia.

## 10. Requisitos não funcionais

| ID     | Requisito e forma de avaliação                                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| RNF-01 | Reproduzir álbum com pelo menos 100 fotos otimizadas sem carregar todas simultaneamente na memória                                                  |
| RNF-02 | Carregar somente a imagem atual e uma pequena janela de preparação, ajustada por medição no tablet                                                  |
| RNF-03 | Com conexão estável, aplicar normalmente uma alteração em até 60 segundos quando as mídias já estiverem locais ou o download couber nesse intervalo |
| RNF-04 | Informar progresso para publicações grandes; polling de 30 segundos não garante download ilimitado em 60 segundos                                   |
| RNF-05 | Continuar reproduzindo conteúdo persistido durante indisponibilidade da rede e após reabrir o aplicativo                                            |
| RNF-06 | Completar teste contínuo de 72 horas no PRITOM P7 sem falhas críticas nem crescimento descontrolado de memória                                      |
| RNF-07 | Não executar processamento pesado de imagens no tablet nem no ciclo de requisições da API                                                           |
| RNF-08 | Painel responsivo com fluxos essenciais utilizáveis em navegadores móveis atuais                                                                    |
| RNF-09 | Não exigir pagamento recorrente para fotos, administração local e reprodução offline                                                                |
| RNF-10 | Registrar erros operacionais sem expor tokens, senhas, códigos válidos ou credenciais de integrações                                                |
| RNF-11 | Oferecer backup e restauração documentados do banco e das mídias, com consistência entre ambos                                                      |

Metas numéricas de memória, tempo de inicialização e orçamento de animações serão estabelecidas após o protótipo no hardware real, antes da aprovação do player para produção.

## 11. Segurança e privacidade

- HTTPS obrigatório para acesso pela internet; implantação local deve prever certificado confiável. Eventual HTTP de desenvolvimento não pode ser liberado globalmente no APK de produção.
- Administradores autenticados por sessões com cookies HttpOnly, Secure em HTTPS e proteção contra CSRF nas operações aplicáveis.
- Senhas armazenadas com hash apropriado e biblioteca de autenticação mantida.
- Cadastro inicial protegido; não disponibilizar registro administrativo público por padrão.
- Autorização por propriedade da conta em todas as consultas, alterações e downloads.
- Tokens individuais dos dispositivos, revogáveis, restritos à reprodução e armazenados no servidor de forma não recuperável quando tecnicamente aplicável.
- Credenciais do player protegidas pela camada nativa e não expostas ao JavaScript de renderização.
- Pareamento com expiração, uso único, limitação de tentativas e uma prova independente para a sessão do tablet; conhecer o código curto não deve permitir roubar o token emitido.
- Arquivos privados fora do diretório público; downloads autorizados sem exposição de caminhos internos.
- WebView limitada aos recursos locais autorizados, sem navegação arbitrária ou ponte JavaScript genérica.
- Conteúdo textual e propriedades de widgets validados; não aceitar HTML ou JavaScript arbitrário em layouts.
- Segredos de Google Calendar e outras integrações somente no servidor, protegidos e excluídos dos logs.
- SQLite, storage e worker não expostos diretamente à internet.
- Revogação bloqueia novas sincronizações; exclusão remota de fotos já baixadas não é garantida enquanto o dispositivo estiver offline.

Permissões propostas para V1: proprietário da conta e colaborador com privilégios limitados. A matriz final de ações deve ser aprovada antes de implementar o compartilhamento administrativo.

## 12. Modelo de domínio

Este modelo é conceitual. Tipos, índices, restrições e migrations serão definidos durante o desenho técnico.

| Entidade                  | Responsabilidade                                                                |
| ------------------------- | ------------------------------------------------------------------------------- |
| users                     | Identidades administrativas                                                     |
| accounts / memberships    | Propriedade, participação e permissões, conforme modelo de colaboração aprovado |
| devices                   | Tablets, vínculo de conta, configuração e credenciais                           |
| pairing_codes             | Sessões temporárias e autorização de pareamento                                 |
| media / media_variants    | Fotos originais, derivados e processamento                                      |
| albums / album_media      | Coleções, associação e ordenação                                                |
| layouts / layout_versions | Identidade do layout, rascunhos e versões publicadas                            |
| widgets                   | Instâncias e propriedades vinculadas a uma versão de layout                     |
| device_assignments        | Atribuições de conteúdo aos dispositivos                                        |
| device_groups             | Agrupamento de tablets                                                          |
| schedules                 | Regras de ativação de layouts                                                   |
| device_syncs              | Revisões, último contato e falhas de sincronização                              |
| calendar_events           | Eventos manuais                                                                 |
| integrations              | Autorizações externas e estado de atualização                                   |
| jobs                      | Trabalho assíncrono persistido e tentativas                                     |
| audit_logs                | Ações administrativas relevantes                                                |

Propriedades dos widgets serão representadas em JSON com validação por tipo e versão de esquema. Versões publicadas devem permanecer imutáveis; uma alteração gera nova versão.

## 13. Superfície inicial da API

As rotas abaixo representam o contrato funcional inicial, não uma especificação OpenAPI completa. Sessões administrativas e credenciais do player usam mecanismos separados.

| Método     | Endpoint                     | Finalidade                                              |
| ---------- | ---------------------------- | ------------------------------------------------------- |
| POST       | /api/auth/login              | Autenticar administrador                                |
| POST       | /api/auth/logout             | Encerrar sessão                                         |
| GET        | /api/devices                 | Listar dispositivos autorizados                         |
| POST       | /api/devices/pair            | Autorizar código pelo administrador                     |
| PATCH      | /api/devices/{id}            | Alterar nome e configurações                            |
| DELETE     | /api/devices/{id}            | Desvincular e revogar credencial                        |
| GET / POST | /api/albums                  | Listar e criar álbuns                                   |
| GET / POST | /api/media                   | Listar e enviar fotos                                   |
| DELETE     | /api/media/{id}              | Excluir mídia autorizada                                |
| GET / POST | /api/layouts                 | Listar e criar layouts                                  |
| PUT        | /api/layouts/{id}            | Salvar rascunho                                         |
| POST       | /api/layouts/{id}/publish    | Publicar nova versão                                    |
| PUT        | /api/devices/{id}/assignment | Atribuir layout ao dispositivo                          |
| POST       | /api/player/pairing          | Iniciar sessão de pareamento no tablet                  |
| GET        | /api/player/pairing/status   | Consultar autorização com prova da sessão de pareamento |
| GET        | /api/player/manifest         | Consultar manifesto autorizado                          |
| POST       | /api/player/heartbeat        | Informar estado e revisão aplicada                      |
| GET        | /api/player/media/{id}       | Baixar mídia autorizada                                 |

Endpoints adicionais de ordenação, favoritos, widgets, grupos, agendamentos e integrações serão detalhados junto a seus módulos. O contrato final deve prever validação, paginação, erros consistentes, limites e respostas de conteúdo não modificado.

## 14. Observabilidade e operação

- Painel apresenta último contato, revisão publicada, revisão aplicada e erro mais recente.
- O estado offline é inferido por ausência de contato e não confundido com confirmação de que o aplicativo está encerrado.
- Worker registra tentativas, sucesso e falha dos processamentos.
- Downloads e sincronizações têm identificadores de correlação quando necessário para diagnóstico.
- Logs têm política de retenção; auditoria deve cobrir login relevante, pareamento, revogação, publicação, exclusão e alteração de permissões.
- Backup inclui SQLite consistente, mídias e material necessário à restauração das integrações protegidas.

## 15. Roadmap de implementação

| Etapa                         | Entregas principais                                                                  | Estimativa indicativa |
| ----------------------------- | ------------------------------------------------------------------------------------ | --------------------- |
| 1. Fundação                   | Monorepo, Next.js, contratos, Docker, Prisma/SQLite, autenticação e estrutura da API | 2–3 dias              |
| 2. Player Android             | Kotlin/WebView, recursos locais, modo imersivo, tela ligada, carrossel e relógio     | 3–5 dias              |
| 3. Fotos e dispositivos       | Upload, Sharp, worker, biblioteca, álbuns, pareamento e credenciais                  | 4–6 dias              |
| 4. Sincronização remota       | Manifestos, revisões, publicação, download incremental, cache e recuperação          | 3–5 dias              |
| 5. Widgets e editor           | Editor visual, camadas, relógio, calendário básico, clima, temas e prévia            | 5–8 dias              |
| 6. Integrações e agendamentos | Google Calendar, regras de horário, grupos e monitoramento ampliado                  | 4–6 dias              |
| 7. Testes e entrega           | Testes no tablet, estabilidade, segurança, documentação e APK de release             | 3–5 dias              |

Estimativa original de referência: **24–38 dias de desenvolvimento**, sem esperas externas. Não é compromisso de prazo: deve ser revisada após os protótipos do player e do editor e o detalhamento da autenticação e integrações. O teste de estabilidade requer uma janela contínua de 72 horas.

### Marcos

- **M0 — Viabilidade:** validar APK de 32 bits, WebView, carrossel e uso de memória no PRITOM P7.
- **M1 — MVP:** etapas 1 a 4 integradas, com relógio e personalização básica remota.
- **M2 — Personalização completa:** editor, widgets e modos de exibição.
- **M3 — V1.0:** integrações, agendamentos, permissões, testes e entrega.

## 16. Critérios de aceite

### 16.1 MVP

- CA-01: instalar o ambiente seguindo as instruções e autenticar o administrador.
- CA-02: instalar o APK no PRITOM P7, abrir a interface local e operar em tela cheia.
- CA-03: parear e revogar um dispositivo sem reutilizar credenciais entre tablets.
- CA-04: enviar fotos pelo celular, acompanhar processamento e organizá-las em um álbum.
- CA-05: reproduzir pelo menos 100 fotos otimizadas sem carregamento integral em memória.
- CA-06: alterar remotamente intervalo, ordem e relógio e confirmar aplicação pelo tablet.
- CA-07: aplicar alterações leves normalmente em até 60 segundos com conexão estável, conforme RNF-03.
- CA-08: manter reprodução após desconectar a rede e após reabrir o aplicativo com conteúdo persistido.
- CA-09: interromper uma atualização e comprovar que a versão anterior permanece funcional.
- CA-10: atingir o limite de cache durante uma atualização sem apagar o conteúdo ativo ou corromper a reprodução.
- CA-11: impedir que uma conta ou dispositivo obtenha mídia ou manifesto de outro vínculo não autorizado.

### 16.2 Versão 1.0

- CA-12: mover, redimensionar e sobrepor widgets; salvar e reproduzir fielmente o layout publicado.
- CA-13: confirmar que salvar rascunho não altera o conteúdo em reprodução.
- CA-14: validar Foto, Híbrido e Dashboard em paisagem e retrato, com temas claro e escuro.
- CA-15: apresentar calendário, eventos manuais, clima e integração autorizada com Google Calendar.
- CA-16: executar agendamentos publicados offline, respeitando fuso e regras de conflito.
- CA-17: administrar pelo menos dois dispositivos com atribuições independentes na mesma conta.
- CA-18: restaurar configuração e cache após reinicialização do aplicativo e do tablet; a retomada no boot depende do mecanismo aprovado para o hardware.
- CA-19: completar teste de 72 horas com evidências de estabilidade, sem falha crítica ou crescimento descontrolado de memória.
- CA-20: restaurar uma instalação a partir do backup documentado.
- CA-21: entregar APK de release, documentação, testes e instruções de instalação reproduzíveis.

## 17. Estratégia de testes

- **Unitários:** validação de widgets e manifestos, revisão efetiva, permissões, agendamentos e política de cache.
- **Integração:** API com SQLite, autenticação, pareamento, acesso a mídias, publicação e worker.
- **Ponta a ponta:** upload pelo painel, publicação, sincronização e confirmação no player.
- **Android:** abertura offline, downloads interrompidos, armazenamento insuficiente, recuperação e trocas de orientação.
- **Compatibilidade:** ABI de 32 bits, WebView real do tablet e outra configuração Android suportada quando disponível.
- **Segurança:** isolamento entre contas, revogação, brute force de pareamento, uploads inválidos e navegação indevida na WebView.
- **Estabilidade:** execução de 72 horas com amostras de memória, erros, transições, reinícios e ciclos de perda e retorno de rede.

## 18. Riscos e mitigação

| Risco                                             | Mitigação                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| WebView antiga ou inconsistente                   | Verificar versão no início, definir baseline e usar recursos compatíveis          |
| Memória limitada                                  | Imagens otimizadas, pré-carregamento pequeno e medição no equipamento             |
| Editor visual aumentar o escopo                   | Entregar MVP com layout inicial e validar editor em protótipo separado            |
| Concorrência e bloqueios no SQLite                | Transações curtas, limites de worker, configuração adequada e testes de disputa   |
| Cache insuficiente para atualização e recuperação | Planejar espaço antes de baixar e preservar a versão funcional                    |
| Limites de APIs externas                          | Cache, atualização controlada, integrações opcionais e indicação de dados antigos |
| Política do fabricante impedir retomada no boot   | Validar no PRITOM e documentar limitações e configuração necessária               |
| Divergência entre prévia e player                 | Contratos comuns, renderizador compartilhável e testes visuais                    |
| Disco do servidor cheio ou backup inconsistente   | Monitorar espaço e fornecer procedimento de backup e restauração testado          |

## 19. Decisões pendentes antes dos módulos correspondentes

1. Biblioteca de autenticação e matriz final de permissões administrativas.
2. Versões fixadas de Node.js, Next.js, Prisma, Kotlin, Gradle e WebView mínima.
3. Biblioteca do editor visual e suporte dos controles avançados no celular.
4. Provedor de clima e política de atualização de dados externos.
5. Limites de upload, formatos adicionais e retenção dos arquivos originais.
6. Prazo e formato dos códigos de pareamento e recuperação de acesso administrativo.
7. Política de conflitos de agendamento e definição dos conteúdos offline protegidos.
8. Inicialização automática após boot e limites aceitáveis de configuração manual no PRITOM.
9. Metas mensuráveis de memória e inicialização após o primeiro benchmark.
10. Distribuição do APK, guarda da chave de assinatura e processo de atualização do aplicativo.

Esses pontos não impedem a definição do produto, mas devem ser resolvidos antes de implementar os componentes que dependem deles.

## 20. Entregáveis finais

- Monorepo com painel Next.js, API, worker, contratos e player Android.
- Schema Prisma, migrations e procedimento de criação do administrador inicial.
- Docker Compose, Nginx e configuração de volumes e segredos.
- Pipeline de processamento de fotos e armazenamento privado.
- Contrato versionado de manifesto e documentação da API.
- APK de release assinado e instruções de instalação.
- Testes automatizados e relatório do teste de estabilidade no PRITOM P7.
- Guia de uso, instalação, atualização, backup, restauração e diagnóstico.
- Relação das limitações conhecidas e requisitos mínimos de Android/WebView.

## 21. Definição de concluído

A versão 1.0 estará concluída quando os critérios de aceite estiverem verificados, os fluxos essenciais funcionarem no dispositivo de referência, os testes e limitações estiverem documentados e outra pessoa conseguir instalar e operar o sistema seguindo as instruções entregues.
