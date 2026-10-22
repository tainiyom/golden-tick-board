(() => {
  /* ===== ตั้งค่า: วาง Web app URL จาก Apps Script ตรงนี้ ===== */
  const API_URL = "https://script.google.com/macros/s/AKfycbwL_0SBo_I36BvAIZJ1wcDLUiwGQFPDqWcC_YbSX7tMmq2xE-Qzf7s5K5TvNdm4nfnDyA/exec";
  // ตัดช่องว่างและอักขระที่มองไม่เห็นซึ่งอาจติดมาตอนคัดลอกวาง
  const BASE_URL = API_URL.replace(/[\s\u00A0\u200B-\u200D\u2060\uFEFF]/g, "");
  const POLL = 60000; // ดึงข้อมูลใหม่ทุก 1 นาที

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const safeUrl = u => /^https:\/\/[^\s"'<>]+$/i.test(u || "") ? u : null;
  const toNum = v => { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(/[,%\s]/g, "")); return isNaN(n) ? null : n; };
  const norm = s => String(s || "").replace(/\(.*?\)/g, "").replace(/\s+/g, "").toLowerCase();

  const state = {
    targets: { days: 15, orders: 300, inf: 15 },
    channels: [], summary: new Map(), summaryDate: "",
    owner: "ทั้งหมด", group: "ทั้งหมด", q: "", sort: "rank",
    loaded: false, detail: null, tab: "clips"
  };
  try { const s = JSON.parse(localStorage.getItem("gtb-prefs") || "{}"); Object.assign(state, { owner: s.owner || state.owner, group: s.group || state.group, sort: s.sort || state.sort }); } catch {}
  const savePrefs = () => { try { localStorage.setItem("gtb-prefs", JSON.stringify({ owner: state.owner, group: state.group, sort: state.sort })); } catch {} };

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
        clipToday: toNum(fv(17)), goalToday: toNum(fv(18)),
        clipWeek: toNum(fv(19)), goalWeek: toNum(fv(20)), short: toNum(fv(21))
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

  /* ---------- rendering ---------- */
  const lvClass = l => /lv2/i.test(l) ? "p-lv2" : "p-lv0";
  function metric(label, val, goal, fmt) {
    if (val == null) return `<div class="m"><span class="lbl">${label}</span><div class="track"></div><span class="val" style="color:var(--muted)">รอข้อมูล</span></div>`;
    const pct = Math.max(0, Math.min(100, val / goal * 100));
    return `<div class="m"><span class="lbl">${label}</span><div class="track"><div class="fill ${val >= goal ? "full" : ""}" style="width:${pct}%"></div></div><span class="val">${fmt(val)} / ${fmt(goal)}</span></div>`;
  }
  function clipSquares(done, goal) {
    const g = Math.min(goal || 0, 25), d = Math.min(done || 0, g);
    let s = ""; for (let i = 0; i < g; i++) s += `<span class="sq ${i < d ? "on" : ""}"></span>`;
    return s;
  }
  function visible() {
    const list = state.channels.filter(c =>
      (state.owner === "ทั้งหมด" || c.owner === state.owner) &&
      (state.group === "ทั้งหมด" || c.group === state.group) &&
      (!state.q || (c.name + " " + c.cat).toLowerCase().includes(state.q.toLowerCase())));
    const rk = c => summaryFor(c)?.rank ?? 999;
    const by = { rank: (a, b) => rk(a) - rk(b) || a.no - b.no, no: (a, b) => a.no - b.no,
      orders: (a, b) => (b.orders ?? -1) - (a.orders ?? -1), clips: (a, b) => (b.short ?? 0) - (a.short ?? 0) };
    return list.sort(by[state.sort] || by.rank);
  }
  function renderChrome() {
    const t = state.targets;
    $("#targets").innerHTML = `<span>เป้า LV2 (28 วันย้อนหลัง)</span>
      <span class="tpill">วันใช้งาน <b>${t.days}</b></span>
      <span class="tpill">ออเดอร์ <b>${t.orders}</b></span>
      <span class="tpill">Influence Score <b>${t.inf}%</b></span>
      ${state.summaryDate ? `<span class="tpill">สรุปล่าสุด <b>${esc(state.summaryDate)}</b></span>` : ""}`;
    const owners = ["ทั้งหมด", ...new Set(state.channels.map(c => c.owner).filter(Boolean))];
    const groups = ["ทั้งหมด", ...new Set(state.channels.map(c => c.group).filter(Boolean))];
    $("#ownerChips").innerHTML = owners.map(o => `<button class="chip" type="button" data-owner="${esc(o)}" aria-pressed="${o === state.owner}">${o === "ทั้งหมด" ? "ผู้ดูแลทั้งหมด" : esc(o)}</button>`).join("");
    $("#groupChips").innerHTML = groups.map(g => `<button class="chip" type="button" data-group="${esc(g)}" aria-pressed="${g === state.group}">${g === "ทั้งหมด" ? "ทุกกลุ่ม" : esc(g)}</button>`).join("");
    $("#sort").value = state.sort;
  }
  function renderTiles(list) {
    const lv2 = list.filter(c => /lv2/i.test(c.level)).length;
    const pass = list.filter(c => c.pass === "ผ่าน").length;
    const wk = list.reduce((s, c) => s + (c.clipWeek || 0), 0), wkGoal = list.reduce((s, c) => s + (c.goalWeek || 0), 0);
    const td = list.reduce((s, c) => s + (c.clipToday || 0), 0), tdGoal = list.reduce((s, c) => s + (c.goalToday || 0), 0);
    const orders = list.reduce((s, c) => s + (c.orders || 0), 0);
    $("#tiles").innerHTML = `
      <div class="tile"><span class="k">ช่องที่แสดง</span><span class="v">${list.length}</span><span class="s">LV2 อยู่ ${lv2} ช่อง · ผ่านเกณฑ์ตัวเลข ${pass}</span></div>
      <div class="tile"><span class="k">คลิปวันนี้</span><span class="v">${td}<span style="font-size:15px;color:var(--muted)"> / ${tdGoal}</span></span><span class="s">ขาดอีก ${Math.max(0, tdGoal - td)} คลิป</span></div>
      <div class="tile"><span class="k">คลิปสัปดาห์นี้ (จ.–ศ.)</span><span class="v">${wk}<span style="font-size:15px;color:var(--muted)"> / ${wkGoal}</span></span><span class="s">${wkGoal ? Math.round(wk / wkGoal * 100) : 0}% ของเป้า</span></div>
      <div class="tile"><span class="k">ออเดอร์ 28 วัน รวม</span><span class="v">${orders.toLocaleString("th-TH")}</span><span class="s">จากช่องที่มีตัวเลข</span></div>`;
  }
  function renderGrid() {
    const grid = $("#grid");
    if (!state.loaded) { grid.innerHTML = Array.from({ length: 6 }, () => `<div class="skel"></div>`).join(""); $("#tiles").innerHTML = ""; return; }
    const list = visible(); renderTiles(list);
    if (!list.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1">ไม่มีช่องตรงกับตัวกรองนี้</div>`; return; }
    const t = state.targets;
    grid.innerHTML = list.map(c => {
      const s = summaryFor(c);
      return `<button class="card ${/lv2/i.test(c.level) ? "lv2" : ""}" type="button" data-no="${c.no}">
        <div class="chead">
          <div style="min-width:0"><div class="cname">${esc(c.name)}</div><div class="cmeta">${esc(c.owner)} · ${esc(c.cat)}</div></div>
          <div class="pills">
            ${s?.rank ? `<span class="rank">เร่ง #${s.rank}</span>` : ""}
            <span class="pill ${lvClass(c.level)}">${esc(c.level || "—")}</span>
            ${c.status ? `<span class="pill p-bad">${esc(c.status)}</span>` : ""}
          </div>
        </div>
        <div class="metrics">
          ${metric("วันใช้งาน", c.days, t.days, v => v)}
          ${metric("ออเดอร์", c.orders, t.orders, v => v.toLocaleString("th-TH"))}
          ${metric("Influence", c.inf, t.inf, v => (+v).toFixed(v % 1 ? 1 : 0) + "%")}
        </div>
        ${s?.problem ? `<div class="problem">${esc(s.problem)}</div>` : ""}
        <div class="cfoot">
          <div style="display:flex;flex-direction:column;gap:4px">
            <span class="small">คลิปสัปดาห์นี้ <span class="num">${c.clipWeek ?? 0}/${c.goalWeek ?? 0}</span> · วันนี้ <span class="num">${c.clipToday ?? 0}/${c.goalToday ?? 0}</span></span>
            <span class="clips" aria-hidden="true">${clipSquares(c.clipWeek, c.goalWeek)}</span>
          </div>
          <span class="open">ดูคลิป →</span>
        </div>
      </button>`;
    }).join("");
  }
  function setStamp(text, live) { $("#stamp").innerHTML = `<span class="dot ${live ? "live" : ""}"></span>${esc(text)}`; }

  /* ---------- data ---------- */
  async function loadOverview() {
    try {
      const d = await api();
      const ch = parseTracker(d.tracker || [], d.fileIds || []);
      state.summary = parseSummary(d.summary);
      if (ch.length) { state.channels = ch; state.loaded = true; }
      $("#status").innerHTML = "";
      const t = new Date(d.updatedAt || Date.now()).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
      setStamp(`อัปเดตล่าสุด ${t} · ดึงใหม่ทุก 1 นาที`, true);
      renderChrome(); renderGrid();
      if (state.detail) { const c = ch.find(x => x.no === state.detail.no); if (c) { state.detail = c; renderDrawerHead(); } }
    } catch (e) {
      if (state.loaded) { setStamp("ดึงข้อมูลล่าสุดไม่สำเร็จ แสดงข้อมูลเดิมอยู่", false); return; }
      $("#status").innerHTML = `<div class="notice err"><p>ดึงข้อมูลจากชีตไม่สำเร็จ (${esc(e.message)}) ตรวจว่า Web app ของ Apps Script ตั้งสิทธิ์เป็น Anyone และ URL ใน app.js ถูกต้อง</p></div>`;
      $("#grid").innerHTML = ""; setStamp("ไม่ได้เชื่อมต่อ", false);
    }
  }

  /* ---------- drawer ---------- */
  const detailData = { clips: null, queue: null, err: null };
  function renderDrawerHead() {
    const c = state.detail;
    $("#dTitle").textContent = c.name;
    $("#dMeta").textContent = `${c.owner} · ${c.cat} · ${c.level || "—"}${c.updated ? " · ตัวเลขอัปเดต " + c.updated : ""}`;
    const f = $("#dFile"); if (c.fileUrl) { f.href = c.fileUrl; f.hidden = false; } else f.hidden = true;
    document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
  }
  const linksIn = s => String(s || "").split(/\s+/).map(safeUrl).filter(Boolean);
  function linkLabel(u, i) { try { const h = new URL(u).hostname.replace(/^www\./, ""); return (/shp\.ee|shopee/.test(h) ? "คลิป Shopee" : h) + (i ? ` ${i + 1}` : ""); } catch { return "เปิดลิงก์"; } }
  const playIcon = `<div class="play" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></div>`;

  function renderDrawerBody() {
    const body = $("#dBody"), c = state.detail, s = summaryFor(c);
    if (state.tab === "plan") {
      body.innerHTML = s ? `
        <div class="box"><h3>ปัญหาหลัก</h3><p>${esc(s.problem || "—")}</p></div>
        <div class="box"><h3>สิ่งที่ต้องทำสัปดาห์นี้</h3>${(s.todo || "—").split("·").map(x => `<p>• ${esc(x.trim())}</p>`).join("")}</div>
        <div class="box"><h3>สถานะคลิป (ลงแล้ว / รอถ่าย / ของหมด)</h3><p class="num">${esc(s.pipeline || "—")}</p><p class="small">ค่าคอมวิดีโอสะสม ${esc(s.comm || "0")} บาท · ${esc(s.filled)}</p></div>
        ${c.note ? `<div class="box"><h3>หมายเหตุจากไฟล์ช่อง</h3><p>${esc(c.note)}</p></div>` : ""}
        <p class="small">จากแท็บ สรุปรายสัปดาห์ วันที่ ${esc(state.summaryDate)}</p>`
        : `<div class="empty">ยังไม่มีสรุปรายสัปดาห์ของช่องนี้</div>`;
      return;
    }
    if (detailData.err) { body.innerHTML = `<div class="notice err"><p>เปิดไฟล์ช่องนี้ไม่สำเร็จ (${esc(detailData.err)})</p></div>`; return; }
    if (state.tab === "clips") {
      if (!detailData.clips) { body.innerHTML = `<div class="skel" style="height:120px"></div>`; return; }
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
      body.innerHTML = `<p class="small">${rows.length} รายการ · ${rows.reduce((n, r) => n + linksIn(r[2]).length, 0)} คลิป · ใหม่สุดอยู่บน</p><div class="vlist">${html}</div>`;
      return;
    }
    if (!detailData.queue) { body.innerHTML = `<div class="skel" style="height:120px"></div>`; return; }
    const rows = detailData.queue.filter(r => r[1]);
    if (!rows.length) { body.innerHTML = `<div class="empty">ยังไม่มีสินค้าในแท็บ สินค้าใหม่เข้าช่อง</div>`; return; }
    const stPill = st => st === "ลงคลิปแล้ว" ? "p-ok" : /หมด|ไม่เอา/.test(st) ? "p-bad" : "p-warn";
    body.innerHTML = `<p class="small">${rows.length} สินค้า · แคปชันกดคัดลอกได้</p><div class="vlist">` + rows.map((r, idx) => {
      const prod = safeUrl(r[3]), clips = linksIn(r[10]);
      return `<div class="vitem">${playIcon}<div class="vbody">
        <div class="drow"><div class="vtitle">${esc(r[1])}</div><span class="pill ${stPill(r[9] || "")}">${esc(r[9] || "ไม่ระบุ")}</span></div>
        <div class="small">${esc(r[2] || "")}${r[4] ? ` · ราคา ${esc(r[4])} ฿` : ""}${r[5] ? ` · ค่าคอม ${esc(r[5])} ฿/ชิ้น` : ""}${r[8] ? ` · ตรวจ: ${esc(r[8])}` : ""}</div>
        ${r[7] ? `<div class="small">มุมรีวิว: ${esc(r[7])}</div>` : ""}
        <div class="links">${prod ? `<a class="lk" href="${esc(prod)}" target="_blank" rel="noopener">หน้าสินค้า ↗</a>` : ""}${clips.map((u, i) => `<a class="lk" href="${esc(u)}" target="_blank" rel="noopener">${esc(linkLabel(u, i))} ↗</a>`).join("")}</div>
        ${r[12] ? `<div class="cap-row"><div class="cap" id="cap${idx}">${esc(r[12])}</div><button class="btn copy" type="button" data-cap="cap${idx}">คัดลอก</button></div>` : ""}
      </div></div>`;
    }).join("") + `</div>`;
  }

  async function loadDetail() {
    const c = state.detail; if (!c) return;
    if (!c.fileId) { detailData.err = "ไม่พบลิงก์ไฟล์ช่องในคอลัมน์ ไฟล์ช่อง"; renderDrawerBody(); return; }
    try {
      const d = await api({ channel: c.fileId });
      if (state.detail?.no !== c.no) return;
      detailData.clips = d.clips || []; detailData.queue = d.queue || []; detailData.err = null;
    } catch (e) { if (!detailData.clips) detailData.err = e.message; }
    renderDrawerBody();
  }
  function openDetail(no) {
    const c = state.channels.find(x => x.no === no); if (!c) return;
    state.detail = c; state.tab = "clips";
    detailData.clips = detailData.queue = null; detailData.err = null;
    renderDrawerHead(); renderDrawerBody();
    $("#scrim").hidden = false; $("#drawer").hidden = false; $("#dClose").focus();
    loadDetail();
  }
  function closeDetail() { state.detail = null; $("#scrim").hidden = true; $("#drawer").hidden = true; }

  /* ---------- events ---------- */
  document.addEventListener("click", async e => {
    const card = e.target.closest(".card"); if (card) return openDetail(+card.dataset.no);
    const o = e.target.closest("[data-owner]"); if (o) { state.owner = o.dataset.owner; savePrefs(); renderChrome(); return renderGrid(); }
    const g = e.target.closest("[data-group]"); if (g) { state.group = g.dataset.group; savePrefs(); renderChrome(); return renderGrid(); }
    const t = e.target.closest(".tab"); if (t) { state.tab = t.dataset.tab; renderDrawerHead(); return renderDrawerBody(); }
    const cp = e.target.closest(".copy"); if (cp) {
      const el = document.getElementById(cp.dataset.cap);
      try { await navigator.clipboard.writeText(el.textContent); cp.textContent = "คัดลอกแล้ว"; }
      catch { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); cp.textContent = "เลือกข้อความแล้ว"; }
      setTimeout(() => cp.textContent = "คัดลอก", 1600);
    }
  });
  $("#refresh").addEventListener("click", () => { setStamp("กำลังดึงข้อมูล…", false); loadOverview(); if (state.detail) loadDetail(); });
  $("#q").addEventListener("input", e => { state.q = e.target.value.trim(); renderGrid(); });
  $("#sort").addEventListener("change", e => { state.sort = e.target.value; savePrefs(); renderGrid(); });
  $("#dClose").addEventListener("click", closeDetail);
  $("#scrim").addEventListener("click", closeDetail);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && state.detail) closeDetail(); });

  /* ---------- start ---------- */
  renderChrome(); renderGrid();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(BASE_URL)) {
    $("#status").innerHTML = `<div class="notice"><p>ยังไม่ได้ตั้งค่า API_URL ใน app.js ให้วาง Web app URL จาก Google Apps Script (ดูขั้นตอนใน README.md)</p></div>`;
    $("#grid").innerHTML = ""; setStamp("ยังไม่ได้ตั้งค่า", false);
    return;
  }
  loadOverview();
  setInterval(() => { if (document.hidden) return; loadOverview(); if (state.detail) loadDetail(); }, POLL);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadOverview(); });
})();
