"use client";

import { useState, useMemo, useCallback } from "react";
import { money } from "@/lib/format";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type DiscItem = {
  id: string;
  item: string;
  qty: string;
  ctn: string;
  rmb: string;
};

type ShovelItem = {
  id: string;
  item: string;
  qty: string;
  pkt: string;
  rmb: string;
};

type TaxItem = {
  id: string;
  sno: number;
  description: string;
  hsCode: string;
  assessQty: string;
  gw: string;
  nw: string;
  unitPrice: string;
};

type LandingCost = {
  id: string;
  label: string;
  amount: string;
};

let nextId = 1;
const uid = () => String(nextId++);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const num = (v: string) => Number(v) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => money(n);

const emptyDisc = (): DiscItem => ({
  id: uid(),
  item: "",
  qty: "",
  ctn: "",
  rmb: "",
});

const emptyShovel = (): ShovelItem => ({
  id: uid(),
  item: "",
  qty: "",
  pkt: "",
  rmb: "",
});

const emptyTax = (sno: number): TaxItem => ({
  id: uid(),
  sno,
  description: "",
  hsCode: "",
  assessQty: "",
  gw: "",
  nw: "",
  unitPrice: "",
});

const emptyLanding = (label: string): LandingCost => ({
  id: uid(),
  label,
  amount: "",
});

/* ------------------------------------------------------------------ */
/*  Tab Bar                                                            */
/* ------------------------------------------------------------------ */

