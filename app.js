/* My Budget Snowball - client-only PWA (localStorage) */

/* Show any JS errors as an alert so nothing fails silently */
window.onerror = function (msg, src, line, col) {
  alert("App error:\n" + msg + "\n" + (src || "") + "\nLine " + line + ":" + col);
  return false;
};

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "mybudget.v1";

function todayISO(d = new Date()) {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
}

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "CAD" });
}

function clampNonNeg(n) {
  return Math.max(0, Number(n || 0));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const el = $("dataStatus");
  if (el) el.textContent = "Saved " + new Date().toLocaleString();
}

function defaultState() {
  return {
    settings: { groceries: 250, buffer: 0, lumpRule: 100 },
    debts: [
      { name: "Capital One Gold", balance: 300, min: 25 },
      { name: "Simplii", balance: 1500, min: 40 },
      { name: "Triangle", balance: 4881, min: 193 },
      { name: "Rewards", balance: 4937, min: 150 } // temporary until statement posts
    ],
    bills: [
      { name: "Rent", amount: 1650, freq: "monthly", dueDay: 1 },
      { name: "Uber One", amount: 11.29, freq: "monthly", dueDay: 3 },
      { name: "La Fitness", amount: 33.89, freq: "monthly", dueDay: 8 },
      { name: "Simplii", amount: 40, freq: "monthly", dueDay: 9 },
      { name: "Apple", amount: 28.24, freq: "monthly", dueDay: 12 },
      { name: "Apple", amount: 7.9, freq: "monthly", dueDay: 14 },
      { name: "Netflix", amount: 9.03, freq: "monthly", dueDay: 15 },
      { name: "Bell", amount: 67.8, freq: "monthly", dueDay: 15 },
      { name: "Capital One", amount: 300, freq: "monthly", dueDay: 18 },
      { name: "La Fitness", amount: 57, freq: "monthly", dueDay: 18 },
      { name: "Apple", amount: 10.68, freq: "monthly", dueDay: 23 },
      { name: "Google One", amount: 3.15, freq: "monthly", dueDay: 23 },
      { name: "Rogers", amount: 264.83, freq: "monthly", dueDay: 23 },
      { name: "Amazon Channels", amount: 10.16, freq: "monthly", dueDay: 24 },
      { name: "Amazon Channels", amount: 12.42, freq: "monthly", dueDay: 24 },
      { name: "Belair Direct", amount: 226, freq: "monthly", dueDay: 28 },
      { name: "Spotify", amount: 14.34, freq: "monthly", dueDay: 28 },
      { name: "Triangle", amount: 193, freq: "monthly", dueDay: 28 },

      // Every payday:
      { name: "Easy Financial", amount: 182, freq: "biweekly", dueDay: 0 },
      { name: "Car Loan", amount: 286, freq: "biweekly", dueDay: 0 }
    ],
    log: []
  };
}

/* Date helpers */
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function withinRange(d, start, end) {
  const t = startOfDay(d).getTime();
  return t >= startOfDay(start).getTime() && t <= startOfDay(end).getTime();
}

/* Return the next due date on/after runDate for a monthly dueDay (1..31) */
function nextDueDateForMonthly(runDate, dueDay) {
  const d0 = startOfDay(runDate);
  const year = d0.getFullYear();
  const month = d0.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dd = Math.min(Math.max(1, dueDay), daysInMonth);
  let cand = new Date(year, month, dd);

  if (cand < d0) {
    const ny = month === 11 ? year + 1 : year;
    const nm = (month + 1) % 12;
    const daysInNext = new Date(ny, nm + 1, 0).getDate();
    const dd2 = Math.min(Math.max(1, dueDay), daysInNext);
    cand = new Date(ny, nm, dd2);
  }
  return cand;
}

function sortDebts(debts) {
  return [...debts].sort((a, b) => (clampNonNeg(a.balance) - clampNonNeg(b.balance)));
}

