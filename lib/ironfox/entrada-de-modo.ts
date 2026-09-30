/*
 * Pop-up "Entrando na Forja / na Operação" da troca de modo (VulcanOS ↔ CRM).
 *
 * Fork IronFox: cópia de vulcanos-app/src/lib/entrada-de-modo.ts (arquivo novo,
 * sem conflito com o original). Mudar lá e aqui juntas. Aparece em dois momentos, com o mesmo desenho, pra parecer
 * uma tela só:
 * 1. no clique do seletor de modo (`mostrarEntrada`), por cima da página atual,
 *    enquanto o servidor gera o acesso do outro lado;
 * 2. na página-ponte do destino (`paginaDaEntrada`), enquanto a primeira tela de
 *    lá carrega. A barra continua de onde a primeira parou (mais ou menos).
 *
 * Só HTML e CSS (sem React nem script): serve tanto pra injetar na página quanto
 * pra resposta crua da rota-ponte. As frases giram por animação de CSS.
 *
 * Medidas: fundo #050506 72% com desfoque 6px; cartão 360px, fundo #0B0B0D,
 * borda #E9E8E2 10%, raio 16px; símbolo 44px; título 20px peso 500; barra 4px
 * vinho #630102 → brasa #E0763C; frase 13px #E9E8E2 60%, troca a cada 2,2s.
 */

export type Modo = "forja" | "operacao";

const TITULO: Record<Modo, string> = {
  forja: "Entrando na Forja",
  operacao: "Entrando na Operação",
};

const FRASES: Record<Modo, string[]> = {
  forja: [
    "Atiçando as brasas…",
    "Batendo o martelo na bigorna…",
    "Acordando o vulcão (ele não é de manhã)…",
    "Esquentando o metal das ideias…",
    "Afiando as estratégias…",
    "Tirando a lava do caminho…",
    "Vestindo o avental de couro…",
    "Juntando faíscas pra virar plano…",
    "Consultando o Cérebro (ele pediu café)…",
  ],
  operacao: [
    "Abrindo as conversas do WhatsApp…",
    "Contando os leads (de novo)…",
    "Passando café pro time de vendas…",
    "Arrumando o funil pra ninguém escorregar…",
    "Acordando o agente de atendimento…",
    "Botando o crachá da Operação…",
    "Esquentando o motor das vendas…",
    "Conferindo se ninguém ficou no vácuo…",
    "Tirando o metal da forja e levando pra rua…",
  ],
};

const POR_VEZ = 4;
const SEGUNDOS_POR_FRASE = 2.2;
const ID = "entrada-de-modo";