function TabBar({
  active,
  onSelect,
}: {
  active: "cost" | "tax";
  onSelect: (t: "cost" | "tax") => void;
}) {
  const tabs = [
    { key: "cost" as const, label: "Cost Sheet" },
    { key: "tax" as const, label: "Tax Sheet" },
  ];
  return (
    <div className="flex gap-1 border-b border-sand">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onSelect(t.key)}
          className={`px-4 py-2 text-sm font-semibold transition-colors ${
            active === t.key
              ? "border-b-2 border-navy-800 text-navy-800"
              : "text-steel hover:text-navy-800"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cost Sheet                                                         */
/* ------------------------------------------------------------------ */

type DiscRate = 320 | 350 | 360;
type ShovelRate = 320 | 350 | 325;

const DISC_RATES: DiscRate[] = [320, 350, 360];
const SHOVEL_RATES: ShovelRate[] = [320, 350, 325];

function CostSheet() {
  const [exchangeRate, setExchangeRate] = useState("278.65");
  const [discRate, setDiscRate] = useState<DiscRate>(360);
  const [shovelRate, setShovelRate] = useState<ShovelRate>(325);

  const [discItems, setDiscItems] = useState<DiscItem[]>(() => {
    const items = [
      { item: 'Big 5 4"', qty: "200", ctn: "25", rmb: "2.3" },
      { item: 'Big 5 5"', qty: "200", ctn: "25", rmb: "3.7" },
      { item: 'Excel 4"', qty: "200", ctn: "25", rmb: "2.3" },
      { item: 'Excel 5"', qty: "200", ctn: "25", rmb: "3.7" },
      { item: 'Big 5 4" R5', qty: "200", ctn: "15", rmb: "4.8" },
      { item: 'Big 5 5" R5', qty: "200", ctn: "15", rmb: "5.8" },
      { item: 'Excel 4" R5', qty: "200", ctn: "15", rmb: "4.8" },
      { item: 'Excel 5" R5', qty: "200", ctn: "15", rmb: "5.8" },
      { item: 'R5 Glass Blade 4"', qty: "200", ctn: "2.5", rmb: "4.8" },
      { item: 'R5 Glass Blade 5"', qty: "200", ctn: "2.5", rmb: "8" },
      { item: 'R5 Multi-Functional 4"', qty: "200", ctn: "5", rmb: "4.8" },
      { item: 'R5 Multi-Functional 5"', qty: "200", ctn: "5", rmb: "8" },
    ];
    return items.map((d) => ({ ...d, id: uid() }));
  });

  const [shovelItems, setShovelItems] = useState<ShovelItem[]>(() => {
    const items = [
      { item: "Shovel", qty: "12", pkt: "500", rmb: "10.4" },
      { item: "Shovel Children", qty: "30", pkt: "80", rmb: "7.5" },
    ];
    return items.map((d) => ({ ...d, id: uid() }));
  });

  /* ---- disc computed ---- */
  const discRows = useMemo(() => {
    const rate = discRate;
    return discItems.map((row) => {
      const qty = num(row.qty);
      const ctn = num(row.ctn);
      const rmb = num(row.rmb);
      const pkr = rmb * num(exchangeRate);
      const kgPerCtn = qty > 0 && ctn > 0 ? qty / ctn : 0;
      const kgPerDzn = qty > 0 && ctn > 0 ? (qty * kgPerCtn) / 12 / (qty / 12) : 0;
      const kgPerPcs = qty > 0 && ctn > 0 ? kgPerCtn / 12 : 0;
      const totalWeight = ctn * kgPerCtn;
      const cc = totalWeight * rate;
      const tc = totalWeight * rate;
      const sp = tc * 1.1;
      return {
        ...row,
        pkr: round2(pkr),
        kgPerCtn: round2(kgPerCtn),
        kgPerDzn: round2(kgPerDzn),
        kgPerPcs: round2(kgPerPcs),
        totalWeight: round2(totalWeight),
        cc: round2(cc),
        tc: round2(tc),
        sp: round2(sp),
      };
    });
  }, [discItems, exchangeRate, discRate]);

  /* ---- shovel computed ---- */
  const shovelRows = useMemo(() => {
    const rate = shovelRate;
    return shovelItems.map((row) => {
      const qty = num(row.qty);
      const pkt = num(row.pkt);
      const rmb = num(row.rmb);
      const pkr = rmb * num(exchangeRate);
      const kgPerPkt = qty > 0 && pkt > 0 ? qty / pkt : 0;
      const kgPerDzn = qty > 0 && pkt > 0 ? (qty * kgPerPkt) / 12 / (qty / 12) : 0;
      const kgPerPcs = qty > 0 && pkt > 0 ? kgPerPkt / 12 : 0;
      const totalWeight = pkt * kgPerPkt;
      const cc = totalWeight * rate;
      const tc = totalWeight * rate;
      const spPerDzn = tc / (qty / 12 || 1);
      return {
        ...row,
        pkr: round2(pkr),
        kgPerPkt: round2(kgPerPkt),
        kgPerDzn: round2(kgPerDzn),
        kgPerPcs: round2(kgPerPcs),
        totalWeight: round2(totalWeight),
        cc: round2(cc),
        tc: round2(tc),
        spPerDzn: round2(spPerDzn),
      };
    });
  }, [shovelItems, exchangeRate, shovelRate]);

  const discTotals = useMemo(() => {
    let totalWeight = 0;
    let totalTC = 0;
    for (const r of discRows) {
      totalWeight += r.totalWeight;
      totalTC += r.tc;
    }
    return { totalWeight: round2(totalWeight), totalTC: round2(totalTC) };
  }, [discRows]);

  const shovelTotals = useMemo(() => {
    let totalWeight = 0;
    let totalTC = 0;
    for (const r of shovelRows) {
      totalWeight += r.totalWeight;
      totalTC += r.tc;
    }
    return { totalWeight: round2(totalWeight), totalTC: round2(totalTC) };
  }, [shovelRows]);

  const grandTotal = discTotals.totalTC + shovelTotals.totalTC;
  const profit = grandTotal * 0.1;

  /* ---- update helpers ---- */
  const updateDisc = useCallback((id: string, patch: Partial<DiscItem>) => {
    setDiscItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);
  const updateShovel = useCallback((id: string, patch: Partial<ShovelItem>) => {
    setShovelItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* Global controls */}
      <div className="flex flex-wrap items-end gap-4 rounded border border-sand bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">RMB → PKR</span>
          <input
            type="number"
            step="0.01"
            value={exchangeRate}
            onChange={(e) => setExchangeRate(e.target.value)}
            className="w-28 rounded border border-sand px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">Disc Rate (CC/FC)</span>
          <select
            value={discRate}
            onChange={(e) => setDiscRate(Number(e.target.value) as DiscRate)}
            className="rounded border border-sand px-2 py-1.5 text-sm"
          >
            {DISC_RATES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">Shovel Rate (CC/FC)</span>
          <select
            value={shovelRate}
            onChange={(e) => setShovelRate(Number(e.target.value) as ShovelRate)}
            className="rounded border border-sand px-2 py-1.5 text-sm"
          >
            {SHOVEL_RATES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ============ DISC / HARDWARE SECTION ============ */}
      <section>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-navy-800">Disc / Hardware</h3>
          <button
            type="button"
            onClick={() => setDiscItems((prev) => [...prev, emptyDisc()])}
            className="rounded bg-navy-800 px-2 py-0.5 text-xs font-semibold text-white hover:bg-navy-700"
          >
            + Add Row
          </button>
        </div>
        <div className="matrix-scroll overflow-x-auto rounded border border-sand">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-sand bg-ivory text-left text-[10px] uppercase tracking-wide text-steel">
                <th className="px-2 py-1.5">Item</th>
                <th className="px-2 py-1.5 text-right">Qty</th>
                <th className="px-2 py-1.5 text-right">Ctn</th>
                <th className="px-2 py-1.5 text-right">RMB</th>
                <th className="px-2 py-1.5 text-right">PKR</th>
                <th className="px-2 py-1.5 text-right">KG/Ctn</th>
                <th className="px-2 py-1.5 text-right">KG/Dzn</th>
                <th className="px-2 py-1.5 text-right">KG/Pcs</th>
                <th className="px-2 py-1.5 text-right">Total Wt</th>
                <th className="px-2 py-1.5 text-right">C.C {discRate}/Kg</th>
                <th className="px-2 py-1.5 text-right">T.C {discRate}</th>
                <th className="px-2 py-1.5 text-right">SP (+10%)</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {discRows.map((r) => (
                <tr key={r.id} className="border-b border-sand/50 hover:bg-ivory/50">
                  <td className="px-2 py-1">
                    <input
                      value={r.item}
                      onChange={(e) => updateDisc(r.id, { item: e.target.value })}
                      className="w-40 rounded border border-sand px-1 py-0.5 text-xs"
                    />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <input
                      type="number"
                      value={r.qty}
                      onChange={(e) => updateDisc(r.id, { qty: e.target.value })}
                      className="w-14 rounded border border-sand px-1 py-0.5 text-right text-xs tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <input
                      type="number"
                      value={r.ctn}
                      onChange={(e) => updateDisc(r.id, { ctn: e.target.value })}
                      className="w-14 rounded border border-sand px-1 py-0.5 text-right text-xs tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <input
                      type="number"
                      step="0.1"
                      value={r.rmb}
                      onChange={(e) => updateDisc(r.id, { rmb: e.target.value })}
                      className="w-16 rounded border border-sand px-1 py-0.5 text-right text-xs tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.pkr)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.kgPerCtn)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.kgPerDzn)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.kgPerPcs)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.totalWeight)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.cc)}</td>
                  <td className="px-2 py-1 text-right tabular-nums font-semibold">{fmt(r.tc)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.sp)}</td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => setDiscItems((prev) => prev.filter((x) => x.id !== r.id))}
                      className="text-error hover:underline"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-navy-800 bg-ivory font-semibold text-navy-800">
                <td className="px-2 py-1.5" colSpan={8}>
                  Total
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(discTotals.totalWeight)}</td>
                <td className="px-2 py-1.5"></td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(discTotals.totalTC)}</td>
                <td className="px-2 py-1.5"></td>
                <td className="px-2 py-1.5"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* ============ SHOVEL SECTION ============ */}
      <section>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-navy-800">Shovel</h3>
          <button
            type="button"
            onClick={() => setShovelItems((prev) => [...prev, emptyShovel()])}
            className="rounded bg-navy-800 px-2 py-0.5 text-xs font-semibold text-white hover:bg-navy-700"
          >
            + Add Row
          </button>
        </div>
        <div className="matrix-scroll overflow-x-auto rounded border border-sand">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-sand bg-ivory text-left text-[10px] uppercase tracking-wide text-steel">
                <th className="px-2 py-1.5">Item</th>
                <th className="px-2 py-1.5 text-right">Qty (Dzn)</th>
                <th className="px-2 py-1.5 text-right">Pkt</th>
                <th className="px-2 py-1.5 text-right">RMB</th>
                <th className="px-2 py-1.5 text-right">PKR</th>
                <th className="px-2 py-1.5 text-right">KG/Pkt</th>
                <th className="px-2 py-1.5 text-right">KG/Dzn</th>
                <th className="px-2 py-1.5 text-right">KG/Pcs</th>
                <th className="px-2 py-1.5 text-right">Total Wt</th>
                <th className="px-2 py-1.5 text-right">C.C {shovelRate}/Kg</th>
                <th className="px-2 py-1.5 text-right">T.C {shovelRate}</th>
                <th className="px-2 py-1.5 text-right">SP (dzn)</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {shovelRows.map((r) => (
                <tr key={r.id} className="border-b border-sand/50 hover:bg-ivory/50">
                  <td className="px-2 py-1">
                    <input
                      value={r.item}
                      onChange={(e) => updateShovel(r.id, { item: e.target.value })}
                      className="w-40 rounded border border-sand px-1 py-0.5 text-xs"
                    />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <input
                      type="number"
                      value={r.qty}
                      onChange={(e) => updateShovel(r.id, { qty: e.target.value })}
                      className="w-14 rounded border border-sand px-1 py-0.5 text-right text-xs tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <input
                      type="number"
                      value={r.pkt}
                      onChange={(e) => updateShovel(r.id, { pkt: e.target.value })}
                      className="w-14 rounded border border-sand px-1 py-0.5 text-right text-xs tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <input
                      type="number"
                      step="0.1"
                      value={r.rmb}
                      onChange={(e) => updateShovel(r.id, { rmb: e.target.value })}
                      className="w-16 rounded border border-sand px-1 py-0.5 text-right text-xs tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.pkr)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.kgPerPkt)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.kgPerDzn)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.kgPerPcs)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.totalWeight)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.cc)}</td>
                  <td className="px-2 py-1 text-right tabular-nums font-semibold">{fmt(r.tc)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.spPerDzn)}</td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => setShovelItems((prev) => prev.filter((x) => x.id !== r.id))}
                      className="text-error hover:underline"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-navy-800 bg-ivory font-semibold text-navy-800">
                <td className="px-2 py-1.5" colSpan={8}>
                  Total
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(shovelTotals.totalWeight)}</td>
                <td className="px-2 py-1.5"></td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(shovelTotals.totalTC)}</td>
                <td className="px-2 py-1.5"></td>
                <td className="px-2 py-1.5"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Grand Total */}
      <div className="flex items-center gap-6 rounded border-2 border-navy-800 bg-navy-800 p-4 text-white">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-navy-200">Total Weight</p>
          <p className="text-lg font-bold tabular-nums">{fmt(discTotals.totalWeight + shovelTotals.totalWeight)} kg</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-navy-200">Grand Total (TC)</p>
          <p className="text-lg font-bold tabular-nums">{fmt(grandTotal)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-navy-200">Profit (10%)</p>
          <p className="text-lg font-bold tabular-nums text-brass-400">{fmt(profit)}</p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tax Sheet                                                          */
/* ------------------------------------------------------------------ */

function TaxSheet() {
  const [usdRate, setUsdRate] = useState("278.65");

  const [items, setItems] = useState<TaxItem[]>(() => {
    const defaults = [
      { description: "EMERY GRAIN BROWN", hsCode: "2513.2010", assessQty: "4000", gw: "4000", nw: "4000", unitPrice: "0.45" },
      { description: "EMERY GRAIN WHITE", hsCode: "2513.2010", assessQty: "2000", gw: "2000", nw: "2000", unitPrice: "0.46" },
      { description: "EMERY GRAIN BLACK", hsCode: "2513.2010", assessQty: "2000", gw: "2000", nw: "2000", unitPrice: "0.48" },
      { description: "ASSORTED GLOVES", hsCode: "6116.1000", assessQty: "1073", gw: "", nw: "1073", unitPrice: "1.20" },
      { description: "LIFE JACKET", hsCode: "6307.2000", assessQty: "192", gw: "210", nw: "192", unitPrice: "1.20" },
      { description: "LIFE BOUY", hsCode: "3926.9099", assessQty: "120", gw: "130", nw: "120", unitPrice: "1.10" },
      { description: "CUTTING DISK (ASSORTED)", hsCode: "8202.3100", assessQty: "3211", gw: "3292", nw: "3211", unitPrice: "3.75" },
      { description: "SHOVEL WITH HANDLE (ASSORTED)", hsCode: "8201.1000", assessQty: "10600", gw: "10600", nw: "10600", unitPrice: "2.05" },
    ];
    return defaults.map((d, i) => ({ ...d, id: uid(), sno: i + 1 }));
  });

  const [landingCosts, setLandingCosts] = useState<LandingCost[]>(() => [
    emptyLanding("China"),
    emptyLanding("Extra"),
    emptyLanding("South Asia Terminal"),
    emptyLanding("Shipping Company"),
    emptyLanding("Insurance"),
    emptyLanding("Bank Contract"),
    emptyLanding("Clearing and Speed Money"),
    emptyLanding("Container Labour"),
  ]);

  const [customsDutyPct, setCustomsDutyPct] = useState("0");
  const [addCustomsDutyPct, setAddCustomsDutyPct] = useState("0");
  const [regulatoryDutyPct, setRegulatoryDutyPct] = useState("0");
  const [salesTaxPct, setSalesTaxPct] = useState("18");
  const [addSalesTaxPct, setAddSalesTaxPct] = useState("3");
  const [incomeTaxPct, setIncomeTaxPct] = useState("6");

  const rate = num(usdRate);

  const rows = useMemo(() => {
    return items.map((item) => {
      const aq = num(item.assessQty);
      const gw = num(item.gw);
      const nw = num(item.nw);
      const up = num(item.unitPrice);
      const valuePKR = aq * up * rate;
      const landing1pct = valuePKR * 0.01;
      const insurance1pct = valuePKR * 0.01;
      const landedValue = valuePKR + landing1pct + insurance1pct;
      const customsDuty = landedValue * (num(customsDutyPct) / 100);
      const addCustomsDuty = landedValue * (num(addCustomsDutyPct) / 100);
      const regulatoryDuty = landedValue * (num(regulatoryDutyPct) / 100);
      const salesTax = landedValue * (num(salesTaxPct) / 100);
      const addSalesTax = landedValue * (num(addSalesTaxPct) / 100);
      const incomeTax = landedValue * (num(incomeTaxPct) / 100);
      const total = landedValue + customsDuty + addCustomsDuty + regulatoryDuty + salesTax + addSalesTax + incomeTax;
      const costPerGW = gw > 0 ? total / gw : 0;
      const costPerNW = nw > 0 ? total / nw : 0;
      return {
        ...item,
        valuePKR: round2(valuePKR),
        landing1pct: round2(landing1pct),
        insurance1pct: round2(insurance1pct),
        landedValue: round2(landedValue),
        customsDuty: round2(customsDuty),
        addCustomsDuty: round2(addCustomsDuty),
        regulatoryDuty: round2(regulatoryDuty),
        salesTax: round2(salesTax),
        addSalesTax: round2(addSalesTax),
        incomeTax: round2(incomeTax),
        total: round2(total),
        costPerGW: round2(costPerGW),
        costPerNW: round2(costPerNW),
      };
    });
  }, [items, rate, customsDutyPct, addCustomsDutyPct, regulatoryDutyPct, salesTaxPct, addSalesTaxPct, incomeTaxPct]);

  const totals = useMemo(() => {
    let gw = 0;
    let nw = 0;
    let landedValue = 0;
    let customsDuty = 0;
    let addCustomsDuty = 0;
    let regulatoryDuty = 0;
    let salesTax = 0;
    let addSalesTax = 0;
    let incomeTax = 0;
    let total = 0;
    for (const r of rows) {
      gw += num(r.gw);
      nw += num(r.nw);
      landedValue += r.landedValue;
      customsDuty += r.customsDuty;
      addCustomsDuty += r.addCustomsDuty;
      regulatoryDuty += r.regulatoryDuty;
      salesTax += r.salesTax;
      addSalesTax += r.addSalesTax;
      incomeTax += r.incomeTax;
      total += r.total;
    }
    return {
      gw: round2(gw),
      nw: round2(nw),
      landedValue: round2(landedValue),
      customsDuty: round2(customsDuty),
      addCustomsDuty: round2(addCustomsDuty),
      regulatoryDuty: round2(regulatoryDuty),
      salesTax: round2(salesTax),
      addSalesTax: round2(addSalesTax),
      incomeTax: round2(incomeTax),
      total: round2(total),
    };
  }, [rows]);

  const landingTotal = landingCosts.reduce((sum, l) => sum + num(l.amount), 0);
  const allCosts = totals.total + landingTotal;

  const updateItem = useCallback((id: string, patch: Partial<TaxItem>) => {
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);
  const updateLanding = useCallback((id: string, patch: Partial<LandingCost>) => {
    setLandingCosts((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* Global controls */}
      <div className="flex flex-wrap items-end gap-4 rounded border border-sand bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">USD → PKR</span>
          <input
            type="number"
            step="0.01"
            value={usdRate}
            onChange={(e) => setUsdRate(e.target.value)}
            className="w-28 rounded border border-sand px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">Customs Duty %</span>
          <input
            type="number"
            step="0.01"
            value={customsDutyPct}
            onChange={(e) => setCustomsDutyPct(e.target.value)}
            className="w-20 rounded border border-sand px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">Add. Customs %</span>
          <input
            type="number"
            step="0.01"
            value={addCustomsDutyPct}
            onChange={(e) => setAddCustomsDutyPct(e.target.value)}
            className="w-20 rounded border border-sand px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">Regulatory %</span>
          <input
            type="number"
            step="0.01"
            value={regulatoryDutyPct}
            onChange={(e) => setRegulatoryDutyPct(e.target.value)}
            className="w-20 rounded border border-sand px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">Sales Tax %</span>
          <input
            type="number"
            step="0.01"
            value={salesTaxPct}
            onChange={(e) => setSalesTaxPct(e.target.value)}
            className="w-20 rounded border border-sand px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">Add. Sales Tax %</span>
          <input
            type="number"
            step="0.01"
            value={addSalesTaxPct}
            onChange={(e) => setAddSalesTaxPct(e.target.value)}
            className="w-20 rounded border border-sand px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">Income Tax %</span>
          <input
            type="number"
            step="0.01"
            value={incomeTaxPct}
            onChange={(e) => setIncomeTaxPct(e.target.value)}
            className="w-20 rounded border border-sand px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
      </div>

      {/* Items table */}
      <section>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-navy-800">Import Items</h3>
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, emptyTax(prev.length + 1)])}
            className="rounded bg-navy-800 px-2 py-0.5 text-xs font-semibold text-white hover:bg-navy-700"
          >
            + Add Row
          </button>
        </div>
        <div className="matrix-scroll overflow-x-auto rounded border border-sand">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-sand bg-ivory text-left uppercase tracking-wide text-steel">
                <th className="px-1.5 py-1.5">#</th>
                <th className="px-1.5 py-1.5">Description</th>
                <th className="px-1.5 py-1.5">HS Code</th>
                <th className="px-1.5 py-1.5 text-right">Qty (Assess)</th>
                <th className="px-1.5 py-1.5 text-right">G.W (KG)</th>
                <th className="px-1.5 py-1.5 text-right">N.W (KG)</th>
                <th className="px-1.5 py-1.5 text-right">Unit $</th>
                <th className="px-1.5 py-1.5 text-right">Value (PKR)</th>
                <th className="px-1.5 py-1.5 text-right">Landing 1%</th>
                <th className="px-1.5 py-1.5 text-right">Ins 1%</th>
                <th className="px-1.5 py-1.5 text-right">Landed</th>
                <th className="px-1.5 py-1.5 text-right">Customs</th>
                <th className="px-1.5 py-1.5 text-right">Add. Customs</th>
                <th className="px-1.5 py-1.5 text-right">Regulatory</th>
                <th className="px-1.5 py-1.5 text-right">Sales Tax</th>
                <th className="px-1.5 py-1.5 text-right">Add. ST</th>
                <th className="px-1.5 py-1.5 text-right">Inc. Tax</th>
                <th className="px-1.5 py-1.5 text-right">Total</th>
                <th className="px-1.5 py-1.5 text-right">Cost/GW</th>
                <th className="px-1.5 py-1.5 text-right">Cost/NW</th>
                <th className="px-1.5 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-sand/50 hover:bg-ivory/50">
                  <td className="px-1.5 py-1 text-steel">{r.sno}</td>
                  <td className="px-1.5 py-1">
                    <input
                      value={r.description}
                      onChange={(e) => updateItem(r.id, { description: e.target.value })}
                      className="w-36 rounded border border-sand px-1 py-0.5 text-[10px]"
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <input
                      value={r.hsCode}
                      onChange={(e) => updateItem(r.id, { hsCode: e.target.value })}
                      className="w-20 rounded border border-sand px-1 py-0.5 text-[10px]"
                    />
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    <input
                      type="number"
                      value={r.assessQty}
                      onChange={(e) => updateItem(r.id, { assessQty: e.target.value })}
                      className="w-16 rounded border border-sand px-1 py-0.5 text-right text-[10px] tabular-nums"
                    />
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    <input
                      type="number"
                      value={r.gw}
                      onChange={(e) => updateItem(r.id, { gw: e.target.value })}
                      className="w-16 rounded border border-sand px-1 py-0.5 text-right text-[10px] tabular-nums"
                    />
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    <input
                      type="number"
                      value={r.nw}
                      onChange={(e) => updateItem(r.id, { nw: e.target.value })}
                      className="w-16 rounded border border-sand px-1 py-0.5 text-right text-[10px] tabular-nums"
                    />
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    <input
                      type="number"
                      step="0.01"
                      value={r.unitPrice}
                      onChange={(e) => updateItem(r.id, { unitPrice: e.target.value })}
                      className="w-14 rounded border border-sand px-1 py-0.5 text-right text-[10px] tabular-nums"
                    />
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmt(r.valuePKR)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmt(r.landing1pct)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmt(r.insurance1pct)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmt(r.landedValue)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmt(r.customsDuty)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmt(r.addCustomsDuty)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmt(r.regulatoryDuty)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmt(r.salesTax)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmt(r.addSalesTax)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmt(r.incomeTax)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums font-semibold">{fmt(r.total)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmt(r.costPerGW)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmt(r.costPerNW)}</td>
                  <td className="px-1.5 py-1">
                    <button
                      type="button"
                      onClick={() => setItems((prev) => prev.filter((x) => x.id !== r.id))}
                      className="text-error hover:underline"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-navy-800 bg-ivory font-semibold text-navy-800">
                <td className="px-1.5 py-1.5" colSpan={3}>
                  TOTAL
                </td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{fmt(totals.gw)}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums" colSpan={2}></td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{fmt(totals.landedValue)}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums" colSpan={2}></td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{fmt(totals.customsDuty)}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{fmt(totals.addCustomsDuty)}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{fmt(totals.regulatoryDuty)}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{fmt(totals.salesTax)}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{fmt(totals.addSalesTax)}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{fmt(totals.incomeTax)}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{fmt(totals.total)}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{totals.gw > 0 ? fmt(Math.round(totals.total / totals.gw)) : "—"}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{totals.nw > 0 ? fmt(Math.round(totals.total / totals.nw)) : "—"}</td>
                <td className="px-1.5 py-1.5"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Landing costs */}
      <section>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-navy-800">Landing / Local Costs</h3>
          <button
            type="button"
            onClick={() => setLandingCosts((prev) => [...prev, emptyLanding("")])}
            className="rounded bg-navy-800 px-2 py-0.5 text-xs font-semibold text-white hover:bg-navy-700"
          >
            + Add
          </button>
        </div>
        <div className="matrix-scroll overflow-x-auto rounded border border-sand">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-sand bg-ivory text-left text-[10px] uppercase tracking-wide text-steel">
                <th className="px-3 py-1.5">Item</th>
                <th className="px-3 py-1.5 text-right">Amount (PKR)</th>
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {landingCosts.map((l) => (
                <tr key={l.id} className="border-b border-sand/50 hover:bg-ivory/50">
                  <td className="px-3 py-1">
                    <input
                      value={l.label}
                      onChange={(e) => updateLanding(l.id, { label: e.target.value })}
                      className="w-48 rounded border border-sand px-2 py-1 text-xs"
                    />
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    <input
                      type="number"
                      value={l.amount}
                      onChange={(e) => updateLanding(l.id, { amount: e.target.value })}
                      className="w-28 rounded border border-sand px-2 py-1 text-right text-xs tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-1">
                    <button
                      type="button"
                      onClick={() => setLandingCosts((prev) => prev.filter((x) => x.id !== l.id))}
                      className="text-error hover:underline"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-navy-800 bg-ivory font-semibold text-navy-800">
                <td className="px-3 py-1.5">TOTAL Landing</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(landingTotal)}</td>
                <td className="px-3 py-1.5"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Summary */}
      <div className="flex items-center gap-6 rounded border-2 border-navy-800 bg-navy-800 p-4 text-white">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-navy-200">Import Total</p>
          <p className="text-lg font-bold tabular-nums">{fmt(totals.total)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-navy-200">Landing Total</p>
          <p className="text-lg font-bold tabular-nums">{fmt(landingTotal)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-navy-200">All Costs</p>
          <p className="text-lg font-bold tabular-nums text-brass-400">{fmt(allCosts)}</p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Export                                                        */
/* ------------------------------------------------------------------ */

export function CostingCalculator() {
  const [tab, setTab] = useState<"cost" | "tax">("cost");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-bold text-navy-800">Costing</h1>
      <TabBar active={tab} onSelect={setTab} />
      {tab === "cost" ? <CostSheet /> : <TaxSheet />}
    </div>
  );
}
