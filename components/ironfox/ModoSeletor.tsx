"use client";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";

/*
 * Fork IronFox: seletor de modo Forja (VulcanOS) / Operação (este CRM).
 * Cópia do desenho de vulcanos-app/src/components/modo-seletor.tsx, com
 * Operação marcado. Forja passa pela rota que gera o acesso de lá, já logado
 * (ver lib/ironfox/vulcanos.ts). Só a equipe IronFox (admin da plataforma) vê;
 * cliente vê só o CRM.
 *
 * Medidas (iguais às da VulcanOS; mudar lá e aqui juntas):
 * - Caixa: margem lateral 12px (mx-3), padding 2px, gap 2px, raio 8px,
 *   borda #E9E8E2 10%, fundo #13100F.
 * - Segmento: altura 32px, raio 6px, fonte 12px peso 500.
 * - Ativo: fundo #630102, texto #E9E8E2. Inativo: transparente, texto
 *   #E9E8E2 60%, hover texto 100% + fundo #E9E8E2 5%.
 * - Recolhido: segmentos empilhados, só ícone 16px (VulcanOS / CRM) com title.
 * Único ajuste daqui: mt-2, porque o cabeçalho do CRM termina numa borda.
 */

const ATALHO_DO_VULCANOS = "/api/ironfox/vulcanos";

const SEGMENTO = "flex h-8 items-center justify-center rounded-md transition";
const ATIVO = "bg-[#630102] text-[#E9E8E2]";
const INATIVO = "text-[#E9E8E2]/60 hover:bg-[#E9E8E2]/5 hover:text-[#E9E8E2]";

export function ModoSeletor({ collapsed }: { collapsed: boolean }) {
  const { user } = useAuth();
  const t = useT();
  if (!user.is_platform_admin) return null;

  return (
    <div
      role="group"
      aria-label="Modo"
      className={cn(
        "mx-3 mt-2 grid gap-0.5 rounded-lg border border-[#E9E8E2]/10 bg-[#13100F] p-0.5 text-xs font-medium",
        collapsed ? "grid-cols-1" : "grid-cols-2",
      )}
    >
      <a href={ATALHO_DO_VULCANOS} title={collapsed ? "Forja" : undefined} className={cn(SEGMENTO, INATIVO)}>
        {collapsed ? <SimboloDoVulcanOS className="h-4 w-4" /> : "Forja"}
      </a>
      <span aria-current="page" title={collapsed ? t("Operação") : undefined} className={cn(SEGMENTO, ATIVO)}>
        {collapsed ? <IconeDoCRM className="h-4 w-4" /> : t("Operação")}
      </span>
    </div>
  );
}

