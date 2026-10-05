#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMMON="$ROOT/hostgator-setup-kit/_common.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

# `uname` é o único sinal que a guarda lê. Os outros três são sentinelas: se o
# `_common.sh` chamar docker, curl ou git antes de decidir, fica rastro e o
# teste reprova mesmo que a mensagem final pareça correta.
#
# O alcance é o `_common.sh`, não o install.sh/update.sh reais. Os chamadores
# abaixo são wrappers mínimos que só carregam o `_common.sh` com o NOME do
# script, que é o que a guarda confere. O install.sh real já chama docker e git
# (conferência de dependências e, se preciso, o clone) antes de carregar o
# `_common.sh`, e isso fica fora desta prova; o que ela mede é que a decisão
# vem antes de qualquer trabalho feito pelo próprio `_common.sh`.
cat > "$TMP/bin/uname" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = "-m" ]; then
  printf '%s\n' "${FAKE_ARCH:-x86_64}"
  exit 0
fi
printf '%s\n' "${FAKE_ARCH:-x86_64}"
SH

for cmd in docker curl git; do
  cat > "$TMP/bin/$cmd" <<SH
#!/usr/bin/env bash
touch "$TMP/tocou-$cmd"
printf 'sentinela $cmd não deveria ter sido chamado\n' >&2
exit 99
SH
  chmod +x "$TMP/bin/$cmd"
done
chmod +x "$TMP/bin/uname"

fail=0

rodar_como() {
  local nome="$1" arch="$2" out rc
  # A guarda confere o NOME do arquivo (BASH_SOURCE[1]) — tem que ser
  # literalmente "install.sh"/"update.sh", daí a subpasta por arquitetura em
  # vez de sufixar o nome (que quebraria essa checagem).
  local dir="$TMP/$arch"
  mkdir -p "$dir"
  local wrapper="$dir/$nome"
  cat > "$wrapper" <<SH
#!/usr/bin/env bash
. "$COMMON"
printf 'DEPOIS_DA_GUARDA WAHA_IMAGE=%s SRH_IMAGE=%s\n' "\${WAHA_IMAGE:-}" "\${SRH_IMAGE:-}"
SH
  chmod +x "$wrapper"

  if out="$(env FAKE_ARCH="$arch" PATH="$TMP/bin:$PATH" bash "$wrapper" 2>&1)"; then rc=0; else rc=$?; fi
  printf '%s\n' "$rc" > "$TMP/rc-$nome-$arch"
  printf '%s' "$out" > "$TMP/out-$nome-$arch"
}

# Arquitetura de verdade não suportada por ninguém (nem pull, nem build local)
# — a guarda ainda tem que recusar isto, senão "aceitar ARM" virou "aceitar
# qualquer coisa". riscv64 nunca vai ser confundida com um typo de aarch64.
for nome in install.sh update.sh; do
  rodar_como "$nome" riscv64
  rc="$(cat "$TMP/rc-$nome-riscv64")"
  out="$(cat "$TMP/out-$nome-riscv64")"

  if [ "$rc" -eq 0 ]; then
    printf '✗ %s aceitou riscv64 (arquitetura de verdade não suportada)\n' "$nome"; fail=1
  elif ! printf '%s' "$out" | grep -q 'riscv64'; then
    printf '✗ %s recusou sem dizer a arquitetura encontrada\n' "$nome"; fail=1
  elif printf '%s' "$out" | grep -q 'DEPOIS_DA_GUARDA'; then
    printf '✗ %s continuou depois da recusa\n' "$nome"; fail=1
  else
    printf '✓ %s recusa riscv64 (arquitetura sem nenhum caminho no kit)\n' "$nome"
  fi
done

# ARM64/aarch64: desde 2026-09-22 NÃO é mais recusada — o kit builda as 3
# imagens do código local (`construir_aqui_e_subir`) quando o pull das prontas
# falhar. A prova aqui é só da GUARDA: ela deixa passar, avisa que é ARM, e já
# troca WAHA_IMAGE/SRH_IMAGE (imagens de terceiros, que são pull normal, não
# build) pra variante ARM — sem isso os dois quebrariam antes mesmo de chegar
# no fallback de build. Quem prova o build em si é o build real (não dá pra
# simular sem rodar `docker build` de verdade), não este teste.
for nome in install.sh update.sh; do
  rodar_como "$nome" aarch64
  rc="$(cat "$TMP/rc-$nome-aarch64")"
  out="$(cat "$TMP/out-$nome-aarch64")"

  if [ "$rc" -ne 0 ]; then
    printf '✗ %s recusou aarch64 (deveria builda local, não recusar)\n' "$nome"; fail=1
  elif ! printf '%s' "$out" | grep -qi 'arm64'; then
    printf '✗ %s passou por aarch64 sem avisar que é ARM64\n' "$nome"; fail=1
  elif ! printf '%s' "$out" | grep -q 'WAHA_IMAGE=devlikeapro/waha:noweb-arm'; then
    printf '✗ %s não trocou WAHA_IMAGE pra variante ARM\n' "$nome"; fail=1
  elif ! printf '%s' "$out" | grep -q 'SRH_IMAGE=hiett/serverless-redis-http:0.0.10'; then
    printf '✗ %s não trocou SRH_IMAGE pra variante multi-arch\n' "$nome"; fail=1
  elif ! printf '%s' "$out" | grep -q 'DEPOIS_DA_GUARDA'; then
    printf '✗ %s não continuou depois da guarda em aarch64\n' "$nome"; fail=1
  else
    printf '✓ %s aceita aarch64 e prepara WAHA_IMAGE/SRH_IMAGE pra ARM\n' "$nome"
  fi
done

for cmd in docker curl git; do
  if [ -e "$TMP/tocou-$cmd" ]; then
    printf '✗ a guarda tocou em %s antes de decidir\n' "$cmd"; fail=1
  else
    printf '✓ _common.sh não toca em %s antes de decidir a arquitetura\n' "$cmd"
  fi
done

# Contrapeso: a guarda não pode transformar o requisito amd64/arm64 numa
# recusa geral, nem grudar o aviso de ARM em quem não é ARM.
rodar_como update.sh x86_64
rc="$(cat "$TMP/rc-update.sh-x86_64")"
out="$(cat "$TMP/out-update.sh-x86_64")"
if [ "$rc" -ne 0 ] || ! printf '%s' "$out" | grep -q 'DEPOIS_DA_GUARDA'; then
  printf '✗ x86_64 deveria atravessar a guarda\n'; fail=1
elif printf '%s' "$out" | grep -qi 'arm64'; then
  printf '✗ x86_64 recebeu aviso de ARM64\n'; fail=1
elif printf '%s' "$out" | grep -q 'WAHA_IMAGE=devlikeapro/waha:noweb-arm'; then
  printf '✗ x86_64 teve WAHA_IMAGE trocado pra variante ARM\n'; fail=1
else
  printf '✓ x86_64 atravessa a guarda sem aviso/troca de ARM\n'
fi

exit "$fail"
