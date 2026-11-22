/* MEP Global | Villas Link Platform — client page (GitHub Pages)
   The only setting to change: API_URL = the Apps Script web app address ending in /exec. */
const API_URL = "https://script.google.com/macros/s/AKfycbwnAKLT1VF9m-C1GsaZ7cvc2aYq_J67aE3SHLNh1WVoaKNITpZ0wzWjH4GjOhPfPatn/exec";

const screen = document.getElementById("screen");
const token = new URLSearchParams(location.search).get("t") || "";

let villas = null;          // loaded once per visit after access is active
let photoMode = "protected";
const photoCache = new Map(); // protected photos already loaded: "id|index" -> data URL
let current = { id: null, index: 0 };
let lastViewLogged = "";
let loadedDay = "";          // Muscat date when access was confirmed; a new day needs renewal
const muscatDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date());

/* ---------------- helpers ---------------- */
const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const label = (ar, en) => esc(ar) + (en ? '<small lang="en" dir="ltr">' + esc(en) + "</small>" : "");
const twoLine = (ar, en) => esc(ar) + (en ? '<span lang="en" dir="ltr">' + esc(en) + "</span>" : "");
const areaKey = v => v.areaEn || v.areaAr;
const money = v => Number(v).toLocaleString("en");
// Keeps line breaks; turns **text** into bold.
const richText = v => esc(v).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

function show(html) {
  screen.innerHTML = html;
  window.scrollTo(0, 0);
}

/* ---------------- talking to Apps Script ---------------- */
function apiUrl(params) {
  const q = new URLSearchParams({ ...params, t: token, _: Date.now() });
  return API_URL + "?" + q.toString();
}

// Last network problem, shown in small text on the error screen to help find the cause.
let lastProblem = "";

async function api(params) {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(apiUrl(params), { signal: ctrl.signal, redirect: "follow", credentials: "omit" });
    clearTimeout(timer);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch (e) {
    const first = "A:" + ((e && (e.name + " " + e.message)) || "?") + " " + Math.round((Date.now() - started) / 1000) + "s";
    try {
      return await jsonp(params); // second route for browsers that block the first one
    } catch (e2) {
      lastProblem = first + " | B:" + ((e2 && e2.message) || "?") + " " + Math.round((Date.now() - started) / 1000) + "s";
      throw e2;
    }
  }
}

let jsonpCount = 0;
function jsonp(params) {
  return new Promise((resolve, reject) => {
    const name = "mepCb" + (++jsonpCount) + "_" + Date.now();
    const s = document.createElement("script");
    const done = () => { delete window[name]; s.remove(); clearTimeout(timer); };
    const timer = setTimeout(() => { done(); reject(new Error("timeout")); }, 30000);
    window[name] = data => { done(); resolve(data); };
    s.onerror = () => { done(); reject(new Error("network")); };
    s.src = apiUrl({ ...params, callback: name });
    document.body.appendChild(s);
  });
}

/* ---------------- screens ---------------- */
function invalidScreen() {
  show('<div class="notice"><h2>' + twoLine("هذا الرابط غير متاح", "This link is not available") +
    "</h2><p>" + label("يرجى التواصل مع دار الشرق الأوسط للحصول على رابط جديد.",
      "Please contact Middle East Properties for a new link.") + "</p></div>");
}

function errorScreen() {
  const code = lastProblem || "state:error";
  show('<div class="notice"><h2>' + twoLine("تعذّر تحميل البيانات", "Could not load the data") +
    "</h2><p>" + label("تحقّق من الاتصال ثم حاول مرة أخرى.", "Check your connection and try again.") +
    '</p><button class="primary" type="button" data-retry>' + label("إعادة المحاولة", "Try again") + '</button><p class="diag" dir="ltr">' + esc(code) + "</p></div>");
}

function loadingScreen() {
  show('<p class="loading">جارٍ التحميل… <small lang="en" dir="ltr">Loading…</small></p>');
}

// First visit, or a new day: one button activates access and logs it.
function welcomeScreen(state) {
  const renew = state === "renew";
  show('<section class="intro"><div class="rule"></div><p class="brandline" lang="en">Middle East Properties Global</p>' +
    (renew
      ? '<h1><bdi lang="en">Welcome Back</bdi><span>مرحبًا بعودتك</span></h1>' +
        '<p lang="en" dir="ltr">Explore the latest available villas</p><p>اطّلع على أحدث الفلل المتاحة</p>' +
        '<button class="primary" type="button" data-activate>' + label("عرض آخر التحديثات", "View Latest Updates") + "</button>"
      : "<h1>" + twoLine("مرحبًا بك", "Welcome") + "</h1>" +
        "<p>" + label("تصفّح الفلل المتاحة للإيجار في مسقط.", "Explore villas available for rent in Muscat.") + "</p>" +
        '<button class="primary" type="button" data-activate>' + label("عرض الفلل المتاحة", "View available villas") + "</button>") +
    "</section>");
}

