(function () {
  'use strict';

  const CFG = window.APP_CONFIG;
  const L = window.FuelLib;
  const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
  const FUELS = ['Pb95', 'Pb98', 'ON', 'ON premium', 'LPG'];
  const DEFAULT_STATIONS = ['Orlen', 'BP', 'Shell', 'Circle K', 'Lotos', 'Moya', 'Amic', 'MOL'];

  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 2) =>
    n == null || Number.isNaN(n) ? '—' : n.toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('pl-PL'));
  const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
  const todayISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const dec = (s) => {
    const n = parseFloat(String(s).trim().replace(/\s/g, '').replace(',', '.'));
    return Number.isNaN(n) ? null : n;
  };

  const state = {
    token: null,
    tokenExp: 0,
    car: localStorage.getItem('car') || CFG.CARS[0],
    fuel: localStorage.getItem('fuel') || 'Pb95',
    data: {}, // auto -> { entries, lastRow }
    tab: 'home',
    editing: null,
    discMode: 'pl',
    otherStation: false,
    loc: null,
    statFuel: '',
    loaded: false,
  };
  if (!CFG.CARS.includes(state.car)) state.car = CFG.CARS[0];

  try {
    const t = JSON.parse(sessionStorage.getItem('tok') || 'null');
    if (t && t.e > Date.now()) {
      state.token = t.t;
      state.tokenExp = t.e;
    }
  } catch (e) { /* brak zapisanego tokenu */ }

  // ---------- Powiadomienia ----------
  let toastTimer;
  function toast(msg, bad) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = ''), 3500);
  }

  // ---------- Logowanie Google ----------
  let tokenClient = null;

  function showLogin(msg, isErr) {
    state.token = null;
    sessionStorage.removeItem('tok');
    $('#app').hidden = true;
    $('#login-view').hidden = false;
    const el = $('#login-err');
    if (msg) {
      el.textContent = msg;
      el.hidden = false;
      el.className = isErr ? 'err' : 'muted';
    } else {
      el.hidden = true;
    }
  }

  function showApp() {
    $('#login-view').hidden = true;
    $('#app').hidden = false;
    renderAll();
  }

  function onToken(resp) {
    if (resp.error) {
      showLogin('Logowanie nie powiodło się: ' + resp.error, true);
      return;
    }
    state.token = resp.access_token;
    state.tokenExp = Date.now() + (Number(resp.expires_in) - 60) * 1000;
    sessionStorage.setItem('tok', JSON.stringify({ t: state.token, e: state.tokenExp }));
    showApp();
    loadAll();
  }

  function initAuth() {
    if (!(window.google && google.accounts && google.accounts.oauth2)) {
      setTimeout(initAuth, 250);
      return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.CLIENT_ID,
      scope: SCOPE,
      callback: onToken,
      error_callback: (e) => showLogin('Logowanie przerwane (' + (e.type || 'błąd') + '). Spróbuj ponownie.', true),
    });
    $('#login-btn').disabled = false;
  }

  $('#login-btn').addEventListener('click', () => {
    if (tokenClient) tokenClient.requestAccessToken();
  });

  // ---------- Google Sheets API ----------
  async function api(path, opts) {
    if (!state.token || Date.now() > state.tokenExp) {
      showLogin('Sesja wygasła. Zaloguj się ponownie.');
      throw new Error('login');
    }
    const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + CFG.SPREADSHEET_ID + path, {
      ...(opts || {}),
      headers: { Authorization: 'Bearer ' + state.token, 'Content-Type': 'application/json' },
    });
    if (res.status === 401) {
      showLogin('Sesja wygasła. Zaloguj się ponownie.');
      throw new Error('login');
    }
    if (!res.ok) {
      let msg = res.status + ' ' + res.statusText;
      try {
        msg = (await res.json()).error.message;
      } catch (e) { /* zostaje kod HTTP */ }
      throw new Error(msg);
    }
    return res.json();
  }

  function parseRows(rows, extra) {
    const entries = [];
    let lastIdx = -1;
    rows.forEach((r, i) => {
      if (typeof r[1] === 'number' && typeof r[2] === 'number') {
        const num = (v) => (typeof v === 'number' ? v : 0);
        const x = (extra && extra[i]) || [];
        entries.push({
          row: i + 2,
          date: L.serialToISO(r[0]),
          km: r[1],
          liters: r[2],
          price: num(r[3]),
          total: num(r[4]),
          station: String(r[5] == null ? '' : r[5]),
          fuel: String(r[6] == null ? '' : r[6]),
          full: r[7] === true,
          discount: typeof x[0] === 'number' ? x[0] : 0,
          discLiters: typeof x[1] === 'number' ? x[1] : null,
          lat: typeof x[2] === 'number' ? x[2] : null,
          lon: typeof x[3] === 'number' ? x[3] : null,
        });
        lastIdx = i;
      }
    });
    return { entries, lastRow: lastIdx + 2 }; // lastRow = 1, gdy brak danych
  }

  async function loadAll() {
    try {
      const q = [];
      CFG.CARS.forEach((c) => {
        q.push('ranges=' + encodeURIComponent(c + '!A2:H' + CFG.LAST_ROW));
        q.push('ranges=' + encodeURIComponent(c + '!R2:U' + CFG.LAST_ROW));
      });
      const res = await api('/values:batchGet?' + q.join('&') + '&valueRenderOption=UNFORMATTED_VALUE');
      CFG.CARS.forEach((c, i) => {
        const main = (res.valueRanges[2 * i] && res.valueRanges[2 * i].values) || [];
        const extra = (res.valueRanges[2 * i + 1] && res.valueRanges[2 * i + 1].values) || [];
        state.data[c] = parseRows(main, extra);
      });
      state.loaded = true;
      renderAll();
    } catch (e) {
      if (e.message !== 'login') {
        toast('Nie udało się wczytać arkusza: ' + e.message, true);
        $('#view-home').innerHTML = '<div class="card err">Nie udało się wczytać arkusza: ' + esc(e.message) + '</div>';
      }
    }
  }

  // ---------- Zakładki ----------
  const TABS = ['home', 'history', 'stats'];
  function setTab(t) {
    state.tab = t;
    TABS.forEach((v) => ($('#view-' + v).hidden = v !== t));
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    window.scrollTo(0, 0);
  }
  document.querySelector('nav').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) setTab(b.dataset.tab);
  });

  function renderCars() {
    $('#cars').innerHTML = CFG.CARS.map(
      (c) => '<button data-car="' + esc(c) + '" class="' + (c === state.car ? 'active' : '') + '">' + esc(c) + '</button>',
    ).join('');
  }
  $('#cars').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-car]');
    if (!b || b.dataset.car === state.car) return;
    state.car = b.dataset.car;
    localStorage.setItem('car', state.car);
    state.statFuel = '';
    cancelEdit();
    renderAll();
  });

  function renderAll() {
    renderCars();
    renderForm();
    renderHome();
    renderHistory();
    renderStats();
  }

  function knownStations() {
    const seen = new Map();
    CFG.CARS.forEach((c) => {
      const d = state.data[c];
      if (d) d.entries.forEach((e) => { const n = e.station.trim(); if (n) seen.set(n.toLowerCase(), n); });
    });
    return [...seen.values()].filter((n) => !DEFAULT_STATIONS.some((d) => d.toLowerCase() === n.toLowerCase()));
  }

  // ---------- Formularz (wysuwany arkusz) ----------
  function renderForm() {
    const d = state.data[state.car];
    const maxKm = d && d.entries.length ? Math.max(...d.entries.map((e) => e.km)) : null;
    $('#km-hint').textContent = maxKm != null ? 'Poprzedni przebieg: ' + fmtInt(maxKm) + ' km' : '';
    $('#station-list').innerHTML = knownStations().map((n) => '<option value="' + esc(n) + '">').join('');
    renderFuelChips();
    renderStationChips();
    renderDiscMode();
    renderLoc();
    updateTotal();
  }

  function renderFuelChips() {
    $('#fuel-chips').innerHTML = FUELS.map(
      (f) => '<button type="button" class="chip' + (f === state.fuel ? ' on' : '') + '" data-fuel="' + f + '">' + f + '</button>',
    ).join('');
  }
  $('#fuel-chips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-fuel]');
    if (!b) return;
    state.fuel = b.dataset.fuel;
    renderFuelChips();
  });

  function setStation(name) {
    const n = String(name || '').trim();
    $('#f-station').value = n;
    state.otherStation = !!n && !DEFAULT_STATIONS.some((d) => d.toLowerCase() === n.toLowerCase());
    renderStationChips();
  }

  function renderStationChips() {
    const cur = $('#f-station').value.trim().toLowerCase();
    $('#station-chips').innerHTML =
      DEFAULT_STATIONS.map(
        (n) =>
          '<button type="button" class="chip' + (!state.otherStation && n.toLowerCase() === cur ? ' on' : '') + '" data-station="' + esc(n) + '">' + esc(n) + '</button>',
      ).join('') +
      '<button type="button" class="chip' + (state.otherStation ? ' on' : '') + '" data-station="__other">Inna…</button>';
    $('#other-wrap').hidden = !state.otherStation;
  }
  $('#station-chips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-station]');
    if (!b) return;
    if (b.dataset.station === '__other') {
      state.otherStation = true;
      if (DEFAULT_STATIONS.some((d) => d.toLowerCase() === $('#f-station').value.trim().toLowerCase())) $('#f-station').value = '';
      renderStationChips();
      $('#f-station').focus();
    } else {
      setStation(b.dataset.station);
    }
  });

  // Zniżka i kwota razem
  function renderDiscMode() {
    document.querySelectorAll('#disc-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.discMode));
    $('#disc-l-wrap').hidden = state.discMode !== 'pl';
  }
  $('#disc-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    state.discMode = b.dataset.mode;
    renderDiscMode();
    updateTotal();
  });

  function readAmounts() {
    const liters = dec($('#f-liters').value);
    const price = dec($('#f-price').value);
    const dv = dec($('#f-disc').value);
    const dl = dec($('#f-disc-l').value);
    const ok = liters != null && liters > 0 && price != null && price > 0;
    const discount = ok ? L.computeDiscount(state.discMode, dv, dl, liters) : 0;
    const total = ok ? L.computeTotal(liters, price, discount) : null;
    return { liters, price, discount, discLiters: state.discMode === 'pl' && discount > 0 && dl != null && dl > 0 ? Math.min(dl, liters) : null, total };
  }

  function updateTotal() {
    const a = readAmounts();
    const el = $('#f-total-view');
    if (a.total == null) {
      el.textContent = '—';
      return;
    }
    el.innerHTML = fmt(a.total) + ' zł' + (a.discount > 0 ? ' <small>(zniżka −' + fmt(a.discount) + ' zł)</small>' : '');
  }
  ['#f-liters', '#f-price', '#f-disc', '#f-disc-l'].forEach((s) => $(s).addEventListener('input', updateTotal));
  $('#f-station').addEventListener('input', () => {
    state.otherStation = true;
  });

  // Lokalizacja
  function renderLoc() {
    if (state.loc) {
      $('#loc-status').textContent = '📍 Zapisana lokalizacja (' + state.loc.lat.toFixed(4) + ', ' + state.loc.lon.toFixed(4) + ')';
      $('#loc-btn').textContent = 'Usuń';
    } else {
      $('#loc-status').textContent = '📍 Bez lokalizacji';
      $('#loc-btn').textContent = 'Zapisz lokalizację';
    }
  }

  function getLocation() {
    if (!navigator.geolocation) {
      $('#loc-status').textContent = '📍 Ten telefon nie udostępnia lokalizacji';
      return;
    }
    $('#loc-status').textContent = '📍 Ustalam lokalizację…';
    navigator.geolocation.getCurrentPosition(
      (p) => {
        state.loc = { lat: Math.round(p.coords.latitude * 1e5) / 1e5, lon: Math.round(p.coords.longitude * 1e5) / 1e5 };
        renderLoc();
      },
      () => {
        state.loc = null;
        renderLoc();
        $('#loc-status').textContent = '📍 Brak zgody lub nie udało się ustalić lokalizacji';
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }
  $('#loc-btn').addEventListener('click', () => {
    if (state.loc) {
      state.loc = null;
      renderLoc();
    } else {
      getLocation();
    }
  });

  function autoLocationIfAllowed() {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then((r) => {
          if (r.state === 'granted' && !state.loc && !$('#sheet-wrap').hidden) getLocation();
        }).catch(() => {});
      }
    } catch (e) { /* bez automatycznej lokalizacji */ }
  }

  function resetForm() {
    $('#f-date').value = todayISO();
    ['#f-km', '#f-liters', '#f-price', '#f-disc', '#f-disc-l'].forEach((s) => ($(s).value = ''));
    $('#f-full').checked = true;
    $('#form-err').hidden = true;
    $('#ocr-status').hidden = true;
    $('#ocr-raw').hidden = true;
    state.discMode = 'pl';
    state.loc = null;
    setStation('');
    renderForm();
  }

  function openSheet() {
    $('#sheet-wrap').hidden = false;
    document.body.classList.add('lock');
    $('#fab').hidden = true;
    $('#sheet-title').textContent = state.editing ? 'Edycja tankowania' : 'Nowe tankowanie';
    renderForm();
    if (!state.editing) autoLocationIfAllowed();
  }
  function closeSheet() {
    $('#sheet-wrap').hidden = true;
    document.body.classList.remove('lock');
    $('#fab').hidden = false;
  }
  $('#fab').addEventListener('click', openSheet);
  $('#sheet-dim').addEventListener('click', () => { if (state.editing) cancelEdit(); else closeSheet(); });
  $('#sheet-close').addEventListener('click', () => { if (state.editing) cancelEdit(); else closeSheet(); });

  function cancelEdit() {
    if (state.editing) {
      state.editing = null;
      $('#edit-banner').hidden = true;
      $('#cancel-edit').hidden = true;
      $('#save-btn').textContent = 'Zapisz tankowanie';
      resetForm();
    }
    closeSheet();
  }
  $('#cancel-edit').addEventListener('click', cancelEdit);

  function startEdit(entry) {
    state.editing = entry;
    $('#f-date').value = entry.date || todayISO();
    $('#f-km').value = entry.km;
    $('#f-liters').value = entry.liters;
    $('#f-price').value = entry.price;
    $('#f-full').checked = entry.full;
    state.discMode = 'sum';
    $('#f-disc').value = entry.discount > 0 ? entry.discount : '';
    $('#f-disc-l').value = '';
    state.loc = entry.lat != null && entry.lon != null ? { lat: entry.lat, lon: entry.lon } : null;
    setStation(entry.station);
    state.fuel = FUELS.includes(entry.fuel) ? entry.fuel : state.fuel;
    $('#edit-banner').textContent = 'Edytujesz tankowanie z ' + fmtDate(entry.date) + ' (' + state.car + ')';
    $('#edit-banner').hidden = false;
    $('#cancel-edit').hidden = false;
    $('#save-btn').textContent = 'Zapisz zmiany';
    $('#form-err').hidden = true;
    openSheet();
  }

  // ---------- Pulpit, historia ----------
  function chartSvg(series) {
    if (series.length < 2) {
      return '<p class="muted" style="margin:10px 0 0">Wykres spalania pojawi się po dwóch zmierzonych odcinkach (trzy tankowania do pełna).</p>';
    }
    const pts = series.slice(-12);
    const W = 340, H = 150, pl = 30, pr = 12, pt = 18, pb = 22;
    let lo = Math.min(...pts.map((p) => p.value));
    let hi = Math.max(...pts.map((p) => p.value));
    if (hi - lo < 0.6) { const m = (hi + lo) / 2; lo = m - 0.3; hi = m + 0.3; }
    const padv = (hi - lo) * 0.15;
    lo -= padv; hi += padv;
    const x = (i) => pl + (i * (W - pl - pr)) / (pts.length - 1);
    const y = (v) => pt + ((hi - v) * (H - pt - pb)) / (hi - lo);
    const dm = (iso) => (iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) : '');
    let g = '';
    [lo, (lo + hi) / 2, hi].forEach((v) => {
      g += '<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
        '<text x="0" y="' + (y(v) + 3).toFixed(1) + '">' + fmt(v, 1) + '</text>';
    });
    const line = pts.map((p, i) => x(i).toFixed(1) + ',' + y(p.value).toFixed(1)).join(' ');
    let dots = '';
    pts.forEach((p, i) => {
      dots += '<circle class="dot" cx="' + x(i).toFixed(1) + '" cy="' + y(p.value).toFixed(1) + '" r="3.5"/>';
      if (pts.length <= 8 || i === pts.length - 1) {
        dots += '<text class="val" text-anchor="middle" x="' + x(i).toFixed(1) + '" y="' + (y(p.value) - 8).toFixed(1) + '">' + fmt(p.value, 1) + '</text>';
      }
    });
    let xl = '<text x="' + x(0) + '" y="' + (H - 6) + '" text-anchor="start">' + dm(pts[0].date) + '</text>' +
      '<text x="' + x(pts.length - 1) + '" y="' + (H - 6) + '" text-anchor="end">' + dm(pts[pts.length - 1].date) + '</text>';
    if (pts.length >= 5) {
      const mi = Math.floor((pts.length - 1) / 2);
      xl += '<text x="' + x(mi).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + dm(pts[mi].date) + '</text>';
    }
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Spalanie w czasie">' + g +
      '<polyline class="ln" points="' + line + '"/>' + dots + xl + '</svg>';
  }

  function entryHtml(s) {
    const e = s.entry;
    let note;
    if (s.consumption != null) {
      note =
        '<div class="cons">' + fmt(s.consumption) + ' l/100 km · ' + fmt(s.costPer100) + ' zł/100 km <span class="muted">(' + fmtInt(s.segKm) + ' km)</span></div>';
    } else if (!e.full) {
      note = '<div class="muted" style="margin-top:6px">Tankowanie częściowe</div>';
    } else {
      note = '<div class="muted" style="margin-top:6px">Punkt odniesienia, spalanie od następnego pełnego tankowania</div>';
    }
    const hasLoc = e.lat != null && e.lon != null;
    const mapUrl = hasLoc ? 'https://www.google.com/maps?q=' + e.lat + ',' + e.lon : '';
    return (
      '<div class="card entry" data-row="' + e.row + '">' +
      '<div class="top"><div><b>' + fmtDate(e.date) + '</b> · ' + esc(e.station) + (hasLoc ? ' 📍' : '') +
      '<div class="muted">' + esc(e.fuel) + ' · ' + fmt(e.liters) + ' l × ' + fmt(e.price) + ' zł/l · ' + fmtInt(e.km) + ' km' +
      (e.discount > 0 ? ' · zniżka −' + fmt(e.discount) + ' zł' : '') + '</div></div>' +
      '<div class="big">' + fmt(e.total) + ' zł</div></div>' + note +
      '<div class="actions"><button data-act="edit">Edytuj</button>' +
      (hasLoc ? '<a href="' + mapUrl + '" target="_blank" rel="noopener">Mapa</a>' : '') +
      '<button class="del" data-act="del">Usuń</button></div></div>'
    );
  }

  function renderHome() {
    const box = $('#view-home');
    const d = state.data[state.car];
    if (!d) {
      box.innerHTML = '<div class="center muted"><span class="spin"></span> Wczytuję dane…</div>';
      return;
    }
    const stats = L.computeEntryStats(d.entries);
    if (!stats.length) {
      box.innerHTML = '<div class="card center muted">Brak tankowań dla ' + esc(state.car) + '.<br>Dotknij „+”, żeby dodać pierwsze.</div>';
      return;
    }
    const o = L.computeOverall(stats);
    const st = L.computeStationStats(stats);
    const best = st.length && st[0].costPer100 != null ? st[0].name : '—';
    box.innerHTML =
      '<div class="card"><div class="hero"><div class="stat"><div class="l">Śr. spalanie</div><div class="num">' +
      (o.avgConsumption != null ? fmt(o.avgConsumption, 1) + ' <small>l/100</small>' : '—') + '</div></div>' +
      '<div class="stat r"><div class="l">Koszt / 100 km</div><div class="num">' + (o.avgCostPer100 != null ? fmt(o.avgCostPer100, 1) + ' zł' : '—') + '</div></div></div>' +
      chartSvg(L.computeConsumptionSeries(stats)) + '</div>' +
      '<div class="card"><div class="grid3">' +
      '<div class="stat"><div class="l">Wydano</div><div class="v">' + fmt(o.totalCost, 0) + ' zł</div></div>' +
      '<div class="stat"><div class="l">Tankowań</div><div class="v">' + o.count + '</div></div>' +
      '<div class="stat"><div class="l">Najtaniej</div><div class="v">' + esc(best) + '</div></div></div></div>' +
      stats.slice(0, 3).map(entryHtml).join('') +
      (stats.length > 3 ? '<button class="more" data-more="1">Cała historia (' + stats.length + ') ›</button>' : '');
  }
  $('#view-home').addEventListener('click', (e) => {
    if (e.target.closest('button[data-more]')) setTab('history');
  });

  function renderHistory() {
    const box = $('#view-history');
    const d = state.data[state.car];
    if (!d) {
      box.innerHTML = '<div class="center muted"><span class="spin"></span> Wczytuję dane…</div>';
      return;
    }
    const stats = L.computeEntryStats(d.entries);
    if (!stats.length) {
      box.innerHTML = '<div class="card center muted">Brak tankowań dla ' + esc(state.car) + '.</div>';
      return;
    }
    const o = L.computeOverall(stats);
    box.innerHTML =
      '<div class="card"><div class="grid3">' +
      '<div class="stat"><div class="l">Tankowań</div><div class="v">' + o.count + '</div></div>' +
      '<div class="stat"><div class="l">Litry</div><div class="v">' + fmt(o.totalLiters, 1) + '</div></div>' +
      '<div class="stat"><div class="l">Śr. cena</div><div class="v">' + (o.avgPrice != null ? fmt(o.avgPrice) + ' zł' : '—') + '</div></div>' +
      '</div></div>' + stats.map(entryHtml).join('');
  }

  async function onEntryClick(e) {
    const card = e.target.closest('.entry');
    if (!card) return;
    const row = Number(card.dataset.row);
    const act = e.target.closest('button[data-act]');
    if (!act) {
      if (!e.target.closest('a')) card.classList.toggle('open');
      return;
    }
    const d = state.data[state.car];
    const entry = d.entries.find((x) => x.row === row);
    if (!entry) return;
    if (act.dataset.act === 'edit') {
      startEdit(entry);
    } else if (act.dataset.act === 'del') {
      if (!confirm('Usunąć tankowanie z ' + fmtDate(entry.date) + ' (' + entry.station + ', ' + fmt(entry.liters) + ' l)?')) return;
      try {
        await api('/values:batchClear', {
          method: 'POST',
          body: JSON.stringify({ ranges: [state.car + '!A' + row + ':H' + row, state.car + '!R' + row + ':U' + row] }),
        });
        toast('Usunięto');
        await loadAll();
      } catch (err) {
        if (err.message !== 'login') toast('Nie udało się usunąć: ' + err.message, true);
      }
    }
  }
  $('#view-history').addEventListener('click', onEntryClick);
  $('#view-home').addEventListener('click', onEntryClick);

  // ---------- Stacje ----------
  function renderStats() {
    const box = $('#view-stats');
    const d = state.data[state.car];
    if (!d) {
      box.innerHTML = '<div class="center muted"><span class="spin"></span> Wczytuję dane…</div>';
      return;
    }
    const stats = L.computeEntryStats(d.entries);
    const present = FUELS.filter((f) => d.entries.some((e) => e.fuel === f));
    if (state.statFuel && !present.includes(state.statFuel)) state.statFuel = '';
    const stations = L.computeStationStats(stats, state.statFuel || undefined);
    let html = '<h2>' + esc(state.car) + ': porównanie stacji</h2>';
    if (present.length > 1) {
      html += '<div class="chips" style="margin:0 0 10px"><button class="chip' + (state.statFuel ? '' : ' on') + '" data-sf="">Wszystkie paliwa</button>' +
        present.map((f) => '<button class="chip' + (state.statFuel === f ? ' on' : '') + '" data-sf="' + esc(f) + '">' + esc(f) + '</button>').join('') + '</div>';
    }
    if (!stations.length) {
      html += '<div class="card muted">Brak danych.</div>';
    } else {
      html +=
        '<div class="card"><table><thead><tr><th>Stacja</th><th>Tank.</th><th>zł/l*</th><th>l/100</th><th>zł/100</th></tr></thead><tbody>' +
        stations
          .map(
            (s, i) =>
              '<tr' + (i === 0 && s.costPer100 != null ? ' style="font-weight:700;color:var(--accent)"' : '') + '><td>' + esc(s.name) + '</td><td>' + s.fillUps +
              '</td><td>' + fmt(s.avgPrice) + '</td><td>' + fmt(s.avgConsumption) + '</td><td>' + fmt(s.costPer100) + '</td></tr>',
          )
          .join('') +
        '</tbody></table>' +
        '<p class="muted" style="margin:10px 0 0">* średnia cena po zniżkach, ważona litrami. Ranking wg kosztu na 100 km. Spalanie liczone z odcinków, które zaczęły się pełnym tankowaniem na danej stacji. ' +
        'To przybliżenie: wpływ mają też trasa, pogoda i styl jazdy, więc wnioski mają sens po kilku tankowaniach na stację.</p></div>';
    }

    html += '<h2>Wszystkie samochody</h2><div class="card"><table><thead><tr><th>Auto</th><th>Tank.</th><th>l/100</th><th>zł/100</th><th>Wydano</th></tr></thead><tbody>';
    CFG.CARS.forEach((c) => {
      const cd = state.data[c];
      const o = L.computeOverall(cd ? L.computeEntryStats(cd.entries) : []);
      html +=
        '<tr><td>' + esc(c) + '</td><td>' + o.count + '</td><td>' + fmt(o.avgConsumption) + '</td><td>' + fmt(o.avgCostPer100) +
        '</td><td>' + fmt(o.totalCost, 0) + ' zł</td></tr>';
    });
    html += '</tbody></table></div>';
    box.innerHTML = html;
  }
  $('#view-stats').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sf]');
    if (!b) return;
    state.statFuel = b.dataset.sf;
    renderStats();
  });

  // ---------- Zapis tankowania ----------
  function showFormError(msg) {
    const el = $('#form-err');
    el.textContent = msg;
    el.hidden = false;
    el.scrollIntoView({ block: 'nearest' });
  }

  $('#save-btn').addEventListener('click', async () => {
    $('#form-err').hidden = true;
    const d = state.data[state.car];
    if (!d) return showFormError('Dane z arkusza jeszcze się nie wczytały. Poczekaj chwilę i spróbuj ponownie.');

    const date = $('#f-date').value;
    const km = Math.round(dec($('#f-km').value) || 0);
    const a = readAmounts();
    const station = $('#f-station').value.trim();

    if (!date) return showFormError('Podaj datę.');
    if (km <= 0) return showFormError('Podaj przebieg w km.');
    if (a.liters == null || a.price == null || !(a.liters > 0) || !(a.price > 0)) return showFormError('Podaj litry i cenę za litr.');
    if (a.total == null || a.total <= 0) return showFormError('Zniżka nie może być większa niż wartość paliwa.');
    if (!station) return showFormError('Wybierz stację albo wpisz własną („Inna…”).');

    const maxKm = d.entries.filter((e) => !state.editing || e.row !== state.editing.row).reduce((m, e) => Math.max(m, e.km), 0);
    if (!state.editing && maxKm > 0 && km <= maxKm) {
      if (!confirm('Przebieg (' + fmtInt(km) + ' km) nie jest większy od poprzedniego (' + fmtInt(maxKm) + ' km). Zapisać mimo to?')) return;
    }

    const row = state.editing ? state.editing.row : d.lastRow + 1;
    if (row > CFG.LAST_ROW) {
      return showFormError('Formuły w arkuszu są przygotowane do wiersza ' + CFG.LAST_ROW + '. Przeciągnij formuły w kolumnach I–P niżej w Google Sheets.');
    }

    const btn = $('#save-btn');
    btn.disabled = true;
    try {
      await api('/values:batchUpdate', {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: [
            { range: state.car + '!A' + row + ':H' + row, majorDimension: 'ROWS', values: [[date, km, a.liters, a.price, a.total, station, state.fuel, $('#f-full').checked]] },
            {
              range: state.car + '!R' + row + ':U' + row,
              majorDimension: 'ROWS',
              values: [[a.discount > 0 ? a.discount : '', a.discLiters != null ? a.discLiters : '', state.loc ? state.loc.lat : '', state.loc ? state.loc.lon : '']],
            },
          ],
        }),
      });
      localStorage.setItem('fuel', state.fuel);
      const wasEdit = !!state.editing;
      state.editing = null;
      $('#edit-banner').hidden = true;
      $('#cancel-edit').hidden = true;
      btn.textContent = 'Zapisz tankowanie';
      resetForm();
      closeSheet();
      toast(wasEdit ? 'Zapisano zmiany' : 'Zapisano tankowanie');
      await loadAll();
      setTab('home');
    } catch (err) {
      if (err.message !== 'login') showFormError('Nie udało się zapisać: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Zdjęcie paragonu (OCR na telefonie) ----------
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Nie udało się pobrać modułu rozpoznawania tekstu. Sprawdź internet.'));
      document.head.appendChild(s);
    });
  }

  async function prepareImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const scale = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      // skala szarości i rozciągnięcie kontrastu
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const px = id.data;
      let lo = 255;
      let hi = 0;
      for (let i = 0; i < px.length; i += 4) {
        const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
        px[i] = px[i + 1] = px[i + 2] = g;
        if (g < lo) lo = g;
        if (g > hi) hi = g;
      }
      const range = Math.max(1, hi - lo);
      for (let i = 0; i < px.length; i += 4) {
        const v = (((px[i] - lo) * 255) / range) | 0;
        px[i] = px[i + 1] = px[i + 2] = v;
      }
      ctx.putImageData(id, 0, 0);
      return c;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function setOcrStatus(msg) {
    const el = $('#ocr-status');
    el.textContent = msg;
    el.hidden = false;
  }

  $('#photo').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setOcrStatus('Przygotowuję zdjęcie…');
    if (!state.loc && !state.editing) getLocation();
    try {
      const canvas = await prepareImage(file);
      setOcrStatus('Pobieram moduł rozpoznawania (przy pierwszym użyciu to chwilę trwa)…');
      await loadTesseract();
      const { data } = await Tesseract.recognize(canvas, 'pol', {
        logger: (m) => {
          if (m.status === 'recognizing text') setOcrStatus('Odczytuję paragon… ' + Math.round(m.progress * 100) + '%');
        },
      });
      $('#ocr-text').textContent = data.text;
      $('#ocr-raw').hidden = false;

      const p = L.parseReceipt(data.text, todayISO());
      if (p.liters != null) $('#f-liters').value = p.liters;
      if (p.price != null) $('#f-price').value = p.price;
      if (p.station) setStation(p.station);
      if (p.fuel) state.fuel = p.fuel;
      if (p.date) $('#f-date').value = p.date;
      renderFuelChips();
      updateTotal();

      if (p.liters == null && p.price == null && p.total == null) {
        setOcrStatus('Nie rozpoznałem liczb. Zrób zdjęcie z bliska, prosto i przy dobrym świetle albo wpisz dane ręcznie.');
      } else {
        setOcrStatus('Odczytano: ' + fmt(p.liters) + ' l · ' + fmt(p.price) + ' zł/l · ' + fmt(p.total) + ' zł. Sprawdź dane i wpisz przebieg.');
        $('#f-km').focus();
      }
    } catch (err) {
      setOcrStatus('Błąd odczytu: ' + err.message);
    }
  });

  // ---------- Start ----------
  $('#f-date').value = todayISO();
  renderDiscMode();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* aplikacja działa też bez tego */ });
  }

  if (/^WKLEJ/.test(CFG.CLIENT_ID)) {
    showLogin('Brak Client ID. Uzupełnij plik config.js zgodnie z README.md (krok 1).', true);
    $('#login-btn').disabled = true;
  } else {
    $('#login-btn').disabled = true;
    initAuth();
    if (state.token) {
      showApp();
      loadAll();
    } else {
      showLogin();
    }
  }
})();
