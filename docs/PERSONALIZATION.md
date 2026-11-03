# Personalizar o aplicativo — modo Foto 0.3

## Uso no ambiente de teste atual

1. Abra **http://localhost:8080/layouts** no computador. O ambiente atual abre sem login; instalações com autenticação obrigatória pedem a conta administrativa.
2. Escolha sua foto de fundo. JPEG, PNG e WebP estático são aceitos, até 12 MB e 24 megapixels.
3. Aguarde o processamento no servidor. O worker cria um WebP sem metadados, com até 1600 × 1600 e 4 MB.
4. Ajuste enquadramento, cor, degradê, escurecimento, relógio, data, posição, tamanho, fonte, mensagem, orientação e fuso horário.
   Ative também os cartões de temperatura e moedas, com busca de cidade e escolha de posição. Veja [as fontes e o cache](WIDGETS.md).
5. A prévia acompanha as alterações. Ela usa o mesmo HTML/CSS/JavaScript do APK.
6. **Salvar rascunho** persiste no servidor sem alterar a tela do tablet.
7. **Publicar no tablet** salva e cria uma revisão imutável, disponível aos dispositivos vinculados à conta.
8. Consulte o estado de cada tablet no editor: publicação no servidor e aplicação confirmada são eventos diferentes.

O PRITOM de teste foi conectado à instalação Docker na porta **8080**, com uma imagem ilustrativa identificada como demonstração. Substitua essa imagem pela sua no editor. O servidor local na porta 3030 usa outro banco; editar nele não altera os dispositivos conectados ao Docker.

## Conectar outro tablet

1. Instale o APK de debug atualizado.
2. No editor, clique em **Conectar tablet**.
3. No aplicativo, toque em **Conectar** ou no botão **⋮**.
4. Informe o endereço do servidor, o código de dez caracteres e o nome do tablet.
5. O código expira em dez minutos e só pode ser usado uma vez.

Nesta primeira implementação, o painel gera o código e o aplicativo o resgata. O código e a credencial não são guardados em texto no servidor. A credencial recebida é criptografada pelo Android Keystore, sem acesso pelo JavaScript.

### Teste por USB com HTTP local

```powershell
adb -s SERIAL_DO_TABLET reverse tcp:8080 tcp:8080
```

No APK de debug, informe `http://localhost:8080`. Mantenha o USB conectado para receber novas publicações. O APK de debug só permite HTTP nas origens locais explicitamente autorizadas; builds de produção exigem HTTPS.

Sem USB, o último layout recebido continua aparecendo, mas novas mudanças não chegam por esse endereço. Para uso remoto ou pela rede, configure uma origem HTTPS com certificado confiável e acessível ao tablet.

## Offline e recuperação

- Polling normal de 30 segundos enquanto o aplicativo está ativo.
- A imagem é baixada pela camada Kotlin com autorização do dispositivo, nunca pelo JavaScript.
- Tamanho, SHA-256, dimensões e contrato são verificados antes da aplicação.
- Manifesto e foto são gravados atomicamente em arquivos internos.
- A versão anterior e suas imagens são preservadas; falha de rede ou download não apaga a versão ativa.
- O relógio funciona localmente no fuso publicado. Foto e layout persistem após encerrar e reabrir o aplicativo.
- O cache desta etapa mantém somente a foto ativa e a anterior, com limite de 4 MB por imagem. Não é ainda o cache genérico de carrossel de 2 GB do PRD.
- Desvincular bloqueia novos acessos, mas não apaga conteúdo de um tablet offline.

## Limites desta etapa

- Um layout Foto por conta, aplicado aos seus tablets vinculados.
- Uma foto estática de fundo; ainda não há álbuns, favoritos, ordenação ou carrossel de múltiplas fotos.
- Posições predefinidas para informações e clima/moedas; ainda não há arrastar/redimensionar livremente, camadas, desfazer/refazer ou calendário.
- Atribuição independente por dispositivo e agendamentos serão acrescentados depois.
- A criação inicial do administrador e o acesso remoto HTTPS continuam seguindo o README.

## Verificação realizada

- 33 testes automatizados de contratos, banco, autenticação, fila, versões, códigos, revogação e isolamento.
- Smoke HTTP: foto, processamento, rascunho, publicação imutável, pareamento, manifesto, download com hash, heartbeat e revogação.
- Formulário React, prévia, salvamento e viewport móvel de 390 px verificados no navegador.
- APK conectado pelo formulário nativo no PRITOM; foto e relógio renderizados com revisão confirmada pelo servidor.
- Nova publicação confirmada pelo tablet em aproximadamente 18,5 segundos nesta execução, sem intervenção no APK.
- Servidor tornado inacessível ao tablet pela remoção temporária do encaminhamento USB: foto, mensagem e relógio locais preservados após encerrar e reabrir o APK.

Esses testes são iniciais. Não substituem estabilidade por 72 horas, teste de 100 fotos, release assinado ou validação em outros dispositivos.
