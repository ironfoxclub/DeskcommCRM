---
impacto: capacidade_nova
secao: alterado
titulo: O kit instala em VPS ARM64, buildando as imagens do código local
---
Instalação e atualização não recusam mais ARM64/aarch64 de cara — a guarda
de arquitetura passou a reconhecer também aarch64/arm64, deixando quem
está numa VPS ARM (ex.: Oracle Cloud Free Tier, cuja oferta grátis maior
só existe nessa arquitetura) cair no caminho que o kit já tinha pronto pra
isso: `construir_aqui_e_subir`, que builda app/worker/scheduler do código
em vez de baixar as imagens prontas (só existem em `linux/amd64` hoje).
As duas imagens de terceiros que são pull normal, não build — WAHA e
`srh` — trocam sozinhas pra uma variante ARM (`WAHA_IMAGE`/`SRH_IMAGE`,
resolvidas em `verificar_arquitetura_do_kit`), senão quebrariam antes de
chegar no fallback de build. A troca do `srh` ainda não foi confirmada
rodando de verdade em ARM — só por leitura de código/metadados do
registro — então vale validar antes de depender disso em produção.