// Símbolo do VulcanOS, o mesmo do menu de lá (vulcanos-app/src/components/icons.tsx).
function SimboloDoVulcanOS({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 2000 2000" fill="currentColor" aria-hidden className={className}>
      <path d="M958.91,1663.63v.33l-.16-.49-20.75-132.47v-.08l-11.89-76.2c-2.54-11.98-5.25-23.95-8.12-35.93l-.33-1.15c-.74-3.2-1.56-6.32-2.38-9.51v-.08c-4.92-19.6-10.25-39.13-16.32-58.49-5.99-29.2-16-56.93-29.45-82.52-9.1-17.39-19.77-33.8-31.91-49.05-1.72-2.21-3.45-4.35-5.17-6.48-7.46-9.43-15.5-18.21-23.95-26.33-1.64-1.64-3.28-3.28-5-4.92-.25-.33-.57-.57-.9-.9-3.03-2.87-6.15-5.74-9.35-8.45-9.35-8.2-19.36-15.83-29.94-22.97-2.13-1.48-4.27-2.95-6.48-4.27-40.19-26.41-86.13-45.44-134.85-59.72-4.76-1.39-9.51-2.79-14.11-4.1-59.31-16.98-107.95-23.38-116.4-24.44-.25,0-.49-.08-.66-.08-.41-.08-.57-.08-.57-.08h-.08l-1.07-.16c-36.67-5.91-73.33-10.5-108.93-14.93l-84.41-11.57c63.41.08,126.9,1.64,190.47,4.27l69.23,3.44,101.88,5.09c21.41,1.23,42.82,2.46,64.23,3.77.08-.08.16,0,.16,0,9.43.57,18.95,1.15,28.38,1.72,2.79,1.48,5.58,2.95,8.28,4.59l50.69,33.8,5.25,3.53c.98.66,1.97,1.31,2.95,2.05,19.28,15.09,37.49,31.66,54.63,49.54,2.13,2.21,4.18,4.43,6.15,6.64,13.45,14.44,26.08,29.61,37.98,45.28,0,0,.16.08.16.16.98,1.56,1.97,3.12,2.95,4.68h.08l16.65,23.13.25.41c3.12,4.59,6.15,9.27,9.11,13.94.41,5.58.82,11.07,1.23,16.65.08.98.16,1.89.16,2.87v.41l7.14,237.06,5.17,172.01Z" />
      <path d="M790.41,984.45c69.93,4.46,143.81,27.49,185.48,83.83,41.84,56.55,42.11,132.64,40.66,202.97-4.45,215-8.91,430-13.36,645,22.63-209.8,45.82-422.27,102.71-626.05,12.31-44.11,27.02-89.06,56.78-123.87,51.38-60.11,135.64-77.72,213.52-91.43,190.99-33.62,382.44-65.22,575.14-86.99l-786.13-3.11c-56.67-7.52-114.02-30.42-149.11-75.54-35.82-46.05-43.41-108.03-41.58-166.34l10.22-659.18c-22.59,170.03-42.62,340.63-74.84,509.19-11.73,61.34-26.34,125.06-58.72,177.35-9.05,14.61-19.48,28.32-31.62,40.84-65.36,67.41-165.08,85.35-257.85,99.84-170.85,26.67-341.65,55.46-513.04,75.86l741.76-2.38Z" />
      <path d="M1031.53,312.17v-.33l.16.49,20.75,132.47v.08l11.89,76.2c2.54,11.98,5.25,23.95,8.12,35.93l.33,1.15c.74,3.2,1.56,6.32,2.38,9.51v.08c4.92,19.6,10.25,39.13,16.32,58.49,5.99,29.2,16,56.93,29.45,82.52,9.1,17.39,19.77,33.8,31.91,49.05,1.72,2.21,3.45,4.35,5.17,6.48,7.46,9.43,15.5,18.21,23.95,26.33,1.64,1.64,3.28,3.28,5,4.92.25.33.57.57.9.9,3.03,2.87,6.15,5.74,9.35,8.45,9.35,8.2,19.36,15.83,29.94,22.97,2.13,1.48,4.27,2.95,6.48,4.27,40.19,26.41,86.13,45.44,134.85,59.72,4.76,1.39,9.51,2.79,14.11,4.1,59.31,16.98,107.95,23.38,116.4,24.44.25,0,.49.08.66.08.41.08.57.08.57.08h.08l1.07.16c36.67,5.91,73.33,10.5,108.93,14.93l84.41,11.57c-63.41-.08-126.9-1.64-190.47-4.27l-69.23-3.44-101.88-5.09c-21.41-1.23-42.82-2.46-64.23-3.77-.08.08-.16,0-.16,0-9.43-.57-18.95-1.15-28.38-1.72-2.79-1.48-5.58-2.95-8.28-4.59l-50.69-33.8-5.25-3.53c-.98-.66-1.97-1.31-2.95-2.05-19.28-15.09-37.49-31.66-54.63-49.54-2.13-2.21-4.18-4.43-6.15-6.64-13.45-14.44-26.08-29.61-37.98-45.28,0,0-.16-.08-.16-.16-.98-1.56-1.97-3.12-2.95-4.68h-.08l-16.65-23.13-.25-.41c-3.12-4.59-6.15-9.27-9.11-13.94-.41-5.58-.82-11.07-1.23-16.65-.08-.98-.16-1.89-.16-2.87v-.41l-7.14-237.06-5.17-172.01Z" />
    </svg>
  );
}

// Ícone do CRM, o mesmo do menu da VulcanOS (IconCRM em vulcanos-app/src/components/icons.tsx).
function IconeDoCRM({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4.5 3.5v-3.5h-2.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
      <path d="M8 10h8" />
      <path d="M8 13h5" />
    </svg>
  );
}
