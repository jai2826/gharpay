// One store for both modes. Every write appends to the lead's timeline.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { BATCH_SIZE, HANDLERS, ROUNDS } from "./types";
import type { Batch, CapturedRow, FlowLead, Mode, Qualification, Temp } from "./types";
import { seedCapturedRows, seedLeads } from "./seed";
import { JOURNEY, currentStep } from "./journey";
import { canonicalCustomerId } from "@/lib/canonical/customer-id";

// GHARPAY_TODO: Added Toast and Supabase Client
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const now = () => new Date().toISOString();
const DAY = 86_400_000;

export const daysOld = (isoDate: string) => Math.floor((Date.now() - +new Date(isoDate)) / DAY);

export function autoTemp(l: FlowLead): Temp {
  if (l.tempReason && l.temp) return l.temp;
  const moveIn = l.f?.moveIn ?? l.q.moveIn;
  const when = l.f?.when ?? l.q.when;
  const soon = moveIn ? +new Date(moveIn) - Date.now() < 20 * DAY : false;
  if (when === "NOW" || when === "TODAY" || soon) return "HOT";
  if (daysOld(l.lastActivityAt) >= 5 || when === "FUTURE") return "COLD";
  return "HOT";
}

interface State {
  mode: Mode;
  me: string;
  round: number;
  rows: CapturedRow[];
  leads: FlowLead[];
  batches: Batch[];

  setMode: (m: Mode) => void;
  setMe: (name: string) => void;
  setRound: (r: number) => void;

  /** bring a customer from another view (Movement OS etc.) into the booking flow */
  ensureLead: (input: { name: string; phone: string; lastMessage?: string; source?: string }) => string;

  // capture
  addRow: (rowId: string) => void;
  mergeRow: (rowId: string) => void;
  ignoreRow: (rowId: string) => void;
  addAllNew: () => number;
  resetCapture: () => void;

  // batches
  buildBatch: (handler: string, round: number) => Batch | undefined;
  buildAllRounds: () => number;
  closeBatch: (batchId: string, note: string) => void;
  reopenBatch: (batchId: string) => void;
  stuckCount: () => number;

  // qualification (legacy short flow, kept for compatibility)
  answer: (leadId: string, key: keyof Qualification, value: string) => void;
  finishQualification: (leadId: string, nextAction: string, nextActionAt: string) => void;

  // the journey
  answerStep: (leadId: string, stepKey: string, values: Record<string, string>) => void;
  setNext: (leadId: string, nextAction: string, nextActionAt: string) => void;
  logActivity: (leadId: string, activity: string, note?: string) => void;
  editFields: (leadId: string, values: Record<string, string>, reason: string, stepKey?: string) => void;
  claim: (leadId: string) => void;
  toggleLabel: (leadId: string, label: string) => void;

  // expert powers
  setTemp: (leadId: string, temp: Temp, reason: string) => void;
  reassign: (leadId: string, handler: string) => void;
  moveStage: (leadId: string, stage: string, reason: string) => void;
  bulk: (leadIds: string[], patch: { handler?: string; nextAction?: string; nextActionAt?: string; temp?: Temp; escalate?: boolean }, reason: string) => void;
  escalate: (leadId: string, reason: string) => void;
  reset: () => void;
}

const ev = (actor: string, label: string, detail?: string) => ({ at: now(), actor, label, detail });

