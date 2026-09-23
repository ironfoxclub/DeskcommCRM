# Fork IronFox do DeskcommCRM

Este repositório (`ironfoxclub/DeskcommCRM`, branch `ironfox/main`) é o DeskcommCRM
original (`melgarafael/DeskcommCRM`) com o **visual do VulcanOS no modo escuro**.
É ele que roda em `crm.ironfoxclub.com`.

## O que o fork muda

| Arquivo | Mudança |
|---|---|
| `app/tema-vulcanos.css` | Todo o visual: degradê vinho, granulado, placa de vidro, sidebar, pop-ups, botões |
| `app/layout.tsx` | Importa o CSS acima |
| `app/app/_components/AppShell.tsx` | Atributos `data-casca` (raiz, coluna, conteúdo) |
| `components/shell/Sidebar.tsx` | Atributo `data-casca="sidebar"` |
| `components/shell/TopBar.tsx` | Atributo `data-casca="topo"` |
| `components/inbox/InboxLayout.tsx` | Altura da caixa de entrada desconta `--casca-respiro` |

O modo claro não muda.

## ⚠️ Não usar o botão "Atualizar agora" do CRM

O botão (e o `hostgator-setup-kit/update.sh`) baixa a imagem oficial do projeto original
e **apaga o visual**. Atualização do fork é feita assim:

## Atualizar para uma versão nova do original

Na máquina de desenvolvimento:

```bash
git fetch origin --tags
git switch ironfox/main
git rebase vX.Y.Z          # a tag nova do original
# conflito? quase sempre é só reaplicar os atributos data-casca da tabela acima
git push --force-with-lease ironfox ironfox/main
```

Depois, no servidor, os passos de "Subir no servidor" abaixo (de `git fetch` em diante).

## Subir no servidor (primeira vez e a cada atualização)

Na pasta do CRM no servidor (a que tem o `docker-compose.prod.yml` e o `.env`):

```bash
cp .env .env.antes-do-fork-$(date +%F)          # backup, pra poder voltar

git remote add ironfox https://github.com/ironfoxclub/DeskcommCRM.git 2>/dev/null
git fetch ironfox ironfox/main
git checkout -B ironfox/main ironfox/ironfox/main

# Só o app precisa ser construído (worker e scheduler seguem com a imagem oficial).
# Leva de 10 a 25 minutos e precisa de ~4 GB de RAM livre (ou swap).
APP_IMAGE=deskcomm-app:ironfox APP_VERSION=$(git describe --tags --abbrev=0)-ironfox \
  docker compose -f docker-compose.prod.yml -f docker-compose.build.yml build app

# O .env passa a apontar para a imagem local e proíbe baixar a oficial por cima.
sed -i 's|^APP_IMAGE=.*|APP_IMAGE=deskcomm-app:ironfox|' .env
grep -q '^APP_PULL_POLICY=' .env \
  && sed -i 's|^APP_PULL_POLICY=.*|APP_PULL_POLICY=never|' .env \
  || echo 'APP_PULL_POLICY=never' >> .env

docker compose -f docker-compose.prod.yml up -d app
```

Se a instalação usa mais arquivos de compose (ex.: `docker-compose.traefik.yml`), incluir
os mesmos `-f` que ela já usa no `up -d`.

## Voltar para o original (desfazer)

```bash
cp .env.antes-do-fork-AAAA-MM-DD .env
git checkout -B main origin/main && git checkout "$(git describe --tags --abbrev=0 origin/main)"
docker compose -f docker-compose.prod.yml up -d app
```