function computeBillsDue(bills, runDate, nextPayDate) {
  const items = [];
  let total = 0;

  for (const b of bills) {
    const amt = clampNonNeg(b.amount);

    if (b.freq === "biweekly") {
      items.push({ name: b.name, amount: amt, due: "every pay" });
      total += amt;
      continue;
    }

    if (b.freq === "monthly") {
      const dd = Number(b.dueDay || 0);
      if (dd < 1 || dd > 31) continue;

      const dueDate = nextDueDateForMonthly(runDate, dd);
      if (withinRange(dueDate, runDate, nextPayDate)) {
        items.push({ name: b.name, amount: amt, due: dueDate.toISOString().slice(0, 10) });
        total += amt;
      }
    }
  }

  // Sort monthly due dates (keeps things readable)
  items.sort((x, y) => String(x.due).localeCompare(String(y.due)));

  return { items, total };
}

/* Main plan calculation */
function computeSnowballPlan(state, payAmount, runDate, cycleDays) {
  const pay = clampNonNeg(payAmount);
  const cycle = Number(cycleDays || 14);
  const settings = state.settings || { groceries: 250, buffer: 0 };

  const groceries = clampNonNeg(settings.groceries);
  const buffer = clampNonNeg(settings.buffer);

  const nextPayDate = addDays(runDate, cycle);

  const billsDue = computeBillsDue(state.bills || [], runDate, nextPayDate);
  const protectedTotal = groceries + buffer + billsDue.total;

  const debtsSorted = sortDebts(state.debts || []).filter(d => clampNonNeg(d.balance) > 0.01);

  const minsTotal = debtsSorted.reduce((s, d) => s + clampNonNeg(d.min), 0);

  const issues = [];
  if (protectedTotal > pay + 0.01) {
    issues.push({
      type: "danger",
      msg: "Bills + groceries + buffer (" + money(protectedTotal) + ") exceed pay (" + money(pay) + ")."
    });
  } else if (protectedTotal + minsTotal > pay + 0.01) {
    issues.push({
      type: "danger",
      msg: "After protecting bills/groceries, card minimums (" + money(minsTotal) + ") are not covered."
    });
  }

  const availableForDebt = Math.max(0, pay - protectedTotal);
  const extra = Math.max(0, availableForDebt - minsTotal);

  // Start with mins on all, extra goes to smallest balance first
  const allocations = debtsSorted.map(d => ({
    name: d.name,
    balance: clampNonNeg(d.balance),
    min: clampNonNeg(d.min),
    pay: clampNonNeg(d.min)
  }));

  if (allocations.length) {
    allocations[0].pay += extra;

    // ✅ HARD CAP + ROLL FORWARD:
    // never pay more than balance; carry leftover to the next debt(s)
    let carry = 0;
    for (let i = 0; i < allocations.length; i++) {
      allocations[i].pay += carry;
      carry = 0;

      const bal = allocations[i].balance;
      if (allocations[i].pay > bal) {
        carry = allocations[i].pay - bal;
        allocations[i].pay = bal;
      }
    }

    if (carry > 0.01) {
      issues.push({
        type: "ok",
        msg: "All listed debts would be paid off with " + money(carry) + " left over."
      });
    }
  }

  const forecast = approximateForecast(debtsSorted, allocations, cycle, runDate);

  return {
    runDate: runDate.toISOString().slice(0, 10),
    nextPayDate: nextPayDate.toISOString().slice(0, 10),
    pay,
    groceries,
    buffer,
    billsDue,
    protectedTotal,
    minsTotal,
    availableForDebt,
    extra,
    allocations,
    issues,
    forecast
  };
}