function areasScreen() {
  const groups = new Map();
  villas.forEach(v => {
    const k = areaKey(v);
    if (!groups.has(k)) groups.set(k, { ar: v.areaAr, en: v.areaEn, count: 0 });
    groups.get(k).count++;
  });
  if (!groups.size) {
    show('<div class="notice"><h2>' + twoLine("لا توجد فلل متاحة حاليًا", "No villas are available right now") +
      "</h2><p>" + label("سنضيف الفلل الجديدة هنا فور توفرها.", "New villas will appear here as soon as they are available.") + "</p></div>");
    return;
  }
  show("<h1>" + twoLine("اختر المنطقة", "Choose an area") + '</h1><div class="grid areas">' +
    Array.from(groups, ([k, a]) =>
      '<a class="area" href="#area/' + encodeURIComponent(k) + '"><h2>' + twoLine(a.ar, a.en) + "</h2><p>" +
      label(a.count === 1 ? "فيلا واحدة متاحة" : a.count === 2 ? "فيلتان متاحتان" : a.count + " فلل متاحة", a.count + (a.count === 1 ? " villa available" : " villas available")) +
      "</p></a>").join("") + "</div>");
}

function specs(v) {
  return '<div class="specs">' +
    (v.beds ? "<span>" + label(v.beds + " غرف نوم", v.beds + " bedrooms") + "</span>" : "") +
    (v.baths ? "<span>" + label(v.baths + " حمامات", v.baths + " bathrooms") + "</span>" : "") + "</div>";
}

function price(v) {
  return v.rent ? '<div class="price">' + esc(money(v.rent)) + ' ر.ع. <small lang="en">OMR / month · الإيجار الشهري</small></div>' : "";
}

function listScreen(key) {
  const list = villas.filter(v => areaKey(v) === key);
  if (!list.length) { location.hash = "areas"; return; }
  const a = list[0];
  show('<nav class="crumb"><a href="#areas">' + label("كل المناطق", "All areas") + "</a></nav>" +
    "<h1>" + twoLine(a.areaAr, a.areaEn) + '</h1><div class="grid cards">' +
    list.map(v =>
      '<article class="card"><div class="photo-box" data-photo="' + esc(v.id) + '|0" data-size="600"></div>' +
      '<div class="card-copy"><h2>' + twoLine(v.titleAr, v.titleEn) + "</h2>" + price(v) + specs(v) +
      '<a class="btn primary" href="#villa/' + encodeURIComponent(v.id) + '">' + label("التفاصيل والصور", "Details and photos") + "</a></div></article>"
    ).join("") + "</div>");
  fillPhotos();
}

function detailScreen(id) {
  const v = villas.find(x => x.id === id);
  if (!v) { location.hash = "areas"; return; }
  if (current.id !== id) current = { id, index: 0 };
  show('<nav class="crumb"><a href="#areas">' + label("كل المناطق", "All areas") + '</a><a href="#area/' +
    encodeURIComponent(areaKey(v)) + '">' + label(v.areaAr, v.areaEn) + "</a></nav>" +
    '<div class="detail-grid"><div class="gallery"><div class="photo-box" id="mainPhoto"></div>' +
    (v.photoCount > 1
      ? '<div class="gallery-actions"><button type="button" data-step="-1" aria-label="السابقة · Previous">→</button>' +
        '<span class="counter" id="counter"></span><button type="button" data-step="1" aria-label="التالية · Next">←</button></div>'
      : "") +
    '</div><div class="details-copy"><h1>' + twoLine(v.titleAr, v.titleEn) + "</h1>" + price(v) + specs(v) +
    (v.descAr ? '<p class="desc">' + richText(v.descAr) + "</p>" : "") +
    (v.descEn ? '<p class="desc desc-en" lang="en">' + richText(v.descEn) + "</p>" : "") +
    "</div></div>");
  showMainPhoto(v);
  if (lastViewLogged !== id) { // one PROPERTY_VIEW per opening, not per photo
    lastViewLogged = id;
    api({ action: "view", id }).then(r => { if (r && r.state && r.state !== "active") handleState(r.state); }).catch(() => {});
  }
}

/* ---------------- photos ---------------- */
function publicUrls(fileId, size) {
  return ["https://lh3.googleusercontent.com/d/" + fileId + "=w" + size,
          "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w" + size];
}

function placeholder(box, ar, en) {
  box.innerHTML = '<div class="ph">' + label(ar, en) + "</div>";
}