// Símbolo do VulcanOS (o mesmo de IconVulcanOS em vulcanos-app/src/components/icons.tsx).
const SIMBOLO = `<svg viewBox="0 0 2000 2000" fill="currentColor" aria-hidden="true"><path d="M958.91,1663.63v.33l-.16-.49-20.75-132.47v-.08l-11.89-76.2c-2.54-11.98-5.25-23.95-8.12-35.93l-.33-1.15c-.74-3.2-1.56-6.32-2.38-9.51v-.08c-4.92-19.6-10.25-39.13-16.32-58.49-5.99-29.2-16-56.93-29.45-82.52-9.1-17.39-19.77-33.8-31.91-49.05-1.72-2.21-3.45-4.35-5.17-6.48-7.46-9.43-15.5-18.21-23.95-26.33-1.64-1.64-3.28-3.28-5-4.92-.25-.33-.57-.57-.9-.9-3.03-2.87-6.15-5.74-9.35-8.45-9.35-8.2-19.36-15.83-29.94-22.97-2.13-1.48-4.27-2.95-6.48-4.27-40.19-26.41-86.13-45.44-134.85-59.72-4.76-1.39-9.51-2.79-14.11-4.1-59.31-16.98-107.95-23.38-116.4-24.44-.25,0-.49-.08-.66-.08-.41-.08-.57-.08-.57-.08h-.08l-1.07-.16c-36.67-5.91-73.33-10.5-108.93-14.93l-84.41-11.57c63.41.08,126.9,1.64,190.47,4.27l69.23,3.44,101.88,5.09c21.41,1.23,42.82,2.46,64.23,3.77.08-.08.16,0,.16,0,9.43.57,18.95,1.15,28.38,1.72,2.79,1.48,5.58,2.95,8.28,4.59l50.69,33.8,5.25,3.53c.98.66,1.97,1.31,2.95,2.05,19.28,15.09,37.49,31.66,54.63,49.54,2.13,2.21,4.18,4.43,6.15,6.64,13.45,14.44,26.08,29.61,37.98,45.28,0,0,.16.08.16.16.98,1.56,1.97,3.12,2.95,4.68h.08l16.65,23.13.25.41c3.12,4.59,6.15,9.27,9.11,13.94.41,5.58.82,11.07,1.23,16.65.08.98.16,1.89.16,2.87v.41l7.14,237.06,5.17,172.01Z"/><path d="M790.41,984.45c69.93,4.46,143.81,27.49,185.48,83.83,41.84,56.55,42.11,132.64,40.66,202.97-4.45,215-8.91,430-13.36,645,22.63-209.8,45.82-422.27,102.71-626.05,12.31-44.11,27.02-89.06,56.78-123.87,51.38-60.11,135.64-77.72,213.52-91.43,190.99-33.62,382.44-65.22,575.14-86.99l-786.13-3.11c-56.67-7.52-114.02-30.42-149.11-75.54-35.82-46.05-43.41-108.03-41.58-166.34l10.22-659.18c-22.59,170.03-42.62,340.63-74.84,509.19-11.73,61.34-26.34,125.06-58.72,177.35-9.05,14.61-19.48,28.32-31.62,40.84-65.36,67.41-165.08,85.35-257.85,99.84-170.85,26.67-341.65,55.46-513.04,75.86l741.76-2.38Z"/><path d="M1031.53,312.17v-.33l.16.49,20.75,132.47v.08l11.89,76.2c2.54,11.98,5.25,23.95,8.12,35.93l.33,1.15c.74,3.2,1.56,6.32,2.38,9.51v.08c4.92,19.6,10.25,39.13,16.32,58.49,5.99,29.2,16,56.93,29.45,82.52,9.1,17.39,19.77,33.8,31.91,49.05,1.72,2.21,3.45,4.35,5.17,6.48,7.46,9.43,15.5,18.21,23.95,26.33,1.64,1.64,3.28,3.28,5,4.92.25.33.57.57.9.9,3.03,2.87,6.15,5.74,9.35,8.45,9.35,8.2,19.36,15.83,29.94,22.97,2.13,1.48,4.27,2.95,6.48,4.27,40.19,26.41,86.13,45.44,134.85,59.72,4.76,1.39,9.51,2.79,14.11,4.1,59.31,16.98,107.95,23.38,116.4,24.44.25,0,.49.08.66.08.41.08.57.08.57.08h.08l1.07.16c36.67,5.91,73.33,10.5,108.93,14.93l84.41,11.57c-63.41-.08-126.9-1.64-190.47-4.27l-69.23-3.44-101.88-5.09c-21.41-1.23-42.82-2.46-64.23-3.77-.08.08-.16,0-.16,0-9.43-.57-18.95-1.15-28.38-1.72-2.79-1.48-5.58-2.95-8.28-4.59l-50.69-33.8-5.25-3.53c-.98-.66-1.97-1.31-2.95-2.05-19.28-15.09-37.49-31.66-54.63-49.54-2.13-2.21-4.18-4.43-6.15-6.64-13.45-14.44-26.08-29.61-37.98-45.28,0,0-.16-.08-.16-.16-.98-1.56-1.97-3.12-2.95-4.68h-.08l-16.65-23.13-.25-.41c-3.12-4.59-6.15-9.27-9.11-13.94-.41-5.58-.82-11.07-1.23-16.65-.08-.98-.16-1.89-.16-2.87v-.41l-7.14-237.06-5.17-172.01Z"/></svg>`;

