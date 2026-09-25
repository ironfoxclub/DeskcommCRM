# Fork IronFox do DeskcommCRM

Este repositório (`ironfoxclub/DeskcommCRM`, branch `ironfox/main`) é o DeskcommCRM
original (`melgarafael/DeskcommCRM`) com o **visual do VulcanOS no modo escuro**.
É ele que roda em `crm.ironfoxclub.com`.

## O que o fork muda

| Arquivo | Mudança |
|---|---|
| `app/tema-vulcanos.css` | Todo o visual: degradê vinho, granulado, placa de vidro, sidebar, pop-ups, botões, fontes da IronFox (Clash Grotesk + Fraunces) |
| `app/_fontes-ironfox/` | Arquivos das fontes usadas pelo CSS acima (arquivo novo, sem conflito) |
| `app/layout.tsx` | Importa o CSS acima |
| `app/app/_components/AppShell.tsx` | Atributos `data-casca` (raiz, coluna, conteúdo) |
| `components/shell/Sidebar.tsx` | Atributo `data-casca="sidebar"`; uma linha que põe o seletor de modo abaixo da marca |
| `components/ironfox/ModoSeletor.tsx` | Seletor `[ Forja \| Operação ]` (Forja = VulcanOS), igual ao da VulcanOS; só admin da plataforma vê |
| `lib/ironfox/vulcanos.ts`, `app/auth/vulcanos/route.ts`, `app/api/ironfox/vulcanos/route.ts` | Login central com o VulcanOS (só a equipe IronFox) |
| `app/(public)/login/page.tsx` | Manda ao login central só o navegador que já entrou pelo VulcanOS; clientes veem o login do CRM |
| `components/shell/TopBar.tsx` | Atributo `data-casca="topo"` |
| `components/inbox/InboxLayout.tsx` | Altura da caixa de entrada desconta `--casca-respiro` |

O modo claro não muda.

## Como o fork se atualiza (sozinho)

O servidor segue **este** repositório: `origin` aponta para `ironfoxclub/DeskcommCRM` e as
imagens vêm de `ghcr.io/ironfoxclub` (`IMG_NS` em `hostgator-setup-kit/_common.sh`).

O workflow `.github/workflows/ironfox-acompanha-o-original.yml` roda a cada 3 horas:

1. vê a tag mais nova do original (`melgarafael/DeskcommCRM`);
2. junta essa tag com `ironfox/main` (merge, não rebase);
3. confere tipos e os testes do fork;
4. constrói a imagem do app com as nossas mudanças e copia as de worker, scheduler e voz;
5. publica o ramo e, **por último**, a tag `vX.Y.Z` neste repositório.

Só depois do passo 5 o CRM mostra "Versão X.Y.Z disponível", e aí o botão
**"Atualizar agora" é seguro**: ele baixa as imagens da IronFox, com o visual.

Se a junção der conflito ou a conferência falhar, o workflow para com erro, o GitHub manda
e-mail e nenhuma tag é criada: o CRM fica na versão em que está. Para resolver, na máquina
de desenvolvimento:

```bash
git fetch https://github.com/melgarafael/DeskcommCRM.git tag vX.Y.Z
git switch ironfox/main
git merge vX.Y.Z           # resolver os conflitos, rodar os testes
git push ironfox ironfox/main
gh workflow run ironfox-acompanha-o-original.yml -R ironfoxclub/DeskcommCRM -f versao=vX.Y.Z
```

Para mudança da IronFox que não pode esperar a próxima versão do original, o workflow
`.github/workflows/ironfox-republicar.yml` (manual) reconstrói a imagem do app a partir de
`ironfox/main` com o **mesmo número** da última tag e a sobrescreve. Depois, no servidor
(o `pull` do compose pula imagem com número que já existe, por isso o `docker pull`):

```bash
gh workflow run ironfox-republicar.yml -R ironfoxclub/DeskcommCRM
# quando terminar, no servidor, em /root/deskcommcrm/hostgator-setup-kit/deskcommcrm:
docker pull ghcr.io/ironfoxclub/deskcommcrm:X.Y.Z
docker compose -f docker-compose.prod.yml up -d app
```

Requisitos do lado do GitHub (feitos uma vez):

- ramo padrão do repositório = `ironfox/main` (agendamento só roda no ramo padrão);
- workflows do original desligados no fork (`relogio`, `vigia-de-colisao`,
  `publish-image`, `release`);
- os 4 pacotes em `ghcr.io/ironfoxclub` **públicos** (o servidor e o CRM conferem as
  imagens sem login);
- segredo `IRONFOX_TOKEN` (token com escopo `workflow`): sem ele o GitHub recusa o push
  quando a versão nova do original mexe nos workflows dele.

## Apontar o servidor para o fork (uma vez)

Na pasta do CRM no servidor (a que tem o `docker-compose.prod.yml` e o `.env`), com a tag
já publicada aqui e as imagens públicas:

```bash
cp .env .env.antes-do-fork-$(date +%F)          # backup, pra poder voltar
git remote set-url origin https://github.com/ironfoxclub/DeskcommCRM.git
git fetch --tags origin
git checkout vX.Y.Z
sed -i '/_IMAGE=/{s|ghcr.io/melgarafael/|ghcr.io/ironfoxclub/|; s|:[^:]*$|:X.Y.Z|}' .env
docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```

## Voltar para o original (desfazer)

```bash
cp .env.antes-do-fork-AAAA-MM-DD .env
git remote set-url origin https://github.com/melgarafael/DeskcommCRM.git
git fetch --tags origin && git checkout "$(git tag -l 'v*' | sort -V | tail -1)"
docker compose -f docker-compose.prod.yml up -d
```
