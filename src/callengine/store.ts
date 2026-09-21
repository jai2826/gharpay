// Every call is stored as a full conversation record, not a status.
// Armed follow-ups cancel themselves the moment the customer moves.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CallRecord } from "./types";

// GHARPAY_TODO: Added the Types and the new Functions.
import type { Json } from "@/integrations/supabase/types";
import { fetchCallRecords, patchCallRecord, pushCallRecord, rowToRecord } from "./sync";

export interface CallEngineStore {
  records: CallRecord[];
  save: (r: CallRecord) => void;
  markSent: (id: string) => void;
  cancelFollowUps: (ulid: string, why: string) => void;
  sendFollowUp: (id: string) => void;
  /** how many times we already tried this customer without reaching them */
  noAnswerStreak: (ulid: string) => number;
  forLead: (ulid: string) => CallRecord[];
  today: () => CallRecord[];

  // GHARPAY_TODO: Added the new function to hydrate the call records from the database.
  hydrate: () => Promise<void>;
}

const sameDay = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

// GHARPAY_TODO: Added the new function to cancel the follow-ups and add a note to the capture.
const cancelNote = (r: CallRecord, why: string) =>
  [r.capture.note, `follow-up cancelled: ${why}`].filter(Boolean).join(" · ");

export const useCallEngine = create<CallEngineStore>()(
  persist(
    (set, get) => ({
      records: [],

      save: (r) => set((s) => ({ records: [r, ...s.records].slice(0, 2000) })),

      // GHARPAY_TODO: Updated- markSent, CancelFollowUps,sendFollowUp functions to patch the call record in the database when a message is sent or a follow-up is cancelled/sent.
      markSent: (id) => {
        set((s) => ({
          records: s.records.map((r) => (r.id === id ? { ...r, messageSent: true } : r)),
        }));
        void patchCallRecord(id, { message_sent: true });
      },

      cancelFollowUps: (ulid, why) => {
        const hit = get().records.filter((r) => r.ulid === ulid && r.followUpState === "armed");
        if (!hit.length) return;
        set((s) => ({
          records: s.records.map((r) =>
            r.ulid === ulid && r.followUpState === "armed"
              ? {
                  ...r,
                  followUpState: "cancelled",
                  capture: { ...r.capture, note: cancelNote(r, why) },
                }
              : r,
          ),
        }));
        hit.forEach(
          (r) =>
            void patchCallRecord(r.id, {
              follow_up_state: "cancelled",
              capture: { ...r.capture, note: cancelNote(r, why) } as unknown as Json,
            }),
        );
      },

      sendFollowUp: (id) => {
        set((s) => ({
          records: s.records.map((r) => (r.id === id ? { ...r, followUpState: "sent" } : r)),
        }));
        void patchCallRecord(id, { follow_up_state: "sent" });
      },

      noAnswerStreak: (ulid) => {
        let n = 0;
        for (const r of get().records.filter((r) => r.ulid === ulid)) {
          if (r.outcome === "connected") break;
          n += 1;
        }
        return n;
      },

      forLead: (ulid) => get().records.filter((r) => r.ulid === ulid),
      today: () => get().records.filter((r) => sameDay(r.ts)),

      // GHARPAY_TODO: Added the new function to hydrate the call records from the database.
      hydrate: async () => {
        try {
          const remote = (await fetchCallRecords(500)).map(rowToRecord);
          const remoteIds = new Set(remote.map((r) => r.id));
          const localOnly = get().records.filter((r) => !remoteIds.has(r.id));
          // calls made offline / before sync: push them up (skip ones still being saved right now)
          localOnly
            .filter((r) => Date.now() - new Date(r.ts).getTime() > 60_000)
            .forEach((r) => void pushCallRecord(r));
          set({
            records: [...remote, ...localOnly]
              .sort((a, b) => b.ts.localeCompare(a.ts))
              .slice(0, 2000),
          });
        } catch (e) {
          console.error("[calls] hydrate failed", e);
        }
      },
    }),
    { name: "gharpayy.call-engine.v1" },
  ),
);
