"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import DraggableWidgetGrid, { type WidgetItem } from "@/components/ui/draggable-widget-grid";
import { useIdioma, useT } from "@/lib/i18n/IdiomaProvider";

import type { DadosPainel } from "../_dados";

/**
 * O Painel: a operação do dia numa tela só, com cada número levando à tela de
 * onde ele vem. Nada aqui decide ou grava — os dados chegam prontos do servidor.
 *
 * A ordem dos widgets é preferência POR NAVEGADOR (localStorage), como os grupos
 * fechados do Sidebar: começa na ordem padrão e só muda depois da hidratação.
 *
 * O grid bloqueia clique em link enquanto dá para arrastar, por isso o arraste
 * só liga no modo "Organizar" — fora dele, os links dos widgets funcionam.
 */

const WIDGETS: WidgetItem[] = [
  { id: "conversas", size: "wide", label: "Conversas" },
  { id: "funil", size: "lg", label: "Funil" },
  { id: "tarefas", size: "tall", label: "Tarefas" },
  { id: "leads", size: "wide", label: "Leads novos" },
  { id: "mes", size: "wide", label: "Fechados no mês" },
  { id: "agenda", size: "wide", label: "Agenda de hoje" },
  { id: "conexoes", size: "wide", label: "WhatsApp" },
];

type Tom = "ok" | "atencao" | "erro" | "neutro";
const PONTO: Record<Tom, string> = {
  ok: "bg-success",
  atencao: "bg-warning",
  erro: "bg-error",
  neutro: "bg-muted-foreground/40",
};

/* ------------------------------------------------------------------ *
 * Peças
 * ------------------------------------------------------------------ */