function css(continuacao: boolean): string {
  const ciclo = POR_VEZ * SEGUNDOS_POR_FRASE;
  const fatia = 100 / POR_VEZ;
  return `
#${ID}{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
  background:rgba(5,5,6,.72);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);color:#E9E8E2;
  font-family:var(--font-clash-grotesk,"Clash Grotesk"),"Clash Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;
  ${continuacao ? "" : "animation:edm-surge .18s ease-out;"}}
#${ID} *{box-sizing:border-box}
#${ID} .edm-cartao{width:360px;max-width:calc(100vw - 32px);padding:32px 28px 26px;text-align:center;
  background:#0B0B0D;border:1px solid rgba(233,232,226,.1);border-radius:16px;
  box-shadow:0 20px 60px rgba(0,0,0,.55),0 0 80px rgba(99,1,2,.18);
  ${continuacao ? "" : "animation:edm-sobe .28s cubic-bezier(.2,.8,.2,1);"}}
#${ID} .edm-simbolo{display:block;width:44px;height:44px;margin:0 auto;color:#E9E8E2;
  animation:edm-brilho 1.6s ease-in-out infinite}
#${ID} .edm-simbolo svg{display:block;width:100%;height:100%}
#${ID} .edm-marca{margin:16px 0 0;font-size:12px;font-weight:500;letter-spacing:.06em;
  color:rgba(233,232,226,.45)}
#${ID} .edm-titulo{margin:6px 0 0;font-size:20px;font-weight:500;line-height:1.3;color:#E9E8E2}
#${ID} .edm-barra{position:relative;height:4px;margin:20px 0 0;border-radius:99px;overflow:hidden;
  background:rgba(233,232,226,.08)}
#${ID} .edm-barra>i{position:absolute;inset:0 auto 0 0;border-radius:inherit;
  background:linear-gradient(90deg,#630102,#B3261E 70%,#E0763C);box-shadow:0 0 12px rgba(224,118,60,.55);
  animation:edm-carga 9s cubic-bezier(.08,.6,.2,1) forwards}
#${ID} .edm-frases{position:relative;height:20px;margin:14px 0 0}
#${ID} .edm-frases>span{position:absolute;inset:0;font-size:13px;line-height:20px;color:rgba(233,232,226,.6);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;
  animation:edm-frase ${ciclo}s linear infinite both}
${Array.from({ length: POR_VEZ }, (_, i) => `#${ID} .edm-frases>span:nth-child(${i + 1}){animation-delay:${(i * SEGUNDOS_POR_FRASE).toFixed(1)}s}`).join("\n")}
@keyframes edm-surge{from{opacity:0}}
@keyframes edm-sobe{from{opacity:0;transform:translateY(10px) scale(.98)}}
@keyframes edm-brilho{50%{filter:drop-shadow(0 0 14px rgba(224,118,60,.5));transform:scale(1.04)}}
@keyframes edm-carga{from{width:${continuacao ? 55 : 4}%}to{width:94%}}
@keyframes edm-frase{0%{opacity:0;transform:translateY(6px)}${(fatia * 0.12).toFixed(1)}%,${(fatia * 0.88).toFixed(1)}%{opacity:1;transform:none}${fatia}%,100%{opacity:0;transform:translateY(-6px)}}
@media (prefers-reduced-motion:reduce){#${ID} .edm-simbolo{animation:none}}`;
}

function sortear(lista: string[], n: number): string[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j]!, copia[i]!];
  }
  return copia.slice(0, n);
}

// O pop-up inteiro (estilo + marcação). `continuacao`: sem a animação de
// entrada e com a barra já adiantada, pra a página-ponte emendar no clique.
export function htmlDaEntrada(modo: Modo, continuacao = false): string {
  const frases = sortear(FRASES[modo], POR_VEZ)
    .map((f) => `<span>${f}</span>`)
    .join("");
  return `<div id="${ID}" role="status" aria-live="polite"><style>${css(continuacao)}</style>
<div class="edm-cartao"><span class="edm-simbolo">${SIMBOLO}</span>
<p class="edm-marca">VulcanOS</p><p class="edm-titulo">${TITULO[modo]}</p>
<div class="edm-barra"><i></i></div><div class="edm-frases">${frases}</div></div></div>`;
}

// Clique no seletor de modo. Clique com Ctrl/meio (nova aba) não mostra nada.
export function mostrarEntrada(modo: Modo, e?: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  if (e && (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey)) return;
  if (document.getElementById(ID)) return;
  document.body.insertAdjacentHTML("beforeend", htmlDaEntrada(modo));
  // Voltar pelo navegador pode trazer a página de volta da memória (bfcache)
  // ainda com o pop-up aberto.
  window.addEventListener(
    "pageshow",
    (ev) => {
      if (ev.persisted) document.getElementById(ID)?.remove();
    },
    { once: true },
  );
}

// Página-ponte do destino: mostra o pop-up e segue pra `destino`.
export function paginaDaEntrada(modo: Modo, destino: string): string {
  const atributo = destino.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return (
    `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">` +
    `<noscript><meta http-equiv="refresh" content="0;url=${atributo}"></noscript>` +
    `<title>${TITULO[modo]}…</title>` +
    `<style>html,body{margin:0;height:100%;background:#0B0B0D}` +
    `@font-face{font-family:"Clash Grotesk";src:url(/fontes/ClashGrotesk-Medium.otf) format("opentype");font-weight:500;font-display:swap}</style>` +
    `</head><body>${htmlDaEntrada(modo, true)}` +
    `<script>location.replace(${JSON.stringify(destino).replace(/</g, "\\u003c")})</script>` +
    `<noscript><p style="text-align:center"><a href="${atributo}" style="color:#E9E8E2">Continuar</a></p></noscript>` +
    `</body></html>`
  );
}