export const useBookingFlow = create<State>()(
  persist(
    (set, get) => ({
      mode: "GUIDED",
      me: HANDLERS[0],
      round: 1,
      rows: seedCapturedRows(),
      leads: seedLeads(),
      batches: [],

      setMode: (mode) => set({ mode }),
      setMe: (me) => set({ me }),
      setRound: (round) => set({ round }),

      ensureLead: ({ name, phone, lastMessage, source }) => {
        const s = get();
        const canonicalId = canonicalCustomerId({ phone, name });
        const found = s.leads.find((lead) =>
          (lead.canonicalId || canonicalCustomerId({ phone: lead.phone, name: lead.name })) === canonicalId,
        );
        if (found) {
          if (!found.canonicalId) set({ leads: s.leads.map((lead) => lead.id === found.id ? { ...lead, canonicalId } : lead) });
          return found.id;
        }
        if (!canonicalId) return "";
        const lead: FlowLead = {
          id: canonicalId,
          canonicalId,
          name: name || phone,
          phone,
          waAccount: "Gharpayy Sales 01",
          lastMessage: lastMessage || "Opened from " + (source || "another view"),
          lastActivityAt: now(),
          unread: 0,
          labels: [],
          stage: "WHERE",
          q: {},
          f: {},
          lastEvidenceAt: now(),
          events: [ev("System", `Opened in Booking Flow from ${source || "another view"}`)],
        };
        set({ leads: [lead, ...s.leads] });
        return lead.id;
      },

      addRow: (rowId) =>
        set((s) => {
          const row = s.rows.find((r) => r.id === rowId);
          if (!row || row.status !== "NEW") return s;
          const lead: FlowLead = {
            id: canonicalCustomerId({ phone: row.phone, name: row.name }) || `bf-new-${row.id}`,
            canonicalId: canonicalCustomerId({ phone: row.phone, name: row.name }) || undefined,
            name: row.name,
            phone: row.phone,
            waAccount: "Gharpayy Sales 01",
            lastMessage: row.lastMessage,
            lastActivityAt: now(),
            unread: row.unread,
            labels: row.labels,
            stage: "WHERE",
            q: {},
            f: { captured: "YES" },
            lastEvidenceAt: now(),
            events: [ev("Draft Vision", "Added to CRM from screenshot", row.screenshot)],
          };
          return {
            leads: [lead, ...s.leads],
            rows: s.rows.map((r) => (r.id === rowId ? { ...r, status: "ADDED", leadId: lead.id } : r)),
          };
        }),

      mergeRow: (rowId) =>
        set((s) => {
          const row = s.rows.find((r) => r.id === rowId);
          if (!row) return s;
          const match = s.leads.find((l) => l.name.toLowerCase() === row.name.toLowerCase());
          if (!match) return s;
          return {
            rows: s.rows.map((r) => (r.id === rowId ? { ...r, status: "MERGED", leadId: match.id } : r)),
            leads: s.leads.map((l) =>
              l.id === match.id
                ? {
                    ...l,
                    lastMessage: row.lastMessage,
                    lastActivityAt: now(),
                    events: [...l.events, ev("Draft Vision", "New messages merged into existing customer", row.screenshot)],
                  }
                : l,
            ),
          };
        }),

      ignoreRow: (rowId) => set((s) => ({ rows: s.rows.map((r) => (r.id === rowId ? { ...r, status: "IGNORED" } : r)) })),

      addAllNew: () => {
        const ids = get().rows.filter((r) => r.status === "NEW").map((r) => r.id);
        ids.forEach((id) => get().addRow(id));
        return ids.length;
      },

      resetCapture: () => set({ rows: seedCapturedRows() }),

      buildBatch: (handler, round) => {
        const s = get();
        const existing = s.batches.find((b) => b.handler === handler && b.round === round);
        if (existing) return existing;
        const pool = s.leads
          .filter((l) => !l.batchId && !l.qualifiedAt && daysOld(l.lastActivityAt) <= 7)
          .sort((a, b) => +new Date(a.lastActivityAt) - +new Date(b.lastActivityAt))
          .slice(0, BATCH_SIZE);
        if (pool.length === 0) return undefined;
        const batch: Batch = {
          id: `batch-${handler}-${round}`,
          handler,
          round,
          createdAt: now(),
          leadIds: pool.map((l) => l.id),
        };
        const ids = new Set(batch.leadIds);
        set({
          batches: [...s.batches, batch],
          leads: s.leads.map((l) =>
            ids.has(l.id)
              ? { ...l, batchId: batch.id, handler, round, owner: handler, events: [...l.events, ev("System", `Given to ${handler} — round ${round}`)] }
              : l,
          ),
        });
        return batch;
      },

      buildAllRounds: () => {
        let made = 0;
        ROUNDS.forEach((round) => {
          HANDLERS.forEach((h) => {
            const before = get().batches.length;
            get().buildBatch(h, round);
            if (get().batches.length > before) made += 1;
          });
        });
        return made;
      },

      closeBatch: (batchId, note) =>
        set((s) => {
          const batch = s.batches.find((b) => b.id === batchId);
          if (!batch) return s;
          const ids = new Set(batch.leadIds);
          return {
            batches: s.batches.map((b) => (b.id === batchId ? { ...b, closedAt: now(), closeNote: note } : b)),
            leads: s.leads.map((l) =>
              ids.has(l.id)
                ? { ...l, events: [...l.events, ev(s.me, `Draft D${batch.round} closed`, note || undefined)] }
                : l,
            ),
          };
        }),

      reopenBatch: (batchId) =>
        set((s) => ({
          batches: s.batches.map((b) => (b.id === batchId ? { ...b, closedAt: undefined, closeNote: undefined } : b)),
        })),

      stuckCount: () => get().leads.filter((l) => !l.qualifiedAt && daysOld(l.lastActivityAt) > 7).length,

      answer: (leadId, key, value) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === leadId
              ? { ...l, q: { ...l.q, [key]: value }, events: [...l.events, ev(s.me, `${key} answered`, value)] }
              : l,
          ),
        })),

      finishQualification: (leadId, nextAction, nextActionAt) =>
        set((s) => ({
          leads: s.leads.map((l) => {
            if (l.id !== leadId) return l;
            const ack = l.q.ack;
            const stage = ack === "NOT_REAL" ? "CLOSED" : ack === "NEED_HELP" ? "CONTROL_TOWER" : "QUALIFIED";
            return {
              ...l,
              owner: l.owner ?? s.me,
              stage,
              nextAction,
              nextActionAt,
              qualifiedAt: now(),
              escalated: ack === "NEED_HELP",
              closedReason: ack === "NOT_REAL" ? l.q.blocker || "Not a real lead" : undefined,
              temp: l.tempReason ? l.temp : autoTemp({ ...l }),
              events: [
                ...l.events,
                ev(s.me, `Qualification finished — ${stage.toLowerCase().replace("_", " ")}`, `${nextAction} by ${new Date(nextActionAt).toLocaleString()}`),
              ],
            };
          }),
        })),

      answerStep: (leadId, stepKey, values) =>
        set((s) => {
          const step = JOURNEY.find((j) => j.key === stepKey);
          if (!step) return s;
          const chosen = values[step.field];
          const opt = step.options?.find((o) => o.value === chosen);
          return {
            leads: s.leads.map((l) => {
              if (l.id !== leadId) return l;
              const f = { ...l.f, ...values };
              const next = currentStep(f);
              const escalate = opt?.effect === "ESCALATE";
              const close = opt?.effect === "CLOSE";
              const owner = stepKey === "OWN" && chosen === "OWN" ? s.me : l.owner;
              return {
                ...l,
                f,
                owner,
                handler: owner ?? l.handler,
                ownedAt: stepKey === "OWN" && chosen === "OWN" ? now() : l.ownedAt,
                stage: close ? "CLOSED" : next ? next.key : "SETTLED",
                escalated: escalate ? true : l.escalated,
                closedReason: close ? (values["ownershipNote"] || opt?.label || "Closed") : l.closedReason,
                lastActionAt: now(),
                qualifiedAt: stepKey === "INTENT" ? now() : l.qualifiedAt,
                temp: l.tempReason ? l.temp : autoTemp({ ...l, f }),
                events: [
                  ...l.events,
                  {
                    ...ev(s.me, step.title, opt ? opt.label : Object.values(values).filter(Boolean).join(" · ")),
                    stepKey,
                    changes: Object.entries(values).map(([field, to]) => ({ field, from: l.f?.[field] ?? "", to })),
                  },
                  ...(escalate ? [ev(s.me, "Sent to Control Tower", values["ownershipNote"] || opt?.label)] : []),
                  ...(close ? [ev(s.me, "Journey closed", opt?.label)] : []),
                ],
              };
            }),
          };
        }),

      setNext: (leadId, nextAction, nextActionAt) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === leadId
              ? {
                  ...l,
                  nextAction,
                  nextActionAt,
                  lastActionAt: now(),
                  events: [...l.events, ev(s.me, "Next step locked", `${nextAction} by ${new Date(nextActionAt).toLocaleString()}`)],
                }
              : l,
          ),
        })),

      logActivity: (leadId, activity, note) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === leadId
              ? {
                  ...l,
                  lastActionAt: now(),
                  events: [...l.events, ev(s.me, activity, note?.trim() || undefined)],
                }
              : l,
          ),
        })),

      editFields: (leadId, values, reason, stepKey) =>
        set((s) => ({
          leads: s.leads.map((l) => {
            if (l.id !== leadId) return l;
            const changes = Object.entries(values).map(([field, to]) => ({ field, from: l.f?.[field] ?? "", to }));
            return {
              ...l,
              f: { ...l.f, ...values },
              lastActionAt: now(),
              events: [
                ...l.events,
                {
                  ...ev(s.me, "Answer edited", `${changes.map((c) => `${c.field}: ${c.from || "empty"} → ${c.to}`).join(" · ")}${reason ? ` — ${reason}` : ""}`),
                  stepKey,
                  changes,
                },
              ],
            };
          }),
        })),

      claim: (leadId) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === leadId && !l.owner
              ? { ...l, owner: s.me, handler: s.me, ownedAt: now(), events: [...l.events, ev(s.me, "Took ownership")] }
              : l,
          ),
        })),

      toggleLabel: (leadId, label) =>
        set((s) => ({
          leads: s.leads.map((l) => {
            if (l.id !== leadId) return l;
            const on = l.labels.includes(label);
            return {
              ...l,
              labels: on ? l.labels.filter((x) => x !== label) : [...l.labels, label],
              events: [...l.events, ev(s.me, on ? `Label removed — ${label}` : `Label added — ${label}`)],
            };
          }),
        })),

      setTemp: (leadId, temp, reason) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === leadId ? { ...l, temp, tempReason: reason, events: [...l.events, ev(s.me, `Forced ${temp.toLowerCase()}`, reason)] } : l,
          ),
        })),

      reassign: (leadId, handler) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === leadId ? { ...l, handler, owner: handler, events: [...l.events, ev(s.me, `Owner changed to ${handler}`)] } : l,
          ),
        })),

      moveStage: (leadId, stage, reason) =>
        set((s) => ({
          leads: s.leads.map((l) => (l.id === leadId ? { ...l, stage, events: [...l.events, ev(s.me, `Moved to ${stage}`, reason)] } : l)),
        })),

      bulk: (leadIds, patch, reason) =>
        set((s) => {
          const ids = new Set(leadIds);
          return {
            leads: s.leads.map((l) =>
              ids.has(l.id)
                ? {
                    ...l,
                    ...(patch.handler ? { handler: patch.handler, owner: patch.handler } : {}),
                    ...(patch.nextAction ? { nextAction: patch.nextAction } : {}),
                    ...(patch.nextActionAt ? { nextActionAt: patch.nextActionAt } : {}),
                    ...(patch.temp ? { temp: patch.temp, tempReason: reason } : {}),
                    ...(patch.escalate ? { escalated: true, stage: "CONTROL_TOWER" } : {}),
                    events: [...l.events, ev(s.me, "Bulk action applied", reason)],
                  }
                : l,
            ),
          };
        }),

      escalate: (leadId, reason) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === leadId
              ? { ...l, escalated: true, stage: "CONTROL_TOWER", events: [...l.events, ev(s.me, "Sent to Control Tower", reason)] }
              : l,
          ),
        })),

      reset: () => set({ rows: seedCapturedRows(), leads: seedLeads(), batches: [] }),
    }),
    { name: "gharpayy-booking-flow-v2", version: 2 },
  ),
);


