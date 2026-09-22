// Calls dashboard — why we called, what happened, and how much of it was waste.
import { useEffect, useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { useCallEngine } from "@/callengine/store";
import { MOVEMENT_LABEL, agendaDef, type MovementClass } from "@/callengine/types";
import { supabase } from "@/integrations/supabase/client";

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-xl border bg-card p-3">
    <div className="pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {title}
    </div>
    {children}
  </div>
);

const Bar = ({ label, value, total }: { label: string; value: number; total: number }) => {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1 py-1">
      <div className="flex justify-between text-[11px]">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {value} · {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full rounded bg-muted">
        <div className="h-1.5 rounded bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

export function CallIntelligence() {
  const records = useCallEngine((s) => s.records);

  // GHARPAY_TODO: Added the useEffect to hydrate the call records from the database every 15 seconds.
  useEffect(() => {
    const load = () => void useCallEngine.getState().hydrate();
    load();
    const t = setInterval(load, 15000); // refresh every 15 seconds
    return () => clearInterval(t);
  }, []);

  // GHARPAY_TODO: Added the useState and useEffect to fetch the count of overdue leads from the database.
  const [overdue, setOverdue] = useState<number | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const { count, error } = await (supabase as any)
          .from("booking_flow_records")
          .select("id", { count: "exact", head: true })
          .eq("kind", "lead")
          .lt("data->>nextActionAt", new Date().toISOString());
        if (error) throw error;
        setOverdue(count ?? 0);
      } catch {
        setOverdue(null); // table not synced yet on this build — fail quietly
      }
    })();
  }, []);

  const data = useMemo(() => {
    const today = records.filter(
      (r) => new Date(r.ts).toDateString() === new Date().toDateString(),
    );
    const connected = today.filter((r) => r.outcome === "connected");
    const byAgenda = new Map<string, number>();
    const byMovement = new Map<MovementClass, number>();
    const waste = new Map<string, number>();
    const byPerson = new Map<string, { calls: number; connected: number; movement: number }>();
    let priceQuoted = 0;
    let toursScheduled = 0;
    let liked = 0;
    let disliked = 0;

    for (const r of today) {
      byAgenda.set(r.agenda, (byAgenda.get(r.agenda) ?? 0) + 1);
      byMovement.set(r.movement, (byMovement.get(r.movement) ?? 0) + 1);
      for (const w of r.waste) waste.set(w, (waste.get(w) ?? 0) + 1);
      if (r.agendaSource === "operator")
        waste.set(
          "Agenda overridden by operator",
          (waste.get("Agenda overridden by operator") ?? 0) + 1,
        );
      if (r.capture.price) priceQuoted += 1;
      if (r.capture.tourAt) toursScheduled += 1;
      if (r.capture.reaction === "loved" || r.capture.reaction === "liked-comparing") liked += 1;
      if (r.capture.reaction === "needs-different" || r.capture.reaction === "not-interested")
        disliked += 1;
      const p = byPerson.get(r.operatorName) ?? { calls: 0, connected: 0, movement: 0 };
      p.calls += 1;
      if (r.outcome === "connected") p.connected += 1;
      if (r.movement !== "none") p.movement += 1;
      byPerson.set(r.operatorName, p);
    }
    return {
      today,
      connected,
      byAgenda,
      byMovement,
      waste,
      byPerson,
      priceQuoted,
      toursScheduled,
      liked,
      disliked,
    };
  }, [records]);

  if (data.today.length === 0)
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        No calls logged through the conversation engine today yet.
      </div>
    );

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Block title="Calls today">
        <div className="flex gap-6">
          <div>
            <div className="text-2xl font-semibold">{data.today.length}</div>
            <div className="text-[11px] text-muted-foreground">attempted</div>
          </div>
          <div>
            <div className="text-2xl font-semibold">{data.connected.length}</div>
            <div className="text-[11px] text-muted-foreground">connected</div>
          </div>
          <div>
            <div className="text-2xl font-semibold">
              {data.today.filter((r) => r.movement !== "none").length}
            </div>
            <div className="text-[11px] text-muted-foreground">moved the customer</div>
          </div>
        </div>
      </Block>

      {/* GHARPAY_TODO: I1 =It Shows overdue leads */}
      <Block title="Nothing missed today">
        <div className="text-2xl font-semibold">{overdue === null ? "—" : overdue}</div>
        <div className="text-[11px] text-muted-foreground">
          customers past their next-action deadline, right now
        </div>
      </Block>
      <Block title="What happened">
        <div className="grid grid-cols-2 gap-x-4 text-[11px]">
          <div className="flex justify-between">
            <span>Property liked</span>
            <span className="font-medium">{data.liked}</span>
          </div>
          <div className="flex justify-between">
            <span>Property rejected</span>
            <span className="font-medium">{data.disliked}</span>
          </div>
          <div className="flex justify-between">
            <span>Price quoted</span>
            <span className="font-medium">{data.priceQuoted}</span>
          </div>
          <div className="flex justify-between">
            <span>Tours scheduled</span>
            <span className="font-medium">{data.toursScheduled}</span>
          </div>
        </div>
      </Block>

      <Block title="Why were we calling">
        {[...data.byAgenda.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => (
            <Bar key={k} label={agendaDef(k as never).label} value={v} total={data.today.length} />
          ))}
      </Block>

      <Block title="Movement per conversation — not calls per person">
        {(["booking", "tour", "commercial", "property", "data", "none"] as MovementClass[]).map(
          (m) => (
            <Bar
              key={m}
              label={MOVEMENT_LABEL[m]}
              value={data.byMovement.get(m) ?? 0}
              total={data.today.length}
            />
          ),
        )}
      </Block>

      <Block title="Waste">
        {data.waste.size === 0 ? (
          <div className="text-[11px] text-muted-foreground">No wasted calls recorded today.</div>
        ) : (
          [...data.waste.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <div key={k} className="flex justify-between py-0.5 text-[11px]">
                <span>{k}</span>
                <Badge variant="outline" className="text-[10px]">
                  {v}
                </Badge>
              </div>
            ))
        )}
      </Block>

      <Block title="Per person">
        <table className="w-full text-[11px]">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left font-medium">Person</th>
              <th className="text-right font-medium">Calls</th>
              <th className="text-right font-medium">Connected</th>
              <th className="text-right font-medium">Moved</th>
            </tr>
          </thead>
          <tbody>
            {[...data.byPerson.entries()].map(([name, p]) => (
              <tr key={name} className="border-t">
                <td className="py-1">{name}</td>
                <td className="py-1 text-right">{p.calls}</td>
                <td className="py-1 text-right">{p.connected}</td>
                <td className="py-1 text-right font-medium">{p.movement}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>
    </div>
  );
}
