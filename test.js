// Uruchom: node test.js
const L = require('./lib.js');

let failed = 0;
function check(name, cond) {
  console.log((cond ? 'OK   ' : 'FAIL ') + name);
  if (!cond) failed++;
}
const near = (a, b, eps = 1e-9) => a != null && Math.abs(a - b) < eps;

function fe(km, liters, price, station, full = true) {
  return {
    row: km,
    date: '2026-10-01',
    km,
    liters,
    price,
    total: Math.round(liters * price * 100) / 100,
    station,
    fuel: 'Pb95',
    full,
  };
}

// Spalanie: 1000 -> 1500 km, wlane 30 l => 6.0 l/100
const s1 = L.computeEntryStats([fe(1000, 40, 6.0, 'Orlen'), fe(1500, 30, 6.2, 'BP')]);
check('spalanie 6.0', near(s1[0].consumption, 6.0));
check('odcinek zaczyna sie na Orlen', s1[0].startStation === 'Orlen');
check('pierwsze pelne bez spalania', s1[1].consumption === undefined);

// Czesciowe: 30 l / 500 km
const s2 = L.computeEntryStats([fe(1000, 40, 6, 'A'), fe(1200, 15, 6, 'B', false), fe(1500, 15, 6, 'A')]);
check('czesciowe liczone', near(s2[0].consumption, 6.0));
check('czesciowe bez spalania', s2[1].consumption === undefined);

// Dane z arkusza (te same co w pliku fuel): 6.50 i 6.68 l/100
const sheet = [
  { row: 2, km: 45000, liters: 38, price: 6.29, total: 239.02, station: 'Orlen', full: true },
  { row: 3, km: 45520, liters: 33.8, price: 6.19, total: 209.22, station: 'BP', full: true },
  { row: 4, km: 45800, liters: 15, price: 6.25, total: 93.75, station: 'Orlen', full: false },
  { row: 5, km: 46050, liters: 20.4, price: 6.29, total: 128.32, station: 'Orlen', full: true },
];
const s3 = L.computeEntryStats(sheet);
check('arkusz: 6.50', near(s3.find((s) => s.entry.row === 3).consumption, 6.5));
check('arkusz: 6.68', near(s3.find((s) => s.entry.row === 5).consumption, 35.4 / 530 * 100));
const o = L.computeOverall(s3);
check('overall km 1050', o.measuredKm === 1050);
check('overall wydano 670.31', near(o.totalCost, 670.31, 1e-6));
const st = L.computeStationStats(s3);
check('stacje: Orlen pierwszy (taniej na 100 km)', st[0].name === 'Orlen');
check('stacje: Orlen koszt/100 z odcinka od Orlena', near(st[0].costPer100, 209.22 / 520 * 100, 1e-6));
check('stacje: BP spalanie 6.68', near(st.find((s) => s.name === 'BP').avgConsumption, 35.4 / 530 * 100));
check('stacje: srednia cena Orlen 6.28', near(st.find((s) => s.name === 'Orlen').avgPrice, 461.09 / 73.4, 1e-6));

// Parser
const r1 = L.parseReceipt('PKN ORLEN S.A.\n2026-11-08 14:32\nPb95 BENZYNA\n35,21 l x 6,19 PLN\nSUMA PLN 217,95', '2026-11-11');
check('r1 liczby', r1.liters === 35.21 && r1.price === 6.19 && r1.total === 217.95);
check('r1 stacja/paliwo/data', r1.station === 'Orlen' && r1.fuel === 'Pb95' && r1.date === '2026-11-08');

const r2 = L.parseReceipt('BP Stacja\nON\nILOŚĆ: 41,50\nCENA: 6,29\nWARTOŚĆ 261,04\n11.11.2026', '2026-11-11');
check('r2', r2.liters === 41.5 && r2.price === 6.29 && r2.total === 261.04 && r2.fuel === 'ON' && r2.station === 'BP' && r2.date === '2026-11-11');

const r3 = L.parseReceipt('Shell\nIlość: 20,00\nCena: 6,50\nLPG', '2026-11-11');
check('r3 wyliczona kwota', r3.total === 130 && r3.fuel === 'LPG' && r3.station === 'Shell' && r3.date === null);

const r4 = L.parseReceipt('Circle K\nPb98 V-Power\n30.10 l\n7,49 zl/l\n225.45', '2026-11-11');
check('r4 kropka dziesietna', r4.liters === 30.1 && r4.price === 7.49 && r4.total === 225.45 && r4.fuel === 'Pb98' && r4.station === 'Circle K');

const r5 = L.parseReceipt('nic tu nie ma', '2026-11-11');
check('r5 pusty', r5.liters === null && r5.price === null && r5.total === null);

// Daty z arkusza
check('serial 2026-10-01', L.serialToISO(46296) === '2026-10-01');
check('serial tekst', L.serialToISO('2026-10-01') === '2026-10-01');


// Zniżki i kwota
check('zniżka zł/l na całość', L.computeDiscount('pl', 0.3, null, 40.5) === 12.15);
check('zniżka zł/l na 30 l', L.computeDiscount('pl', 0.5, 30, 40) === 15);
check('zniżka zł/l na więcej litrów niż tankowanie', L.computeDiscount('pl', 0.5, 80, 40) === 20);
check('zniżka łącznie', L.computeDiscount('sum', 12, null, 40) === 12);
check('zniżka pusta', L.computeDiscount('pl', null, null, 40) === 0);
check('kwota z rabatem', L.computeTotal(40.5, 6.89, 12.15) === 266.9);

// ON premium
check('Verva ON = ON premium', L.parseReceipt('ORLEN\nVERVA ON 40,50 x 6,89 279,05', '2026-11-11').fuel === 'ON premium');
check('zwykły ON', L.parseReceipt('BP\nON 40,00 x 6,00 240,00', '2026-11-11').fuel === 'ON');
check('V-Power Diesel = ON premium', L.parseReceipt('SHELL V-POWER DIESEL 30,00 x 6,50 195,00', '2026-11-11').fuel === 'ON premium');

// Filtr paliwa w porównaniu stacji i seria do wykresu
const fx = (km, l, p, st, fuel, full = true) => ({ row: km, date: '2026-10-' + String((km / 100) % 28 + 1).padStart(2, '0'), km, liters: l, price: p, total: +(l * p).toFixed(2), station: st, fuel, full });
const mixed = L.computeEntryStats([
  fx(1000, 40, 6, 'Orlen', 'Pb95'), fx(1500, 30, 6, 'Orlen', 'ON premium'), fx(2000, 35, 6, 'BP', 'Pb95'),
]);
const onlyPb = L.computeStationStats(mixed, 'Pb95');
check('filtr paliwa: tylko tankowania Pb95', onlyPb.reduce((n, x) => n + x.fillUps, 0) === 2);
const prem = L.computeStationStats(mixed, 'ON premium');
check('filtr paliwa: ON premium', prem.length === 1 && prem[0].name === 'Orlen');
const ser = L.computeConsumptionSeries(mixed);
check('seria wykresu: 2 odcinki od najstarszego', ser.length === 2 && ser[0].value < 100 && ser[0].date <= ser[1].date);

if (failed) {
  console.log(failed + ' testów nie przeszło');
  process.exit(1);
}
console.log('ALL OK');
