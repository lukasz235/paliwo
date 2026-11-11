/* Logika aplikacji: liczenie spalania, statystyki stacji, parser paragonu.
   Działa w przeglądarce (window.FuelLib) i w Node (module.exports), żeby dało się ją testować. */
(function (root) {
  'use strict';

  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const round2 = (v) => Math.round(v * 100 + 1e-6) / 100; // +1e-6: 279.045 ma dać 279.05, jak na paragonie
  const round3 = (v) => Math.round(v * 1000) / 1000;

  // ---------- Spalanie i statystyki ----------
  // Wpis: { row, date, km, liters, price, total, station, fuel, full }
  // Spalanie liczymy od pełnego do pełnego baku: litry wlane od poprzedniego pełnego tankowania
  // (razem z bieżącym) / przejechane km * 100. Tankowania częściowe liczą się do litrów.
  function computeEntryStats(entries) {
    const asc = entries.slice().sort((a, b) => a.km - b.km || a.row - b.row);
    let lastFull = null;
    let liters = 0;
    let cost = 0;
    const out = [];
    for (const e of asc) {
      liters += e.liters;
      cost += e.total;
      if (e.full) {
        if (lastFull && e.km > lastFull.km) {
          const segKm = e.km - lastFull.km;
          out.push({
            entry: e,
            segKm,
            segLiters: liters,
            segCost: cost,
            startStation: lastFull.station,
            startFuel: lastFull.fuel,
            consumption: (liters / segKm) * 100,
            costPer100: (cost / segKm) * 100,
          });
        } else {
          out.push({ entry: e });
        }
        lastFull = e;
        liters = 0;
        cost = 0;
      } else {
        out.push({ entry: e });
      }
    }
    return out.reverse(); // od najnowszego
  }

  function computeOverall(stats) {
    const segs = stats.filter((s) => s.segKm);
    const km = sum(segs, (s) => s.segKm);
    const segLiters = sum(segs, (s) => s.segLiters);
    const segCost = sum(segs, (s) => s.segCost);
    const totalCost = sum(stats, (s) => s.entry.total);
    const totalLiters = sum(stats, (s) => s.entry.liters);
    return {
      count: stats.length,
      totalCost,
      totalLiters,
      measuredKm: km,
      avgConsumption: km > 0 ? (segLiters / km) * 100 : null,
      avgCostPer100: km > 0 ? (segCost / km) * 100 : null,
      avgPrice: totalLiters > 0 ? totalCost / totalLiters : null,
    };
  }

  // Spalanie odcinków w czasie (od najstarszego) do wykresu.
  function computeConsumptionSeries(stats) {
    return stats
      .filter((s) => s.segKm && s.consumption != null)
      .map((s) => ({ date: s.entry.date, value: s.consumption, fuel: s.startFuel || s.entry.fuel }))
      .reverse();
  }

  // Zniżka: mode 'pl' = zł za litr (na dl litrów albo na całość), mode 'sum' = kwota łączna.
  function computeTotal(liters, price, discount) {
    if (liters == null || price == null) return null;
    return round2(round2(liters * price) - (discount || 0));
  }
  function computeDiscount(mode, value, discLiters, liters) {
    if (value == null || !(value > 0)) return 0;
    if (mode === 'sum') return round2(value);
    const l = discLiters != null && discLiters > 0 ? Math.min(discLiters, liters) : liters;
    return round2(value * l);
  }

  // Cena = średnia ważona litrami ze wszystkich tankowań na stacji.
  // Spalanie i koszt/100 km = z odcinków, które ZACZĘŁY się pełnym tankowaniem na tej stacji.
  // fuelFilter (opcjonalnie): tylko tankowania danego paliwa, a odcinki wg paliwa z początku odcinka (to ono jest w baku).
  function computeStationStats(stats, fuelFilter) {
    const key = (n) => String(n || '').trim().toLowerCase();
    const groups = new Map();
    for (const s of stats) {
      if (fuelFilter && s.entry.fuel !== fuelFilter) continue;
      const k = key(s.entry.station);
      if (!groups.has(k)) groups.set(k, { name: String(s.entry.station || '').trim(), list: [] });
      groups.get(k).list.push(s);
    }
    const segsByStart = new Map();
    for (const s of stats) {
      if (s.segKm && s.startStation && (!fuelFilter || s.startFuel === fuelFilter)) {
        const k = key(s.startStation);
        if (!segsByStart.has(k)) segsByStart.set(k, []);
        segsByStart.get(k).push(s);
      }
    }
    const result = [];
    for (const [k, g] of groups) {
      const liters = sum(g.list, (s) => s.entry.liters);
      const cost = sum(g.list, (s) => s.entry.total);
      const segs = segsByStart.get(k) || [];
      const km = sum(segs, (s) => s.segKm);
      result.push({
        name: g.name || '(bez nazwy)',
        fillUps: g.list.length,
        avgPrice: liters > 0 ? cost / liters : null,
        measuredKm: km,
        avgConsumption: km > 0 ? (sum(segs, (s) => s.segLiters) / km) * 100 : null,
        costPer100: km > 0 ? (sum(segs, (s) => s.segCost) / km) * 100 : null,
      });
    }
    result.sort((a, b) => {
      if ((a.costPer100 == null) !== (b.costPer100 == null)) return a.costPer100 == null ? 1 : -1;
      return (a.costPer100 ?? 0) - (b.costPer100 ?? 0);
    });
    return result;
  }

  // ---------- Parser paragonu ----------
  const DECIMAL = /\d{1,4}[.,]\d{2,3}/g;

  function toNum(s) {
    const n = parseFloat(String(s).replace(',', '.'));
    return Number.isNaN(n) ? null : n;
  }

  // Szukamy trójki liczb: litry × cena ≈ kwota. Nie zależy od układu paragonu konkretnej stacji.
  function findTriple(numbers) {
    let best = null;
    let bestErr = Infinity;
    for (const a of numbers) {
      if (a < 2 || a > 150) continue; // litry
      for (const b of numbers) {
        if (b < 3 || b > 15) continue; // cena za litr (PLN)
        for (const c of numbers) {
          if (c < 5 || c > 2000) continue;
          const err = Math.abs(a * b - c);
          if (err <= 0.07 && err < bestErr && a !== c && b !== c) {
            best = { liters: a, price: b, total: c };
            bestErr = err;
          }
        }
      }
    }
    return best;
  }

  function firstNumber(upper, regex) {
    const m = regex.exec(upper);
    return m ? toNum(m[1]) : null;
  }

  const PREMIUM_DIESEL =
    /VERVA\s*(ON|DIESEL)|V-?POWER\s*DIESEL|ULTIMATE\s*DIESEL|DYNAMIC\s*DIESEL|DIESEL\s*(PREMIUM|\+)|\bON\s*(PREMIUM|\+)|PREMIUM\s*(ON|DIESEL)|MILES\s*(PLUS)?\s*DIESEL|ENERGY\s*DIESEL/;

  function detectFuel(u) {
    if (/\bLPG\b/.test(u)) return 'LPG';
    if (PREMIUM_DIESEL.test(u)) return 'ON premium';
    if (/\b(ON|DIESEL)\b/.test(u) || /OLEJ NAP[ĘE]DOWY/.test(u)) return 'ON';
    const m = /(^|[^\d.,])(95|98)(?![\d.,])/.exec(u);
    if (m) return m[2] === '98' ? 'Pb98' : 'Pb95';
    return null;
  }

  const STATIONS = [
    [/\bORLEN\b/, 'Orlen'],
    [/\bPKN\b/, 'Orlen'],
    [/\bBP\b/, 'BP'],
    [/\bSHELL\b/, 'Shell'],
    [/\bCIRCLE\s?K\b/, 'Circle K'],
    [/\bLOTOS\b/, 'Lotos'],
    [/\bMOYA\b/, 'Moya'],
    [/\bAMIC\b/, 'Amic'],
    [/\bMOL\b/, 'MOL'],
    [/\bAUCHAN\b/, 'Auchan'],
    [/\bCARREFOUR\b/, 'Carrefour'],
    [/\bINTERMARCH/, 'Intermarché'],
    [/\bHUZAR\b/, 'Huzar'],
  ];

  function detectStation(u) {
    const hit = STATIONS.find(([re]) => re.test(u));
    return hit ? hit[1] : null;
  }

  function isoOf(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt.toISOString().slice(0, 10);
  }

  function detectDate(text, todayIso) {
    const today = todayIso || new Date().toISOString().slice(0, 10);
    const minYear = Number(today.slice(0, 4)) - 2;
    const ok = (iso) => iso && iso <= today && Number(iso.slice(0, 4)) >= minYear;
    let m = /(\d{4})[-./](\d{2})[-./](\d{2})/.exec(text);
    if (m) {
      const iso = isoOf(+m[1], +m[2], +m[3]);
      if (ok(iso)) return iso;
    }
    m = /(\d{2})[-./](\d{2})[-./](\d{4})/.exec(text);
    if (m) {
      const iso = isoOf(+m[3], +m[2], +m[1]);
      if (ok(iso)) return iso;
    }
    return null;
  }

  function parseReceipt(raw, todayIso) {
    const text = String(raw).replace(/ /g, ' ');
    const upper = text.toUpperCase();
    const numbers = (text.match(DECIMAL) || []).map(toNum).filter((n) => n !== null);

    let liters = null;
    let price = null;
    let total = null;

    const triple = findTriple(numbers);
    if (triple) {
      ({ liters, price, total } = triple);
    } else {
      liters =
        firstNumber(upper, /(?:ILO[ŚS]Ć|ILOSC|LITRY|LITR)\D{0,8}(\d{1,3}[.,]\d{2,3})/) ??
        firstNumber(upper, /(\d{1,3}[.,]\d{2,3})\s*L\b/);
      price =
        firstNumber(upper, /CENA\D{0,8}(\d{1,2}[.,]\d{2,3})/) ??
        firstNumber(upper, /[X*]\s*(\d{1,2}[.,]\d{2,3})/);
      total = firstNumber(upper, /(?:SUMA|RAZEM|DO ZAP[ŁL]ATY|WARTO[ŚS]Ć)\D{0,12}(\d{1,4}[.,]\d{2})/);

      if (total == null && liters != null && price != null) total = round2(liters * price);
      if (price == null && liters != null && total != null && liters > 0) price = round3(total / liters);
      if (liters == null && price != null && total != null && price > 0) liters = round2(total / price);
    }

    return {
      liters,
      price,
      total,
      fuel: detectFuel(upper),
      station: detectStation(upper),
      date: detectDate(text, todayIso),
    };
  }

  // ---------- Daty z arkusza ----------
  // Arkusz zwraca daty jako numery seryjne (dni od 1899-12-30).
  function serialToISO(v) {
    if (typeof v === 'number') {
      return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
    }
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    return '';
  }

  const api = {
    computeEntryStats,
    computeOverall,
    computeStationStats,
    computeConsumptionSeries,
    computeTotal,
    computeDiscount,
    parseReceipt,
    serialToISO,
    round2,
    round3,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FuelLib = api;
})(typeof self !== 'undefined' ? self : this);
