(() => {
  /* ===== ตั้งค่า: วาง Web app URL จาก Apps Script ตรงนี้ ===== */
  const API_URL = "https://script.google.com/macros/s/AKfycbwL_0SBo_I36BvAIZJ1wcDLUiwGQFPDqWcC_YbSX7tMmq2xE-Qzf7s5K5TvNdm4nfnDyA/exec";
  // ตัดช่องว่างและอักขระที่มองไม่เห็นซึ่งอาจติดมาตอนคัดลอกวาง
  const BASE_URL = API_URL.replace(/[\s\u00A0\u200B-\u200D\u2060\uFEFF]/g, "");
  const POLL = 20000; // ดึงข้อมูลใหม่ทุก 20 วินาทีขณะเปิดหน้าอยู่

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const safeUrl = u => /^https:\/\/[^\s"'<>]+$/i.test(u || "") ? u : null;
  const toNum = v => { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(/[,%\s]/g, "")); return isNaN(n) ? null : n; };
  const norm = s => String(s || "").replace(/\(.*?\)/g, "").replace(/\s+/g, "").toLowerCase();

  const state = {
    targets: { days: 15, orders: 300, inf: 15 },
    channels: [], summary: new Map(), summaryDate: "",
    mode: "today", owner: "ทั้งหมด", status: "all",
    loaded: false, detail: null, tab: "clips"
  };
  try { const s = JSON.parse(localStorage.getItem("gtb-prefs2") || "{}"); if (s.mode) state.mode = s.mode; if (s.owner) state.owner = s.owner; } catch {}
  const savePrefs = () => { try { localStorage.setItem("gtb-prefs2", JSON.stringify({ mode: state.mode, owner: state.owner })); } catch {} };

  async function api(params) {
    const qs = new URLSearchParams(Object.assign({}, params, { t: Date.now() })).toString(); // t กันเบราว์เซอร์แคช
    const r = await fetch(BASE_URL + (BASE_URL.includes("?") ? "&" : "?") + qs);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  }

  /* ---------- parsing ---------- */
  function parseTracker(rows, ids) {
    const out = [];
    rows.forEach((r, i) => {
      const fv = k => String(r[k] ?? "").trim();
      const first = fv(0);
      if (first.startsWith("เป้า LV2")) {
        const d = toNum(fv(1)), o = toNum(fv(3)), n = toNum(fv(5));
        if (d) state.targets.days = d; if (o) state.targets.orders = o; if (n) state.targets.inf = n;
        return;
      }
      if (!/^\d+$/.test(first) || !fv(1)) return;
      const id = ids[i] || "";
      out.push({
        no: +first, name: fv(1), group: fv(2), owner: fv(3), cat: fv(4),
        level: fv(5), status: fv(6),
        days: toNum(fv(7)), orders: toNum(fv(8)), inf: toNum(fv(9)),
        pass: fv(12), updated: fv(13), note: fv(14),
        fileId: id, fileUrl: id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null,
        clipToday: toNum(fv(17)) ?? 0, goalToday: toNum(fv(18)) ?? 0,
        clipWeek: toNum(fv(19)) ?? 0, goalWeek: toNum(fv(20)) ?? 0
      });
    });
    return out;
  }
  function parseSummary(vals) {
    const map = new Map(); let date = "";
    for (const r of vals || []) {
      const d = String(r[0] || "").trim();
      if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(d)) continue;
      if (!date) date = d;
      if (d !== date) break; // ชุดใหม่สุดอยู่บนสุด
      map.set(norm(r[2]), { rank: toNum(r[1]), pipeline: r[8] || "", comm: r[9] || "", problem: r[10] || "", todo: r[11] || "", filled: r[12] || "" });
    }
    state.summaryDate = date; return map;
  }
  const summaryFor = c => {
    const k = norm(c.name);
    if (state.summary.has(k)) return state.summary.get(k);
    for (const [key, v] of state.summary) if (key && (k.startsWith(key) || key.startsWith(k))) return v;
    return null;
  };

  /* ---------- clip status ---------- */
  const clips = c => state.mode === "week" ? { done: c.clipWeek, goal: c.goalWeek } : { done: c.clipToday, goal: c.goalToday };
  const statusOf = c => { const { done, goal } = clips(c); return goal > 0 && done >= goal ? "done" : done > 0 ? "part" : "none"; };
  const GROUPS = [
    { key: "none", label: "ยังไม่ลงคลิป", color: "var(--bad)" },
    { key: "part", label: "ลงแล้ว ยังไม่ครบเป้า", color: "var(--warn)" },
    { key: "done", label: "ครบเป้าแล้ว", color: "var(--ok)" }
  ];
  function ring(done, goal) {
    const r = 19, C = 2 * Math.PI * r, p = goal ? Math.min(1, done / goal) : 0;
    const col = goal && done >= goal ? "var(--ok)" : done > 0 ? "var(--warn)" : "var(--bad)";
    return `<div class="ring"><svg viewBox="0 0 46 46" aria-hidden="true">
      <circle cx="23" cy="23" r="${r}" fill="none" stroke="var(--bar)" stroke-width="5"/>
      ${p > 0 ? `<circle cx="23" cy="23" r="${r}" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}"/>` : ""}
    </svg><span class="t ${goal && done >= goal ? "ok" : ""}">${goal && done >= goal ? "✓" : `${done}/${goal}`}</span></div>`;
  }

  /* ---------- rendering ---------- */
  function byOwner() { return state.channels.filter(c => state.owner === "ทั้งหมด" || c.owner === state.owner); }

  function renderHero(list) {
    const done = list.reduce((s, c) => s + Math.min(clips(c).done, clips(c).goal || Infinity), 0);
    const goal = list.reduce((s, c) => s + clips(c).goal, 0);
    const full = list.filter(c => statusOf(c) === "done").length;
    const who = state.owner === "ทั้งหมด" ? "ทุกช่อง" : `ของ${state.owner}`;
    $("#heroLabel").textContent = `${state.mode === "week" ? "คลิปสัปดาห์นี้ (จ.–ศ.)" : "คลิปวันนี้"} ${who}`;
    $("#heroDone").textContent = done;
    $("#heroGoal").textContent = `/ ${goal}`;
    $("#heroLeft").innerHTML = goal ? (done >= goal ? `<span style="color:var(--ok);font-weight:600">ครบเป้าแล้ว</span>` : `ขาดอีก <strong class="num" style="color:var(--fg);font-size:15px">${goal - done}</strong> คลิป<br>ครบเป้า ${full}/${list.length} ช่อง`) : "";
    $("#heroBar").style.width = goal ? Math.min(100, done / goal * 100) + "%" : "0%";
    document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === state.mode));
  }
  function renderStats(list) {
    const n = k => list.filter(c => statusOf(c) === k).length;
    $("#stats").innerHTML = GROUPS.map(g => `<button class="st" type="button" data-s="${g.key}" aria-pressed="${state.status === g.key}"><b>${n(g.key)}</b><span>${g.label.replace("ลงแล้ว ยังไม่ครบเป้า", "ยังไม่ครบ")}</span></button>`).join("");
  }
  function renderOwners() {
    const owners = [...new Set(state.channels.map(c => c.owner).filter(Boolean))];
    const sum = arr => { const d = arr.reduce((s, c) => s + Math.min(clips(c).done, clips(c).goal || Infinity), 0), g = arr.reduce((s, c) => s + clips(c).goal, 0); return `${d}/${g}`; };
    $("#owners").innerHTML = [`<button class="oc" type="button" data-owner="ทั้งหมด" aria-pressed="${state.owner === "ทั้งหมด"}">ทุกคน <span class="num">${sum(state.channels)}</span></button>`]
      .concat(owners.map(o => `<button class="oc" type="button" data-owner="${esc(o)}" aria-pressed="${state.owner === o}">${esc(o)} <span class="num">${sum(state.channels.filter(c => c.owner === o))}</span></button>`)).join("");
  }
  function rowHtml(c) {
    const { done, goal } = clips(c), other = state.mode === "week" ? `วันนี้ ${c.clipToday}/${c.goalToday}` : `สัปดาห์ ${c.clipWeek}/${c.goalWeek}`;
    const left = Math.max(0, goal - done);
    return `<button class="row" type="button" data-no="${c.no}">
      ${ring(done, goal)}
      <div style="min-width:0">
        <div class="rname">${esc(c.name)}</div>
        <div class="rmeta">${esc(c.owner)} · ${esc(c.cat)} · <span class="num">${other}</span></div>
      </div>
      <div class="rend">
        <span class="pill ${/lv2/i.test(c.level) ? "p-lv2" : "p-lv0"}">${esc(c.level || "—")}${c.status ? " · " + esc(c.status) : ""}</span>
        <span class="left ${left ? "" : "ok"}">${left ? `ขาด ${left}` : "ครบ"}</span>
      </div>
    </button>`;
  }
  function render() {
    if (!state.loaded) { $("#groups").innerHTML = `<div class="rows">${Array.from({ length: 8 }, () => `<div class="skel"></div>`).join("")}</div>`; return; }
    const list = byOwner();
    renderHero(list); renderStats(list); renderOwners();
    const shown = state.status === "all" ? list : list.filter(c => statusOf(c) === state.status);
    if (!shown.length) { $("#groups").innerHTML = `<div class="empty">ไม่มีช่องในกลุ่มนี้</div>`; }
    else {
      $("#groups").innerHTML = GROUPS.map(g => {
        const rows = shown.filter(c => statusOf(c) === g.key)
          .sort((a, b) => (clips(b).goal - clips(b).done) - (clips(a).goal - clips(a).done) || (summaryFor(a)?.rank ?? 99) - (summaryFor(b)?.rank ?? 99) || a.no - b.no);
        if (!rows.length) return "";
        return `<div><div class="gh" style="--c:${g.color}"><i></i>${g.label} · ${rows.length} ช่อง</div><div class="rows">${rows.map(rowHtml).join("")}</div></div>`;
      }).join("");
    }
    $("#foot").textContent = `เป้า LV2: วันใช้งาน ${state.targets.days} · ออเดอร์ ${state.targets.orders} · Influence ${state.targets.inf}%${state.summaryDate ? " · สรุปล่าสุด " + state.summaryDate : ""} · แตะช่องเพื่อดูคลิปและตัวเลข LV2`;
  }
  function setStamp(text, live) { $("#stamp").innerHTML = `<span class="dot ${live ? "live" : ""}"></span>${esc(text)}`; }

  /* ---------- data ---------- */
  let busy = false, lastOk = 0, lastTry = 0, sheetAt = 0;
  function tickStamp() {
    if (!lastOk) return;
    const sec = Math.max(0, Math.round((Date.now() - lastOk) / 1000));
    const ago = sec < 10 ? "เมื่อสักครู่" : sec < 60 ? `${sec} วินาทีที่แล้ว` : `${Math.floor(sec / 60)} นาทีที่แล้ว`;
    const t = new Date(sheetAt || lastOk).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setStamp(`ข้อมูล ${t} · เช็ก${ago}`, Date.now() - lastOk < POLL * 3);
  }
  async function loadOverview(force) {
    if (busy) return;
    if (!force && Date.now() - lastTry < 3000) return; // กันยิงซ้ำตอนสลับแอปไปมา
    busy = true; lastTry = Date.now(); $("#refresh").classList.add("spin");
    try {
      const d = await api(force ? { fresh: 1 } : {});
      const ch = parseTracker(d.tracker || [], d.fileIds || []);
      state.summary = parseSummary(d.summary);
      if (ch.length) { state.channels = ch; state.loaded = true; }
      $("#status").innerHTML = "";
      lastOk = Date.now(); sheetAt = d.updatedAt ? Date.parse(d.updatedAt) : lastOk; tickStamp();
      render();
      if (state.detail) { const c = ch.find(x => x.no === state.detail.no); if (c) { state.detail = c; renderDrawerHead(); } }
    } catch (e) {
      if (state.loaded) { setStamp("ดึงข้อมูลล่าสุดไม่สำเร็จ แสดงข้อมูลเดิมอยู่", false); return; }
      $("#status").innerHTML = `<div class="notice err"><p>ดึงข้อมูลจากชีตไม่สำเร็จ (${esc(e.message)}) ตรวจว่า Web app ของ Apps Script ตั้งสิทธิ์เป็น Anyone และ URL ใน app.js ถูกต้อง</p></div>`;
      $("#groups").innerHTML = ""; setStamp("ไม่ได้เชื่อมต่อ", false);
    } finally { busy = false; $("#refresh").classList.remove("spin"); }
  }

  /* ---------- detail sheet ---------- */
  const detailData = { clips: null, queue: null, err: null };
  function kpi(label, val, goal, fmt) {
    if (val == null) return `<div class="kpi"><span>${label}</span><b><small>รอข้อมูล</small></b></div>`;
    return `<div class="kpi ${val >= goal ? "ok" : ""}"><span>${label}</span><b>${fmt(val)}<small>/${fmt(goal)}</small></b></div>`;
  }
  function renderDrawerHead() {
    const c = state.detail, t = state.targets;
    $("#dTitle").textContent = c.name;
    $("#dMeta").textContent = `${c.owner} · ${c.cat} · ${c.level || "—"}${c.status ? " " + c.status : ""}${c.updated ? " · ตัวเลข " + c.updated : ""}`;
    $("#dKpis").innerHTML =
      `<div class="kpi ${c.goalWeek && c.clipWeek >= c.goalWeek ? "ok" : ""}"><span>คลิปสัปดาห์</span><b>${c.clipWeek}<small>/${c.goalWeek}</small></b></div>` +
      kpi("วันใช้งาน", c.days, t.days, v => v) +
      kpi("ออเดอร์", c.orders, t.orders, v => v.toLocaleString("th-TH")) +
      kpi("Influence", c.inf, t.inf, v => (+v).toFixed(v % 1 ? 1 : 0) + "%");
    document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
  }
  const linksIn = s => String(s || "").split(/\s+/).map(safeUrl).filter(Boolean);
  function linkLabel(u, i) { try { const h = new URL(u).hostname.replace(/^www\./, ""); return (/shp\.ee|shopee/.test(h) ? "คลิป Shopee" : h) + (i ? ` ${i + 1}` : ""); } catch { return "เปิดลิงก์"; } }
  const playIcon = `<div class="play" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></div>`;

  function renderDrawerBody() {
    const body = $("#dBody"), c = state.detail, s = summaryFor(c);
    if (state.tab === "plan") {
      body.innerHTML = (s ? `
        <div class="box"><h3>ปัญหาหลัก</h3><p>${esc(s.problem || "—")}</p></div>
        <div class="box"><h3>สิ่งที่ต้องทำสัปดาห์นี้</h3>${(s.todo || "—").split("·").map(x => `<p>• ${esc(x.trim())}</p>`).join("")}</div>
        <div class="box"><h3>คลิป ลงแล้ว / รอถ่าย / ของหมด</h3><p class="num">${esc(s.pipeline || "—")}</p><p class="small">ค่าคอมวิดีโอสะสม ${esc(s.comm || "0")} บาท · ${esc(s.filled)}</p></div>
        <p class="small">จากแท็บ สรุปรายสัปดาห์ วันที่ ${esc(state.summaryDate)}${s.rank ? ` · ลำดับเร่ง #${s.rank}` : ""}</p>`
        : `<div class="empty">ยังไม่มีสรุปรายสัปดาห์ของช่องนี้</div>`)
        + (c.note ? `<div class="box"><h3>หมายเหตุจากไฟล์ช่อง</h3><p>${esc(c.note)}</p></div>` : "");
      return;
    }
    if (detailData.err) { body.innerHTML = `<div class="notice err"><p>เปิดไฟล์ช่องนี้ไม่สำเร็จ (${esc(detailData.err)})</p></div>`; return; }
    if (state.tab === "clips") {
      if (!detailData.clips) { body.innerHTML = `<div class="skel"></div><div class="skel"></div>`; return; }
      const rows = detailData.clips.filter(r => r[0] || r[1] || r[2]);
      if (!rows.length) { body.innerHTML = `<div class="empty">ยังไม่มีคลิปที่บันทึกไว้<br><span class="small">คลิปจะขึ้นที่นี่เองเมื่อเปลี่ยนสถานะสินค้าเป็น "ลงคลิปแล้ว" และวางลิงก์คลิปในแท็บ สินค้าใหม่เข้าช่อง</span></div>`; return; }
      let last = "", html = "";
      rows.slice().reverse().forEach(r => {
        if (r[0] !== last) { last = r[0]; html += `<div class="vday">${esc(r[0] || "ไม่ระบุวัน")}</div>`; }
        const ls = linksIn(r[2]);
        html += `<div class="vitem">${playIcon}<div class="vbody"><div class="vtitle">${esc(r[1] || "ไม่ระบุสินค้า")}</div>
          <div class="links">${ls.map((u, i) => `<a class="lk" href="${esc(u)}" target="_blank" rel="noopener">${esc(linkLabel(u, i))} ↗</a>`).join("") || `<span class="small">ไม่มีลิงก์</span>`}</div>
          ${r[3] ? `<div class="small">${esc(r[3])}</div>` : ""}</div></div>`;
      });
      body.innerHTML = `<p class="small" style="margin:0">${rows.length} รายการ · ${rows.reduce((n, r) => n + linksIn(r[2]).length, 0)} คลิป · ใหม่สุดอยู่บน</p><div class="vlist">${html}</div>`;
      return;
    }
    if (!detailData.queue) { body.innerHTML = `<div class="skel"></div><div class="skel"></div>`; return; }
    const rows = detailData.queue.filter(r => r[1]);
    if (!rows.length) { body.innerHTML = `<div class="empty">ยังไม่มีสินค้าในแท็บ สินค้าใหม่เข้าช่อง</div>`; return; }
    const stPill = st => st === "ลงคลิปแล้ว" ? "p-ok" : /หมด|ไม่เอา/.test(st) ? "p-bad" : "p-warn";
    body.innerHTML = `<p class="small" style="margin:0">${rows.length} สินค้า · แคปชันกดคัดลอกได้</p><div class="vlist">` + rows.map((r, idx) => {
      const prod = safeUrl(r[3]), cl = linksIn(r[10]);
      return `<div class="vitem">${playIcon}<div class="vbody">
        <div class="drow"><div class="vtitle">${esc(r[1])}</div><span class="pill ${stPill(r[9] || "")}">${esc(r[9] || "ไม่ระบุ")}</span></div>
        <div class="small">${esc(r[2] || "")}${r[4] ? ` · ราคา ${esc(r[4])} ฿` : ""}${r[5] ? ` · ค่าคอม ${esc(r[5])} ฿/ชิ้น` : ""}${r[8] ? ` · ตรวจ: ${esc(r[8])}` : ""}</div>
        ${r[7] ? `<div class="small">มุมรีวิว: ${esc(r[7])}</div>` : ""}
        <div class="links">${prod ? `<a class="lk" href="${esc(prod)}" target="_blank" rel="noopener">หน้าสินค้า ↗</a>` : ""}${cl.map((u, i) => `<a class="lk" href="${esc(u)}" target="_blank" rel="noopener">${esc(linkLabel(u, i))} ↗</a>`).join("")}</div>
        ${r[12] ? `<div class="cap-row"><div class="cap" id="cap${idx}">${esc(r[12])}</div><button class="btn copy" type="button" data-cap="cap${idx}">คัดลอก</button></div>` : ""}
      </div></div>`;
    }).join("") + `</div>`;
  }

  let detailBusy = false;
  async function loadDetail(force) {
    const c = state.detail; if (!c || detailBusy) return;
    if (!c.fileId) { detailData.err = "ไม่พบลิงก์ไฟล์ช่องในคอลัมน์ ไฟล์ช่อง"; renderDrawerBody(); return; }
    detailBusy = true;
    try {
      const d = await api(force ? { channel: c.fileId, fresh: 1 } : { channel: c.fileId });
      if (state.detail?.no !== c.no) return;
      detailData.clips = d.clips || []; detailData.queue = d.queue || []; detailData.err = null;
    } catch (e) { if (!detailData.clips) detailData.err = e.message; }
    finally { detailBusy = false; }
    if (state.detail?.no === c.no) renderDrawerBody();
  }
  function openDetail(no) {
    const c = state.channels.find(x => x.no === no); if (!c) return;
    state.detail = c; state.tab = "clips";
    detailData.clips = detailData.queue = null; detailData.err = null;
    renderDrawerHead(); renderDrawerBody();
    $("#scrim").hidden = false; $("#drawer").hidden = false; document.body.style.overflow = "hidden";
    loadDetail();
  }
  function closeDetail() { state.detail = null; $("#scrim").hidden = true; $("#drawer").hidden = true; document.body.style.overflow = ""; }

  /* ---------- events ---------- */
  document.addEventListener("click", async e => {
    const row = e.target.closest(".row"); if (row) return openDetail(+row.dataset.no);
    const m = e.target.closest("[data-mode]"); if (m) { state.mode = m.dataset.mode; savePrefs(); return render(); }
    const st = e.target.closest(".st"); if (st) { state.status = state.status === st.dataset.s ? "all" : st.dataset.s; return render(); }
    const o = e.target.closest("[data-owner]"); if (o) { state.owner = o.dataset.owner; savePrefs(); return render(); }
    const t = e.target.closest(".tab"); if (t) { state.tab = t.dataset.tab; renderDrawerHead(); return renderDrawerBody(); }
    const cp = e.target.closest(".copy"); if (cp) {
      const el = document.getElementById(cp.dataset.cap);
      try { await navigator.clipboard.writeText(el.textContent); cp.textContent = "คัดลอกแล้ว"; }
      catch { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); cp.textContent = "เลือกข้อความแล้ว"; }
      setTimeout(() => cp.textContent = "คัดลอก", 1600);
    }
  });
  $("#refresh").addEventListener("click", () => { loadOverview(true); if (state.detail) loadDetail(true); });
  $("#dClose").addEventListener("click", closeDetail);
  $("#scrim").addEventListener("click", closeDetail);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && state.detail) closeDetail(); });

  /* ---------- start ---------- */
  render();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(BASE_URL)) {
    $("#status").innerHTML = `<div class="notice"><p>ยังไม่ได้ตั้งค่า API_URL ใน app.js ให้วาง Web app URL จาก Google Apps Script (ดูขั้นตอนใน README.md)</p></div>`;
    $("#groups").innerHTML = ""; setStamp("ยังไม่ได้ตั้งค่า", false);
    return;
  }
  const catchUp = () => { if (document.hidden) return; loadOverview(); if (state.detail) loadDetail(); };
  loadOverview(true);
  setInterval(catchUp, POLL);
  setInterval(tickStamp, 5000);
  // มือถือหยุดหน้าเว็บตอนสลับแอปหรือล็อกจอ กลับมาเมื่อไรให้ดึงข้อมูลใหม่ทันที
  document.addEventListener("visibilitychange", catchUp);
  window.addEventListener("pageshow", catchUp);
  window.addEventListener("focus", catchUp);
  window.addEventListener("online", catchUp);
})();
