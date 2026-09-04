# Cortaê — Podcast Studio

Estúdio para transformar um áudio final em um episódio de podcast distribuído por RSS.

O Cortaê guarda os dados do programa e dos episódios, hospeda a mídia e publica um
feed RSS. Depois, o criador cadastra a URL desse feed nos agregadores, como Spotify,
Apple Podcasts, Amazon Music e YouTube Music.

## O que faz

- Cria e atualiza programas de podcast, com capa e metadados.
- Cria episódios em rascunho, publica agora ou agenda publicação.
- Armazena capas e áudios no R2.
- Gera um feed RSS 2.0 com metadados compatíveis com o ecossistema de podcasts.
- Entrega mídia com `GET`, `HEAD` e byte ranges para streaming.
- Mantém o GUID do episódio estável quando os metadados mudam.
- Mostra o estado de cadastro nos agregadores, informado pelo próprio criador.

## Stack

- React 19 e Vinext
- Cloudflare Workers
- Cloudflare D1 para dados
- Cloudflare R2 para capas e arquivos de áudio
- Tailwind CSS e componentes shadcn

## Rodar localmente

Precisa de Node.js 22.13 ou mais recente.

```bash
npm install
npm run dev
```

Para executar o Worker compilado localmente:

```bash
npm run build
npm run start
```

## Comandos

| Comando | Faz isto |
| --- | --- |
| `npm run dev` | Inicia o ambiente de desenvolvimento. |
| `npm run build` | Compila o app para Cloudflare Workers. |
| `npm run start` | Executa localmente o Worker compilado. |
| `npm run build:pages` | Gera a versão estática para Pages. |
| `npm run lint` | Verifica o código com oxlint. |
| `npm run format` | Formata o código com oxfmt. |

## Dados e mídia

As ligações usadas pelo app são declaradas em [`.openai/hosting.json`](.openai/hosting.json):

- `DB`: banco D1 com programas, episódios e destinos de agregadores.
- `MEDIA`: bucket R2 com capas e áudios finais.

As migrações ficam em [`migrations/`](migrations/). Em ambiente local, o Vite cria
recursos compatíveis para essas ligações.

## Endpoints públicos

- `POST /api/programs`: cria ou atualiza um programa.
- `GET /api/programs?slug=<slug>`: consulta um programa.
- `POST /api/episodes`: cria um episódio e reserva a chave da mídia.
- `POST /api/episodes/<guid>/audio`: envia o áudio final do episódio.
- `PATCH /api/episodes/<guid>`: altera metadados do episódio.
- `POST /api/episodes/<guid>/publish`: publica agora.
- `POST /api/episodes/<guid>/schedule`: agenda ou cancela o agendamento.
- `GET /feed/<slug>`: retorna o feed RSS público.
- `GET` ou `HEAD /media/<chave>`: entrega a capa ou o áudio publicado.

O feed só inclui episódios publicados cuja data de publicação já chegou. A publicação
falha se a mídia ou os metadados obrigatórios não estiverem válidos.

## Como funciona a distribuição

1. O criador configura o programa e envia capa e áudio final.
2. O Cortaê salva o episódio como rascunho, publicado ou agendado.
3. Ao publicar, o episódio entra no feed RSS do programa.
4. O criador cadastra a URL do feed uma vez em cada agregador.
5. Cada plataforma lê e indexa o feed no próprio prazo.

O Cortaê controla a publicação no feed. Ele não promete indexação imediata, nem envia
episódios diretamente pelas APIs de Spotify, Apple, Amazon ou YouTube.

## Documentação de produto

- [`docs/spec-integracao-agregadores.md`](docs/spec-integracao-agregadores.md): escopo, decisões e contratos da distribuição RSS.
- [`docs/decisoes-consistencia-r2-d1.md`](docs/decisoes-consistencia-r2-d1.md): como o app evita inconsistência entre mídia no R2 e dados no D1.

## Limites atuais

- Não migra feeds de outros hosts.
- Não faz upload direto para agregadores, OAuth ou confirmação automática de indexação.
- Não baixa áudio de YouTube nem processa mídia com FFmpeg.
- Não oferece analytics, monetização, feeds privados ou podcasts pagos.