function Moldura({
  titulo,
  meta,
  href,
  children,
}: {
  titulo: string;
  meta?: ReactNode;
  href?: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <section className="@container flex h-full flex-col gap-3 p-4 sm:p-5">
      {/* leading-5 e não leading-none: com `truncate`, a linha justa corta o
          acento das maiúsculas ("CONTEUDO"). */}
      <header className="flex items-center justify-between gap-3 text-[13px] leading-5">
        <h2 className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {titulo}
        </h2>
        <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
          {meta}
          {href && (
            <Link href={href} className="transition hover:text-foreground" aria-label={`${t("Abrir")} ${titulo}`}>
              ↗
            </Link>
          )}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

function Numero({ children, unidade }: { children: ReactNode; unidade?: string }) {
  return (
    <p className="text-[28px] font-semibold leading-none tracking-tight text-foreground tabular-nums @[240px]:text-[32px]">
      {children}
      {unidade && (
        <span className="text-[12px] font-normal tracking-normal text-muted-foreground">
          {" "}
          {unidade}
        </span>
      )}
    </p>
  );
}

function Ponto({ tom }: { tom: Tom }) {
  return <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${PONTO[tom]}`} />;
}

function Linha({ children, valor }: { children: ReactNode; valor: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <dt className="flex min-w-0 items-center gap-2 truncate text-foreground">{children}</dt>
      <dd className="ml-auto shrink-0 text-muted-foreground tabular-nums">{valor}</dd>
    </div>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="mt-auto text-[13px] text-muted-foreground">{children}</p>;
}

function useFormatos(d: DadosPainel) {
  const idioma = useIdioma();
  const dinheiro = new Intl.NumberFormat(idioma, {
    style: "currency",
    currency: d.moeda,
    notation: "compact",
    maximumFractionDigits: 1,
  });
  return {
    dinheiro: (cents: number) => dinheiro.format(cents / 100),
    hora: (iso: string) =>
      new Intl.DateTimeFormat(idioma, { hour: "2-digit", minute: "2-digit", timeZone: d.fuso }).format(new Date(iso)),
    dia: (iso: string) =>
      new Intl.DateTimeFormat(idioma, { day: "2-digit", month: "2-digit", timeZone: d.fuso }).format(new Date(iso)),
    diaSemana: (dia: string) =>
      new Intl.DateTimeFormat(idioma, { weekday: "short", day: "numeric", timeZone: "UTC" }).format(
        new Date(`${dia}T12:00:00Z`),
      ),
  };
}

/* ------------------------------------------------------------------ *
 * Widgets
 * ------------------------------------------------------------------ */

function Conversas({ d }: { d: DadosPainel }) {
  const t = useT();
  const c = d.conversas;
  return (
    <Moldura titulo={t("Conversas")} href="/app/inbox">
      <Numero unidade={t("em andamento")}>{c.ativas}</Numero>
      <dl className="mt-auto grid grid-cols-1 gap-x-6 gap-y-1.5 @[420px]:grid-cols-3">
        <Linha valor={c.naFila}>
          <Ponto tom={c.naFila > 0 ? "atencao" : "neutro"} />
          {t("Na fila")}
        </Linha>
        <Linha valor={c.comIa}>
          <Ponto tom="ok" />
          {t("Com a IA")}
        </Linha>
        <Linha valor={c.minhas}>
          <Ponto tom="neutro" />
          {t("Comigo")}
        </Linha>
      </dl>
    </Moldura>
  );
}

function Funil({ d }: { d: DadosPainel }) {
  const t = useT();
  const f = useFormatos(d);
  const maior = Math.max(1, ...d.funil.etapas.map((e) => e.leads));
  return (
    <Moldura titulo={d.funil.nome ?? t("Funil")} href="/app/kanban">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Numero unidade={t("em aberto")}>{d.funil.abertos}</Numero>
        {d.funil.valorAbertoCents > 0 && (
          <span className="text-[13px] text-muted-foreground tabular-nums">{f.dinheiro(d.funil.valorAbertoCents)}</span>
        )}
      </div>
      {d.funil.etapas.length === 0 ? (
        <Vazio>{t("Nenhum funil criado ainda.")}</Vazio>
      ) : (
        <table className="mt-auto w-full table-fixed text-[13px]">
          <caption className="sr-only">{t("Leads em aberto por etapa do funil")}</caption>
          <tbody>
            {d.funil.etapas.slice(0, 7).map((e, i) => (
              <tr key={e.id}>
                <th
                  scope="row"
                  className="w-[38%] truncate py-[5px] pr-3 text-left font-normal text-foreground"
                  title={e.nome}
                >
                  {e.nome}
                </th>
                <td className="py-[5px]">
                  <span aria-hidden="true" className="block h-[4px] rounded-full bg-foreground/10">
                    <span
                      className={`block h-full rounded-full ${i === 0 ? "bg-accent" : "bg-foreground/30"}`}
                      style={{ width: `${e.leads > 0 ? Math.max(3, (e.leads / maior) * 100) : 0}%` }}
                    />
                  </span>
                </td>
                <td className="w-[44px] py-[5px] text-right text-foreground tabular-nums">{e.leads}</td>
                <td className="hidden w-[72px] py-[5px] text-right text-muted-foreground tabular-nums @[380px]:table-cell">
                  {e.valorCents > 0 ? f.dinheiro(e.valorCents) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Moldura>
  );
}

function Leads({ d }: { d: DadosPainel }) {
  const t = useT();
  const f = useFormatos(d);
  const total = d.leadsPorDia.reduce((a, x) => a + x.total, 0);
  const maior = Math.max(1, ...d.leadsPorDia.map((x) => x.total));
  const hoje = d.leadsPorDia[d.leadsPorDia.length - 1]?.total ?? 0;
  return (
    <Moldura titulo={t("Leads novos")} meta={t("14 dias")} href="/app/kanban">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Numero>{total}</Numero>
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {hoje} {t("hoje")}
        </span>
      </div>
      <div
        role="img"
        aria-label={`${t("Leads novos por dia nos últimos 14 dias")}: ${d.leadsPorDia.map((x) => x.total).join(", ")}`}
        className="mt-auto flex h-14 items-end gap-[3px]"
      >
        {d.leadsPorDia.map((x, i) => (
          <span
            key={x.dia}
            title={`${f.diaSemana(x.dia)} · ${x.total}`}
            className={`flex-1 rounded-t-[3px] ${
              i === d.leadsPorDia.length - 1 ? "bg-accent" : x.total > 0 ? "bg-foreground/25" : "bg-foreground/[0.07]"
            }`}
            style={{ height: x.total > 0 ? `${Math.max(8, (x.total / maior) * 100)}%` : "4px" }}
          />
        ))}
      </div>
    </Moldura>
  );
}

function Mes({ d }: { d: DadosPainel }) {
  const t = useT();
  const f = useFormatos(d);
  const m = d.mes;
  const fechados = m.ganhos + m.perdidos;
  return (
    <Moldura titulo={t("Fechados no mês")} href="/app/metrics">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Numero unidade={t("ganhos")}>{m.ganhos}</Numero>
        {m.valorGanhoCents > 0 && (
          <span className="text-[13px] text-muted-foreground tabular-nums">{f.dinheiro(m.valorGanhoCents)}</span>
        )}
      </div>
      <dl className="mt-auto grid grid-cols-1 gap-x-6 gap-y-1.5 @[420px]:grid-cols-2">
        <Linha valor={m.perdidos}>
          <Ponto tom="neutro" />
          {t("Perdidos")}
        </Linha>
        <Linha valor={fechados > 0 ? `${Math.round((m.ganhos / fechados) * 100)}%` : "—"}>
          <Ponto tom="ok" />
          {t("Taxa de ganho")}
        </Linha>
      </dl>
    </Moldura>
  );
}

function Tarefas({ d }: { d: DadosPainel }) {
  const t = useT();
  const f = useFormatos(d);
  const x = d.tarefas;
  return (
    <Moldura titulo={t("Tarefas")} href="/app/tasks">
      <Numero unidade={t("em aberto")}>{x.abertas}</Numero>
      <dl className="mt-4 flex flex-col gap-1.5">
        <Linha valor={x.atrasadas}>
          <Ponto tom={x.atrasadas > 0 ? "erro" : "neutro"} />
          {t("Atrasadas")}
        </Linha>
        <Linha valor={x.hoje}>
          <Ponto tom={x.hoje > 0 ? "atencao" : "neutro"} />
          {t("Para hoje")}
        </Linha>
        <Linha valor={x.minhas}>
          <Ponto tom="neutro" />
          {t("Comigo")}
        </Linha>
      </dl>
      {x.proximas.length > 0 && (
        <ol className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
          {x.proximas.map((p) => (
            <li key={p.id} className="min-w-0 text-[13px]">
              <span className="block truncate text-foreground">{p.titulo}</span>
              {p.prazo && <span className="text-[11px] text-muted-foreground tabular-nums">{f.dia(p.prazo)}</span>}
            </li>
          ))}
        </ol>
      )}
    </Moldura>
  );
}

function Agenda({ d }: { d: DadosPainel }) {
  const t = useT();
  const f = useFormatos(d);
  return (
    <Moldura titulo={t("Agenda de hoje")} href="/app/agenda">
      {d.agenda.length === 0 ? (
        <>
          <Numero>0</Numero>
          <Vazio>{t("Nenhum compromisso marcado para hoje.")}</Vazio>
        </>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {d.agenda.slice(0, 4).map((a) => (
            <li key={a.id} className="flex items-center gap-3 text-[13px]">
              <span className="w-12 shrink-0 text-muted-foreground tabular-nums">{f.hora(a.inicio)}</span>
              <Ponto tom={a.status === "confirmed" ? "ok" : "atencao"} />
              <span className="min-w-0 flex-1 truncate text-foreground">{a.titulo}</span>
              <span className="hidden shrink-0 text-[11px] text-muted-foreground @[380px]:inline">
                {a.status === "confirmed" ? t("Confirmado") : t("A confirmar")}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Moldura>
  );
}

function Conexoes({ d }: { d: DadosPainel }) {
  const t = useT();
  const conectadas = d.conexoes.filter((c) => c.status === "WORKING").length;
  return (
    <Moldura titulo={t("WhatsApp")} href="/app/connections">
      <Numero unidade={t("conectados")}>
        {conectadas}/{d.conexoes.length}
      </Numero>
      {d.conexoes.length === 0 ? (
        <Vazio>{t("Nenhum número conectado ainda.")}</Vazio>
      ) : (
        <dl className="mt-auto flex flex-col gap-1.5">
          {d.conexoes.slice(0, 3).map((c) => {
            const ok = c.status === "WORKING";
            const iniciando = c.status === "STARTING" || c.status === "SCAN_QR_CODE";
            return (
              <Linha key={c.id} valor={ok ? t("Conectado") : iniciando ? t("Conectando") : t("Desconectado")}>
                <Ponto tom={ok ? "ok" : iniciando ? "atencao" : "erro"} />
                <span className="truncate">{c.nome}</span>
              </Linha>
            );
          })}
        </dl>
      )}
    </Moldura>
  );
}

const VIEWS: Record<string, (p: { d: DadosPainel }) => ReactNode> = {
  conversas: Conversas,
  funil: Funil,
  tarefas: Tarefas,
  leads: Leads,
  mes: Mes,
  agenda: Agenda,
  conexoes: Conexoes,
};

/* ------------------------------------------------------------------ *
 * Ordem lembrada por navegador
 * ------------------------------------------------------------------ */

function lerOrdem(chave: string): WidgetItem[] {
  try {
    const salvo = window.localStorage.getItem(chave);
    const ids = salvo ? (JSON.parse(salvo) as unknown) : null;
    if (!Array.isArray(ids)) return WIDGETS;
    const porId = new Map(WIDGETS.map((w) => [w.id, w]));
    const ordenados: WidgetItem[] = [];
    for (const id of ids) {
      const w = typeof id === "string" ? porId.get(id) : undefined;
      if (!w) continue;
      ordenados.push(w);
      porId.delete(w.id);
    }
    // Widget que nasceu depois da ordem salva entra no fim.
    return [...ordenados, ...porId.values()];
  } catch {
    return WIDGETS;
  }
}

const semInscricao = () => () => {};

// Abaixo de 640px, duas colunas quadradas ficam estreitas demais pro texto:
// o painel vira uma coluna só.
const TELA_ESTREITA = "(max-width: 640px)";
function inscreverTela(avisar: () => void) {
  const mq = window.matchMedia(TELA_ESTREITA);
  mq.addEventListener("change", avisar);
  return () => mq.removeEventListener("change", avisar);
}

export function PainelClient({ dados, userId, orgId }: { dados: DadosPainel; userId: string; orgId: string }) {
  const t = useT();
  const chave = `painel:ordem:${orgId}:${userId}`;
  const hidratado = useSyncExternalStore(semInscricao, () => true, () => false);
  const estreita = useSyncExternalStore(inscreverTela, () => window.matchMedia(TELA_ESTREITA).matches, () => false);
  const [editando, setEditando] = useState(false);
  const [versao, setVersao] = useState(0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2 text-xs">
        {editando && (
          <>
            <span className="mr-auto text-muted-foreground">{t("Arraste os widgets para reorganizar.")}</span>
            <button
              type="button"
              onClick={() => {
                try {
                  window.localStorage.removeItem(chave);
                } catch {
                  // Storage bloqueado: só não havia nada salvo para apagar.
                }
                setVersao((v) => v + 1);
              }}
              className="rounded-full px-3 py-1.5 text-muted-foreground transition hover:text-foreground"
            >
              {t("Restaurar ordem")}
            </button>
          </>
        )}
        <button
          type="button"
          aria-pressed={editando}
          onClick={() => setEditando((e) => !e)}
          className={`rounded-full border px-3 py-1.5 transition ${
            editando
              ? "border-accent bg-accent text-accent-foreground"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {editando ? t("Concluir") : t("Organizar")}
        </button>
      </div>

      {hidratado ? (
        <DraggableWidgetGrid
          key={versao}
          items={lerOrdem(chave)}
          onChange={(novos) => {
            try {
              window.localStorage.setItem(chave, JSON.stringify(novos.map((w) => w.id)));
            } catch {
              // Aba privada: a ordem vale só até recarregar.
            }
          }}
          editable={editando}
          renderItem={(item) => {
            const View = VIEWS[item.id];
            return View ? <View d={dados} /> : null;
          }}
          maxColumns={estreita ? 1 : 4}
          cellSize={240}
          gap={12}
          radius={16}
        />
      ) : (
        <div className="grid min-h-[480px] grid-cols-2 gap-3 md:grid-cols-4" aria-hidden="true">
          {WIDGETS.map((w) => (
            <div
              key={w.id}
              className={`h-[200px] animate-pulse rounded-2xl bg-muted ${
                w.size === "wide" || w.size === "lg" ? "col-span-2" : ""
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