/*
GHARPAY_TODO: 
The following code is used for syncing the booking flow data with a remote database using Supabase. 
It includes functions to queue changes, flush them to the database, and hydrate the local state with remote data.
The code also handles potential conflicts between local and remote data, ensuring that the most recent changes are preserved.
*/ 


const db = () => supabase as unknown as { from: (t: string) => any };
const TABLE = "booking_flow_records";
type Kind = "lead" | "batch";

const pending = new Map<string, { kind: Kind; id: string; data: FlowLead | Batch }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let applyingRemote = false;

async function flush() {
  flushTimer = null;
  const rows = [...pending.values()].map((p) => ({ kind: p.kind, id: p.id, data: p.data, updated_at: new Date().toISOString() }));
  pending.clear();
  try {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db().from(TABLE).upsert(rows.slice(i, i + 200), { onConflict: "kind,id" });
      if (error) throw error;
    }
  } catch (e) {
    toast.warning(`Saved on this device — not synced yet: ${(e as Error).message}`);
  }
}
function queue(kind: Kind, item: FlowLead | Batch) {
  pending.set(`${kind}:${item.id}`, { kind, id: item.id, data: item });
  if (!flushTimer) flushTimer = setTimeout(() => void flush(), 600); // batches rapid edits into one save
}

const batchRank = (b: Batch) => (b.closedAt ? 1000 : 0) + b.leadIds.length;