/* Forecast (approx; no interest) */
function approximateForecast(debtsSorted, allocationsNow, cycleDays, runDate) {
  const balances = debtsSorted.map(d => ({
    name: d.name,
    bal: clampNonNeg(d.balance),
    min: clampNonNeg(d.min)
  }));

  const totalDebtPay = allocationsNow.reduce((s, a) => s + clampNonNeg(a.pay), 0);
  const results = [];

  let snowball = 0;
  let current = new Date(runDate);

  // Simulate up to 80 cycles (plenty)
  for (let step = 0; step < 80 && balances.length; step++) {
    balances.sort((a, b) => a.bal - b.bal);

    const minsSum = balances.reduce((s, x) => s + x.min, 0);
    const extraBase = Math.max(0, totalDebtPay - minsSum);
    let extra = extraBase + snowball;

    // pay minimums
    for (const x of balances) {
      x.bal = Math.max(0, x.bal - x.min);
    }
    // pay extra to smallest
    if (balances.length) {
      balances[0].bal = Math.max(0, balances[0].bal - extra);
    }

    // remove cleared, add mins to snowball
    const cleared = [];
    for (let i = balances.length - 1; i >= 0; i--) {
      if (balances[i].bal <= 0.01) {
        cleared.push(balances[i]);
        snowball += balances[i].min;
        balances.splice(i, 1);
      }
    }

    current = addDays(current, cycleDays);

    for (const c of cleared) {
      results.push({ card: c.name, payoffDate: current.toISOString().slice(0, 10) });
    }

    // If payments can't progress, stop
    if (totalDebtPay <= 0.01) break;
  }

  const debtFreeDate = results.length ? results[results.length - 1].payoffDate : null;
  return { payoffs: results, debtFreeDate };
}

/* UI Rendering */
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showTab(name) {
  document.querySelectorAll(".tab").forEach(t => (t.style.display = "none"));
  const el = document.querySelector("#tab-" + name);
  if (el) el.style.display = "block";
  document.querySelectorAll("nav button").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === name);
  });
}

function renderBillsTable(state) {
  const rows = state.bills || [];
  let html = `<tr><th>Bill</th><th>Amount</th><th>Due</th><th>Frequency</th><th></th></tr>`;
  rows.forEach((b, idx) => {
    html += `<tr>
      <td><input data-b-idx="${idx}" data-b-k="name" value="${escapeHtml(b.name)}"></td>
      <td><input type="number" step="0.01" data-b-idx="${idx}" data-b-k="amount" value="${Number(b.amount || 0)}"></td>
      <td><input type="number" step="1" data-b-idx="${idx}" data-b-k="dueDay" value="${Number(b.dueDay || 0)}"></td>
      <td>
        <select data-b-idx="${idx}" data-b-k="freq">
          <option value="monthly"${b.freq === "monthly" ? " selected" : ""}>monthly</option>
          <option value="biweekly"${b.freq === "biweekly" ? " selected" : ""}>biweekly</option>
        </select>
      </td>
      <td><button class="secondary" data-del-bill="${idx}">Delete</button></td>
    </tr>`;
  });
  $("billsTable").innerHTML = html;

  $("billsTable").querySelectorAll("input,select").forEach(el => {
    el.addEventListener("change", () => {
      const i = Number(el.getAttribute("data-b-idx"));
      const k = el.getAttribute("data-b-k");
      const v = k === "amount" || k === "dueDay" ? Number(el.value) : el.value;
      state.bills[i][k] = v;
      saveState(state);
    });
  });

  $("billsTable").querySelectorAll("button[data-del-bill]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-del-bill"));
      state.bills.splice(i, 1);
      saveState(state);
      renderBillsTable(state);
    });
  });
}

function renderDebtsTable(state) {
  const rows = state.debts || [];
  let html = `<tr><th>Card</th><th>Balance</th><th>Min</th><th></th></tr>`;
  rows.forEach((d, idx) => {
    html += `<tr>
      <td><input data-d-idx="${idx}" data-d-k="name" value="${escapeHtml(d.name)}"></td>
      <td><input type="number" step="0.01" data-d-idx="${idx}" data-d-k="balance" value="${Number(d.balance || 0)}"></td>
      <td><input type="number" step="0.01" data-d-idx="${idx}" data-d-k="min" value="${Number(d.min || 0)}"></td>
      <td><button class="secondary" data-del-debt="${idx}">Delete</button></td>
    </tr>`;
  });
  $("debtsTable").innerHTML = html;

  $("debtsTable").querySelectorAll("input").forEach(el => {
    el.addEventListener("change", () => {
      const i = Number(el.getAttribute("data-d-idx"));
      const k = el.getAttribute("data-d-k");
      const v = k === "balance" || k === "min" ? Number(el.value) : el.value;
      state.debts[i][k] = v;
      saveState(state);
    });
  });

  $("debtsTable").querySelectorAll("button[data-del-debt]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-del-debt"));
      state.debts.splice(i, 1);
      saveState(state);
      renderDebtsTable(state);
    });
  });
}