// One loader for both modes. Each photo is fetched once; the promise is reused,
// so a photo that was loaded in advance appears instantly.
const photoLoads = new Map();
function photoSrc(v, index, size) {
  const key = v.id + "|" + index + "|" + size;
  if (photoLoads.has(key)) return photoLoads.get(key);
  let job;
  if (photoMode === "public") {
    const urls = publicUrls(v.photos[index], size);
    job = new Promise(resolve => {
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      let n = 0;
      img.onload = () => resolve(img.src);
      img.onerror = () => { n++; if (n < urls.length) img.src = urls[n]; else resolve(null); };
      img.src = urls[0];
    });
  } else {
    job = api({ action: "photo", id: v.id, i: index }).then(r => {
      if (r.state !== "active") { handleState(r.state); return null; }
      return r.photo || null;
    }).catch(() => null);
  }
  job.then(src => { if (!src) photoLoads.delete(key); }); // allow a retry later
  photoLoads.set(key, job);
  return job;
}

function preload(v, indexes, size) {
  indexes.forEach(i => { if (i >= 0 && i < v.photoCount) photoSrc(v, i, size); });
}

async function putPhoto(box, v, index, size) {
  if (!v.photoCount) { placeholder(box, "لا توجد صور", "No photos"); return; }
  const want = v.id + "|" + index;
  box.dataset.want = want;
  const shown = box.querySelector("img");
  if (shown) shown.classList.add("dim");            // keep the old photo until the new one is ready
  else placeholder(box, "جارٍ تحميل الصورة…", "Loading photo…");
  const src = await photoSrc(v, index, size);
  if (!box.isConnected || box.dataset.want !== want) return;
  if (!src) { placeholder(box, "الصورة غير متاحة", "Photo unavailable"); return; }
  const img = new Image();
  img.alt = v.titleAr || v.titleEn || "";
  img.referrerPolicy = "no-referrer";
  img.src = src;
  box.innerHTML = "";
  box.appendChild(img);
}

function fillPhotos() {
  document.querySelectorAll("[data-photo]").forEach(box => {
    const [id, i] = box.dataset.photo.split("|");
    const v = villas.find(x => x.id === id);
    if (v) putPhoto(box, v, Number(i), Number(box.dataset.size) || 1000);
  });
}

function showMainPhoto(v) {
  const box = document.getElementById("mainPhoto");
  const counter = document.getElementById("counter");
  if (counter) counter.textContent = (current.index + 1) + " / " + v.photoCount;
  if (box) putPhoto(box, v, current.index, 1000);
  // Load the next two and the previous photo in advance so swiping is instant.
  const n = v.photoCount, i = current.index;
  if (n > 1) preload(v, [(i + 1) % n, (i + 2) % n, (i - 1 + n) % n], 1000);
}

/* ---------------- flow ---------------- */
function handleState(state) {
  villas = null;
  if (state === "first" || state === "renew") welcomeScreen(state);
  else if (state === "invalid") invalidScreen();
  else errorScreen();
}

// Uses the villas list from an answer; returns false when access is not active.
function applyData(r) {
  if (r.state !== "active") { handleState(r.state); return false; }
  villas = r.villas || [];
  loadedDay = muscatDay();
  photoMode = r.photoMode === "public" ? "public" : "protected";
  // Start loading every villa's cover now, so the lists open with photos ready.
  villas.slice(0, 30).forEach(v => preload(v, [0], 600));
  return true;
}

async function loadData() {
  return applyData(await api({ action: "data" }));
}

async function route() {
  if (!villas) return;
  if (loadedDay !== muscatDay()) { villas = null; start(); return; } // midnight passed
  const [name, ...rest] = location.hash.replace(/^#/, "").split("/");
  const arg = decodeURIComponent(rest.join("/"));
  if (name === "area" && arg) listScreen(arg);
  else if (name === "villa" && arg) detailScreen(arg);
  else areasScreen();
  screen.focus({ preventScroll: true });
}

async function start() {
  if (!token) { invalidScreen(); return; }
  loadingScreen();
  try {
    // One request: it checks access and returns the villas together.
    if (await loadData()) route();
  } catch (_) {
    errorScreen();
  }
}

screen.addEventListener("click", async e => {
  const act = e.target.closest("[data-activate]");
  if (act) {
    act.disabled = true;
    try {
      const r = await api({ action: "activate" });
      if (r.state !== "active") { handleState(r.state); return; }
      loadingScreen();
      // Newer backend returns the villas with the activation; otherwise ask for them.
      if (r.villas ? applyData(r) : await loadData()) route();
    } catch (_) { errorScreen(); }
    return;
  }
  if (e.target.closest("[data-retry]")) { start(); return; }
  const step = e.target.closest("[data-step]");
  if (step && villas) {
    const v = villas.find(x => x.id === current.id);
    if (!v || !v.photoCount) return;
    current.index = (current.index + Number(step.dataset.step) + v.photoCount) % v.photoCount;
    showMainPhoto(v);
  }
});

window.addEventListener("hashchange", () => {
  if (!location.hash.startsWith("#villa/")) lastViewLogged = "";
  route();
});

start();