export async function hydrateBookingFlow() {
  try {
    const { data, error } = await db().from(TABLE).select("kind,id,data");
    if (error) throw error;
    const rows = (data ?? []) as { kind: Kind; id: string; data: any }[];
    const remoteLeads = rows.filter((r) => r.kind === "lead").map((r) => r.data as FlowLead);
    const remoteBatches = rows.filter((r) => r.kind === "batch").map((r) => r.data as Batch);
    const s = useBookingFlow.getState();

    // a copy with more timeline events is the newer one; ties go to the shared copy
    const pushLeads: FlowLead[] = [];
    const remoteLeadById = new Map(remoteLeads.map((l) => [l.id, l]));
    const leads = s.leads.map((l) => {
      const r = remoteLeadById.get(l.id);
      if (!r || l.events.length > r.events.length) { pushLeads.push(l); return l; }
      return r;
    });
    const localLeadIds = new Set(s.leads.map((l) => l.id));
    remoteLeads.forEach((r) => { if (!localLeadIds.has(r.id)) leads.push(r); });

    const pushBatches: Batch[] = [];
    const remoteBatchById = new Map(remoteBatches.map((b) => [b.id, b]));
    const batches = s.batches.map((b) => {
      const r = remoteBatchById.get(b.id);
      if (!r || batchRank(b) > batchRank(r)) { pushBatches.push(b); return b; }
      return r;
    });
    const localBatchIds = new Set(s.batches.map((b) => b.id));
    remoteBatches.forEach((r) => { if (!localBatchIds.has(r.id)) batches.push(r); });

    applyingRemote = true;
    useBookingFlow.setState({ leads, batches });
    applyingRemote = false;
    pushLeads.forEach((l) => queue("lead", l));
    pushBatches.forEach((b) => queue("batch", b));
  } catch (e) {
    console.error("[booking-flow] hydrate failed", e);
  }
}

if (typeof window !== "undefined") {
  // every change to a lead or batch is queued for the database
  useBookingFlow.subscribe((s, prev) => {
    if (applyingRemote) return;
    if (s.leads !== prev.leads) {
      const before = new Map(prev.leads.map((l) => [l.id, l]));
      s.leads.forEach((l) => { if (before.get(l.id) !== l) queue("lead", l); });
    }
    if (s.batches !== prev.batches) {
      const before = new Map(prev.batches.map((b) => [b.id, b]));
      s.batches.forEach((b) => { if (before.get(b.id) !== b) queue("batch", b); });
    }
  });
  setTimeout(() => void hydrateBookingFlow(), 0);
  setInterval(() => void hydrateBookingFlow(), 15000); // pick up other devices' changes
}