function renderLog(state) {
  const rows = state.log || [];
  let html = `<tr><th>Date</th><th>Pay</th><th>Bills</th><th>Groceries</th><th>Debt extra</th><th>Target</th><th>Target pay</th><th></th></tr>`;
  rows.slice().reverse().forEach((r, idxFromEnd) => {
    const idx = rows.length - 1 - idxFromEnd;
    html += `<tr>
      <td>${escapeHtml(r.runDate)}</td>
      <td>${money(r.pay)}</td>
      <td>${money(r.bills)}</td>
      <td>${money(r.groceries)}</td>
      <td>${money(r.extra)}</td>
      <td>${escapeHtml(r.target || "")}</td>
      <td>${money(r.targetPay || 0)}</td>
      <td><button class="secondary" data-del-log="${idx}">Delete</button></td>
    </tr>`;
  });
  $("logTable").innerHTML = html;

  $("logTable").querySelectorAll("button[data-del-log]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-del-log"));
      state.log.splice(i, 1);
      saveState(state);
      renderLog(state);
    });
  });
}

function renderResults(res) {
  $("resultsCard").style.display = "block";

  const kpis = [
    { k: "Next payday", v: res.nextPayDate },
    { k: "Protected (bills + groceries + buffer)", v: money(res.protectedTotal) },
    { k: "Available for debt", v: money(res.availableForDebt) },
    { k: "Extra to snowball (after mins)", v: money(res.extra) }
  ];

  $("kpis").innerHTML = kpis
    .map(x => `<div class="tile"><div class="k">${escapeHtml(x.k)}</div><div class="v">${escapeHtml(x.v)}</div></div>`)
    .join("");

  // Bills due table
  let billsHtml = `<h3 style="margin:0 0 10px">Bills due before next pay</h3>`;
  billsHtml += `<table><tr><th>Bill</th><th>Due</th><th>Amount</th></tr>`;
  res.billsDue.items.forEach(i => {
    billsHtml += `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.due)}</td><td>${money(i.amount)}</td></tr>`;
  });
  billsHtml += `<tr><td><strong>Total</strong></td><td></td><td><strong>${money(res.billsDue.total)}</strong></td></tr></table>`;

  // Debt allocation table
  let debtHtml = `<h3 style="margin:16px 0 10px">Debt payments this pay</h3>`;
  debtHtml += `<table><tr><th>Card</th><th>Balance</th><th>Min</th><th>Pay</th><th>New balance</th></tr>`;
  res.allocations.forEach(a => {
    const newBal = Math.max(0, a.balance - a.pay);
    debtHtml += `<tr><td>${escapeHtml(a.name)}</td><td>${money(a.balance)}</td><td>${money(a.min)}</td><td><strong>${money(a.pay)}</strong></td><td>${money(newBal)}</td></tr>`;
  });
  debtHtml += `</table>`;

  // Forecast
  let fcHtml = `<h3 style="margin:16px 0 10px">Approx payoff forecast (no interest)</h3>`;
  if (res.forecast.debtFreeDate) {
    fcHtml += `<p class="note">Estimated debt-free date: <strong class="ok">${escapeHtml(res.forecast.debtFreeDate)}</strong></p>`;
  } else {
    fcHtml += `<p class="note warn">Forecast unavailable.</p>`;
  }

  if (res.forecast.payoffs && res.forecast.payoffs.length) {
    fcHtml += `<table><tr><th>Card</th><th>Estimated payoff date</th></tr>`;
    res.forecast.payoffs.forEach(p => {
      fcHtml += `<tr><td>${escapeHtml(p.card)}</td><td>${escapeHtml(p.payoffDate)}</td></tr>`;
    });
    fcHtml += `</table>`;
  }

  $("planTables").innerHTML = billsHtml + debtHtml + fcHtml;

  const warn = (res.issues || [])
    .map(i => {
      const cls = i.type === "danger" ? "danger" : i.type === "warn" ? "warn" : "ok";
      return `<div class="${cls}">• ${escapeHtml(i.msg)}</div>`;
    })
    .join("");

  $("warnings").innerHTML = warn || `<span class="ok">Everything is covered. Snowball is safe.</span>`;
}

