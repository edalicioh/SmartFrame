# Painel local sem login

O ambiente atual usa `SMARTFRAME_ADMIN_LOGIN=disabled` no `.env`. Painel e editor abrem diretamente, sem tela de login ou botão de sair.

**Qualquer pessoa ou programa com acesso ao endereço pode administrar fotos, layouts e dispositivos. Não exponha esse modo na rede ou na internet.**

## Proteções mantidas

- Alterações administrativas verificam `Origin`.
- O modo só aceita a origem de loopback configurada e o `Host` correspondente; acessos cross-site são recusados.
- Mantenha o bind em loopback: Compose em `127.0.0.1:8080` e execução local desta sessão em `127.0.0.1:3030`.
- Credenciais do player permanecem obrigatórias. Manifestos e fotos da API do tablet não ficam públicos.
- Abrir as páginas `/` ou `/layouts` por outro alias de loopback na mesma porta (por exemplo, `127.0.0.1` em vez de `localhost`) redireciona para a origem configurada. Isso não libera hosts externos, outra porta, requisições cross-site nem altera a autorização das APIs.
- Usuários, senhas, fotos, versões e dispositivos existentes são preservados.
- Ações ficam atribuídas ao perfil local, sem distinguir individualmente os visitantes do painel aberto.

Com uma única conta, ela é usada automaticamente. Se há várias, selecione explicitamente no `.env`:

```dotenv
SMARTFRAME_ADMIN_EMAIL=email-do-proprietario@exemplo.com
```

O servidor não escolhe uma conta arbitrária, nem cria/redefine credenciais ao abrir o painel. Instalações novas ainda devem ser inicializadas pelo CLI do README.

## Reativar login

```dotenv
SMARTFRAME_ADMIN_LOGIN=required
```

Reinicie o servidor; no Docker, recrie o web para aplicar o ambiente. Instalações novas exigem login por padrão; só `disabled` desativa a verificação.

Antes de usar uma origem não local, reative o login e configure HTTPS. Não publique `SMARTFRAME_BIND` enquanto o login estiver desativado.