function render() {
  const state = window.__state;

  // Settings
  $("groceries").value = state.settings?.groceries ?? 250;
  $("buffer").value = state.settings?.buffer ?? 0;
  $("lumpRule").value = String(state.settings?.lumpRule ?? 100);

  // Tables
  renderBillsTable(state);
  renderDebtsTable(state);
  renderLog(state);

  // Run defaults
  $("runDate").value = todayISO();
  $("runHint").textContent =
    "Tip: Add this to Home Screen in Safari (Share → Add to Home Screen) for an app-like experience. Data stays on your phone.";
}

function init() {
  let state = loadState();
  if (!state) state = defaultState();
  window.__state = state;

  // Tab buttons
  document.querySelectorAll("nav button").forEach(btn => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });

  // Buttons
  $("btnResetBills").addEventListener("click", () => {
    state.bills = defaultState().bills;
    saveState(state);
    renderBillsTable(state);
  });

  $("btnResetDebts").addEventListener("click", () => {
    state.debts = defaultState().debts;
    saveState(state);
    renderDebtsTable(state);
  });

  $("btnAddBill").addEventListener("click", () => {
    state.bills.push({ name: "New bill", amount: 0, dueDay: 1, freq: "monthly" });
    saveState(state);
    renderBillsTable(state);
  });

  $("btnAddDebt").addEventListener("click", () => {
    state.debts.push({ name: "New card", balance: 0, min: 0 });
    saveState(state);
    renderDebtsTable(state);
  });

  $("btnSaveSettings").addEventListener("click", () => {
    state.settings.groceries = Number($("groceries").value || 0);
    state.settings.buffer = Number($("buffer").value || 0);
    state.settings.lumpRule = Number($("lumpRule").value || 100);
    saveState(state);
  });

  $("btnRun").addEventListener("click", () => {
    const pay = Number($("payAmount").value || 0);
    const cycleDays = Number($("cycleDays").value || 14);
    const rd = $("runDate").value ? new Date($("runDate").value + "T12:00:00") : new Date();
    const res = computeSnowballPlan(state, pay, rd, cycleDays);
    window.__lastResult = res;
    renderResults(res);
  });

  $("btnSaveRun").addEventListener("click", () => {
    const res = window.__lastResult;
    if (!res) {
      alert("Run a calculation first.");
      return;
    }
    const target = res.allocations?.[0]?.name || "";
    const targetPay = res.allocations?.[0]?.pay || 0;

    state.log = state.log || [];
    state.log.push({
      runDate: res.runDate,
      pay: res.pay,
      bills: res.billsDue.total,
      groceries: res.groceries,
      extra: res.extra,
      target,
      targetPay
    });
    saveState(state);
    renderLog(state);
    alert("Saved to log.");
  });

  $("btnClearLog").addEventListener("click", () => {
    if (confirm("Clear the log?")) {
      state.log = [];
      saveState(state);
      renderLog(state);
    }
  });

  $("btnExport").addEventListener("click", async () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mybudget-export.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  $("btnImport").addEventListener("click", async () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json";
    inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        const obj = JSON.parse(text);
        window.__state = obj;
        state = obj;
        saveState(state);
        render();
        alert("Imported.");
      } catch {
        alert("Import failed.");
      }
    };
    inp.click();
  });

  // Register service worker (if available)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }

  render();
}

init();
