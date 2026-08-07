// =========================================================
// Hotel Management System — app.js
// Talks to Supabase for auth, data, and storage. No build step needed.
// =========================================================

if (window.__hmsAppBooted) {
  console.warn("app.js already initialized — skipping duplicate load.");
} else {
window.__hmsAppBooted = true;

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------
// Global state
// ---------------------------------------------------------
let currentUser = null;
let currentProfile = null;
let selectedRoom = null;
let selectedReservationForPayment = null;
let selectedRoomImageFile = null;

const PAGE_SIZE = 6;
const pageState = { staff: 1, payments: 1, rooms: 1, users: 1, activity: 1 };

// ---------------------------------------------------------
// Small helpers
// ---------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function peso(n){
  return "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 });
}
function daysBetween(a, b){
  const d1 = new Date(a), d2 = new Date(b);
  return Math.max(0, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
}
function todayStr(){
  return new Date().toISOString().slice(0,10);
}
function esc(str){
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function showToast(msg, type = ""){
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast " + type;
  t.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add("hidden"), 3200);
}
function setMsg(el, text, type){
  if (!el) return;
  el.textContent = text || "";
  el.className = "form-msg" + (type ? " " + type : "");
}
function setLoading(el){
  el.innerHTML = `<div class="empty-note"><span class="spinner"></span> Loading…</div>`;
}
function setButtonLoading(btn, loadingText){
  btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
  btn.disabled = true;
  btn.textContent = loadingText || "Working…";
}
function resetButtonLoading(btn){
  btn.disabled = false;
  if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
}
function debounce(fn, ms){
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Best-effort audit log — never blocks the calling action if it fails
async function logActivity(action, details){
  try{
    await supabase.from("activity_logs").insert({
      actor_id: currentUser ? currentUser.id : null,
      actor_name: currentProfile ? currentProfile.full_name : "Unknown",
      action,
      details: details || "",
    });
  } catch(e){ /* logging is best-effort */ }
}

// Simple pager renderer
function renderPager(container, page, totalCount, pageSize, onChange){
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  container.innerHTML = "";
  if (totalPages <= 1) return;
  const prev = document.createElement("button");
  prev.className = "btn btn-ghost btn-small";
  prev.textContent = "← Prev";
  prev.disabled = page <= 1;
  prev.addEventListener("click", () => onChange(page - 1));

  const label = document.createElement("span");
  label.className = "page-label";
  label.textContent = `Page ${page} of ${totalPages}`;

  const next = document.createElement("button");
  next.className = "btn btn-ghost btn-small";
  next.textContent = "Next →";
  next.disabled = page >= totalPages;
  next.addEventListener("click", () => onChange(page + 1));

  container.append(prev, label, next);
}

// =========================================================
// AUTH — tabs (sign in / register / forgot / reset)
// =========================================================
$$(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    $("#loginForm").classList.toggle("hidden", tab !== "login");
    $("#registerForm").classList.toggle("hidden", tab !== "register");
  });
});

$("#forgotPasswordLink").addEventListener("click", () => {
  $("#authTabsWrap").classList.add("hidden");
  $("#forgotWrap").classList.remove("hidden");
  setMsg($("#forgotMsg"), "");
});
$("#backToLoginLink").addEventListener("click", () => {
  $("#forgotWrap").classList.add("hidden");
  $("#authTabsWrap").classList.remove("hidden");
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;
  const btn = e.target.querySelector("button[type=submit]");
  setMsg($("#loginMsg"), "");
  setButtonLoading(btn, "Signing in…");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  resetButtonLoading(btn);
  if (error){
    setMsg($("#loginMsg"), error.message, "error");
    return;
  }
  await bootAfterAuth();
});

$("#registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const full_name = $("#regName").value.trim();
  const contact = $("#regContact").value.trim();
  const email = $("#regEmail").value.trim();
  const password = $("#regPassword").value;
  const password2 = $("#regPassword2").value;
  const btn = e.target.querySelector("button[type=submit]");

  if (password !== password2){
    setMsg($("#registerMsg"), "Passwords do not match.", "error");
    return;
  }
  if (password.length < 6){
    setMsg($("#registerMsg"), "Password must be at least 6 characters.", "error");
    return;
  }

  setMsg($("#registerMsg"), "");
  setButtonLoading(btn, "Creating your account…");
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name, contact, role: "guest" } }
  });
  resetButtonLoading(btn);

  if (error){
    setMsg($("#registerMsg"), error.message, "error");
    return;
  }
  if (data.session){
    setMsg($("#registerMsg"), "");
    await bootAfterAuth();
  } else {
    setMsg($("#registerMsg"), "Account created! Check your email (and spam folder) to confirm, then sign in.", "success");
    e.target.reset();
  }
});

$("#forgotForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#forgotEmail").value.trim();
  const btn = e.target.querySelector("button[type=submit]");
  setMsg($("#forgotMsg"), "");
  setButtonLoading(btn, "Sending…");
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href.split("#")[0].split("?")[0],
  });
  resetButtonLoading(btn);
  if (error){
    setMsg($("#forgotMsg"), error.message, "error");
    return;
  }
  setMsg($("#forgotMsg"), "If that email is registered, a reset link is on its way.", "success");
});

$("#resetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = $("#resetPassword").value;
  const btn = e.target.querySelector("button[type=submit]");
  setMsg($("#resetMsg"), "");
  setButtonLoading(btn, "Updating…");
  const { error } = await supabase.auth.updateUser({ password });
  resetButtonLoading(btn);
  if (error){
    setMsg($("#resetMsg"), error.message, "error");
    return;
  }
  setMsg($("#resetMsg"), "Password updated! Redirecting…", "success");
  setTimeout(async () => {
    $("#resetWrap").classList.add("hidden");
    $("#authTabsWrap").classList.remove("hidden");
    await bootAfterAuth();
  }, 1200);
});

$("#logoutBtn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  currentUser = null;
  currentProfile = null;
  $("#appShell").classList.add("hidden");
  $("#appView").classList.add("hidden");
  $("#authView").classList.remove("hidden");
  $("#resetWrap").classList.add("hidden");
  $("#forgotWrap").classList.add("hidden");
  $("#authTabsWrap").classList.remove("hidden");
});

async function bootAfterAuth(){
  const { data: { user } } = await supabase.auth.getUser();
  if (!user){ return; }
  currentUser = user;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile){
    showToast("Could not load your profile.", "error");
    return;
  }
  currentProfile = profile;

  $("#authView").classList.add("hidden");
  $("#appShell").classList.remove("hidden");
  $("#appView").classList.remove("hidden");
  $("#userName").textContent = profile.full_name;
  $("#roleBadge").textContent = profile.role.toUpperCase();

  // Start with the menu closed everywhere — a clean, uncluttered first view.
  // Tap the toggle button (top-left) to open it.
  const shell = $("#appShell");
  shell.classList.add("sidebar-collapsed");
  $("#sidebarToggle").setAttribute("aria-expanded", "false");

  buildNav();
  goToView(defaultViewForRole(profile.role));
}

// Handle Supabase's password-recovery redirect
supabase.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY"){
    $("#authTabsWrap").classList.add("hidden");
    $("#forgotWrap").classList.add("hidden");
    $("#resetWrap").classList.remove("hidden");
  }
});

// Restore session on page load
(async function initSession(){
  const { data: { session } } = await supabase.auth.getSession();
  if (session && !window.location.hash.includes("type=recovery")){
    await bootAfterAuth();
  }
})();

// =========================================================
// NAVIGATION (role-based)
// =========================================================
const NAV_BY_ROLE = {
  guest: [
    { id: "view-search", label: "Search rooms" },
    { id: "view-mybookings", label: "My reservations" },
    { id: "view-profile", label: "My profile" },
  ],
  staff: [
    { id: "view-dashboard", label: "Dashboard" },
    { id: "view-staff", label: "Front desk" },
    { id: "view-payments", label: "Payments" },
    { id: "view-admin-rooms", label: "Rooms & prices" },
    { id: "view-search", label: "Search rooms" },
  ],
  admin: [
    { id: "view-dashboard", label: "Dashboard" },
    { id: "view-staff", label: "Front desk" },
    { id: "view-payments", label: "Payments" },
    { id: "view-admin-rooms", label: "Rooms & prices" },
    { id: "view-admin-users", label: "Users" },
    { id: "view-activity", label: "Activity log" },
    { id: "view-search", label: "Search rooms" },
  ],
};
function defaultViewForRole(role){
  return NAV_BY_ROLE[role][0].id;
}
function buildNav(){
  const nav = $("#mainNav");
  nav.innerHTML = "";
  NAV_BY_ROLE[currentProfile.role].forEach(item => {
    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.textContent = item.label;
    btn.dataset.view = item.id;
    btn.addEventListener("click", () => {
      goToView(item.id);
      $("#appShell").classList.add("sidebar-collapsed"); // auto-close after picking a section
    });
    nav.appendChild(btn);
  });
}
$("#sidebarToggle").addEventListener("click", (e) => {
  e.stopPropagation();
  const shell = $("#appShell");
  shell.classList.toggle("sidebar-collapsed");

  const collapsed = shell.classList.contains("sidebar-collapsed");
  const expanded = !collapsed;

  $("#sidebarToggle").setAttribute("aria-expanded", String(expanded));
  $("#sidebarToggle").setAttribute(
    "aria-label",
    expanded ? "Close sidebar" : "Open sidebar"
  );
  $("#sidebarToggle").title = expanded ? "Close sidebar" : "Open sidebar";
});
// Click anywhere outside the floating menu to close it
document.addEventListener("click", (e) => {
  const shell = $("#appShell");
  if (!shell || shell.classList.contains("sidebar-collapsed")) return;
  const sidebar = $("#sidebar");
  if (sidebar.contains(e.target) || $("#sidebarToggle").contains(e.target)) return;
  shell.classList.add("sidebar-collapsed");
  $("#sidebarToggle").setAttribute("aria-expanded", "false");
});
function goToView(viewId){
  $$(".view").forEach(v => v.classList.add("hidden"));
  const target = $("#" + viewId);
  if (target) target.classList.remove("hidden");
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === viewId));

  if (viewId === "view-dashboard") loadDashboard();
  if (viewId === "view-search") loadRooms();
  if (viewId === "view-mybookings") loadMyBookings();
  if (viewId === "view-profile") loadProfile();
  if (viewId === "view-staff") { pageState.staff = 1; loadStaffReservations(); }
  if (viewId === "view-payments") { pageState.payments = 1; loadPayments(); }
  if (viewId === "view-admin-rooms") { pageState.rooms = 1; loadAdminRooms(); }
  if (viewId === "view-admin-users") { pageState.users = 1; loadUsers(); }
  if (viewId === "view-activity") { pageState.activity = 1; loadActivityLogs(); }
}

// =========================================================
// DASHBOARD (staff / admin) — stats cards + revenue bars
// =========================================================
async function loadDashboard(){
  const cardsEl = $("#statsCards");
  setLoading(cardsEl);

  const [{ count: totalRooms }, { count: availableRooms }, { count: activeReservations },
         { data: todayCheckins }, { data: paidPayments }] = await Promise.all([
    supabase.from("rooms").select("*", { count: "exact", head: true }),
    supabase.from("rooms").select("*", { count: "exact", head: true }).eq("availability", true),
    supabase.from("reservations").select("*", { count: "exact", head: true }).in("status", ["pending","confirmed","checked_in"]),
    supabase.from("reservations").select("id").eq("check_in", todayStr()).neq("status","cancelled"),
    supabase.from("payments").select("amount, paid_at").eq("payment_status", "paid"),
  ]);

  const totalRevenue = (paidPayments || []).reduce((sum, p) => sum + Number(p.amount), 0);

  const cards = [
    { label: "Total rooms", value: totalRooms ?? 0 },
    { label: "Available now", value: availableRooms ?? 0 },
    { label: "Active reservations", value: activeReservations ?? 0 },
    { label: "Check-ins today", value: (todayCheckins || []).length },
    { label: "Total revenue collected", value: peso(totalRevenue) },
  ];
  cardsEl.innerHTML = "";
  cards.forEach(c => {
    const card = document.createElement("div");
    card.className = "glass stat-card";
    card.innerHTML = `<span class="stat-value">${esc(c.value)}</span><span class="stat-label">${esc(c.label)}</span>`;
    cardsEl.appendChild(card);
  });

  // Revenue bars — last 30 days
  const days = [];
  for (let i = 29; i >= 0; i--){
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0,10));
  }
  const byDay = {};
  days.forEach(d => byDay[d] = 0);
  (paidPayments || []).forEach(p => {
    if (!p.paid_at) return;
    const day = p.paid_at.slice(0,10);
    if (byDay[day] !== undefined) byDay[day] += Number(p.amount);
  });
  const maxVal = Math.max(1, ...Object.values(byDay));
  const barsEl = $("#revenueBars");
  barsEl.innerHTML = "";
  days.forEach(d => {
    const bar = document.createElement("div");
    bar.className = "revenue-bar";
    const pct = Math.round((byDay[d] / maxVal) * 100);
    bar.style.setProperty("--h", pct + "%");
    bar.title = `${d}: ${peso(byDay[d])}`;
    barsEl.appendChild(bar);
  });
  $("#revenueSection").classList.remove("hidden");
}

// =========================================================
// GUEST — SEARCH & BOOK ROOMS
// =========================================================
$("#searchBtn").addEventListener("click", loadRooms);

function roomImageOrPlaceholder(room){
  if (room.image_url) return `<img src="${esc(room.image_url)}" alt="Room ${esc(room.room_number)}" class="room-img" loading="lazy" />`;
  return `<div class="room-img room-img-placeholder">${esc(room.room_type)}</div>`;
}

async function loadRooms(){
  const grid = $("#roomsGrid");
  setLoading(grid);

  const type = $("#filterType").value;
  const checkIn = $("#filterCheckIn").value;
  const checkOut = $("#filterCheckOut").value;

  let query = supabase.from("rooms").select("*").eq("availability", true).order("room_number");
  if (type) query = query.eq("room_type", type);

  const { data: rooms, error } = await query;
  if (error){
    grid.innerHTML = `<div class="empty-note">Could not load rooms. ${esc(error.message)}</div>`;
    return;
  }

  let bookedRoomIds = new Set();
  if (checkIn && checkOut){
    const { data: overlapping } = await supabase
      .from("reservations")
      .select("room_id, check_in, check_out, status")
      .neq("status", "cancelled")
      .lt("check_in", checkOut)
      .gt("check_out", checkIn);
    (overlapping || []).forEach(r => bookedRoomIds.add(r.room_id));
  }

  if (!rooms || rooms.length === 0){
    grid.innerHTML = `<div class="empty-note">No rooms match your search.</div>`;
    return;
  }

  grid.innerHTML = "";
  rooms.forEach(room => {
    const isFree = !bookedRoomIds.has(room.id);
    const card = document.createElement("div");
    card.className = "glass room-card";
    card.innerHTML = `
      ${roomImageOrPlaceholder(room)}
      <span class="room-type">${esc(room.room_type)}</span>
      <span class="room-number">Room ${esc(room.room_number)}</span>
      <p class="room-desc">${esc(room.description || "Comfortable, well-appointed room.")} · Sleeps ${esc(room.capacity)}</p>
      <div class="room-meta">
        <span class="room-price">${peso(room.price)} <span>/ night</span></span>
        <span class="badge ${isFree ? "badge-open" : "badge-full"}">${isFree ? "Available" : "Booked"}</span>
      </div>
      <button class="btn btn-primary full" ${isFree ? "" : "disabled"}>
        ${isFree ? "Reserve" : "Not available"}
      </button>
    `;
    if (isFree){
      card.querySelector("button").addEventListener("click", () => openBookingModal(room, checkIn, checkOut));
    }
    grid.appendChild(card);
  });
}

function openBookingModal(room, checkIn, checkOut){
  selectedRoom = room;
  $("#modalRoomTitle").textContent = `Room ${room.room_number} — ${room.room_type}`;
  $("#modalRoomDesc").textContent = room.description || "";
  $("#modalCheckIn").value = checkIn || todayStr();
  $("#modalCheckOut").value = checkOut || "";
  $("#modalCheckIn").min = todayStr();
  $("#modalCheckOut").min = todayStr();
  updateModalTotal();
  setMsg($("#modalMsg"), "");
  $("#bookingModal").classList.remove("hidden");
}
$("#closeModal").addEventListener("click", () => $("#bookingModal").classList.add("hidden"));
$("#modalCheckIn").addEventListener("change", updateModalTotal);
$("#modalCheckOut").addEventListener("change", updateModalTotal);

function updateModalTotal(){
  const ci = $("#modalCheckIn").value, co = $("#modalCheckOut").value;
  const nights = ci && co ? daysBetween(ci, co) : 0;
  const total = nights * (selectedRoom ? Number(selectedRoom.price) : 0);
  $("#modalTotal").textContent = `${peso(total)} (${nights} night${nights === 1 ? "" : "s"})`;
}

$("#confirmBookingBtn").addEventListener("click", async (e) => {
  const check_in = $("#modalCheckIn").value;
  const check_out = $("#modalCheckOut").value;
  if (!check_in || !check_out || check_out <= check_in){
    setMsg($("#modalMsg"), "Please choose a valid check-in and check-out date.", "error");
    return;
  }
  const nights = daysBetween(check_in, check_out);
  const total_price = nights * Number(selectedRoom.price);
  const btn = e.target;
  setMsg($("#modalMsg"), "");
  setButtonLoading(btn, "Reserving…");

  const { data: reservation, error } = await supabase
    .from("reservations")
    .insert({
      guest_id: currentUser.id,
      room_id: selectedRoom.id,
      check_in, check_out,
      status: "pending",
      total_price,
    })
    .select()
    .single();

  if (error){
    resetButtonLoading(btn);
    setMsg($("#modalMsg"), error.message, "error");
    return;
  }

  await supabase.from("payments").insert({
    reservation_id: reservation.id,
    amount: total_price,
    payment_status: "unpaid",
  });
  await logActivity("reservation.created", `Room ${selectedRoom.room_number}, ${check_in} → ${check_out}`);

  resetButtonLoading(btn);
  $("#bookingModal").classList.add("hidden");
  showToast("Room reserved! Complete payment under 'My reservations'.", "success");
  goToView("view-mybookings");
});

// =========================================================
// GUEST — MY RESERVATIONS (history, cancellation, receipt, QR)
// =========================================================
async function loadMyBookings(){
  const list = $("#myBookingsList");
  setLoading(list);

  const { data, error } = await supabase
    .from("reservations")
    .select("*, rooms(room_number, room_type, price), payments(id, payment_status, amount, method)")
    .eq("guest_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error || !data || data.length === 0){
    list.innerHTML = `<div class="empty-note">No reservations yet. Go search for a room!</div>`;
    return;
  }

  list.innerHTML = "";
  data.forEach(r => {
    const payment = (r.payments && r.payments[0]) || null;
    const item = document.createElement("div");
    item.className = "glass list-item";
    item.innerHTML = `
      <div class="li-info">
        <span class="li-title">Room ${esc(r.rooms.room_number)} — ${esc(r.rooms.room_type)}</span>
        <span class="li-sub">${esc(r.check_in)} → ${esc(r.check_out)} · ${peso(r.total_price)}</span>
        <span class="li-sub">
          <span class="status-pill status-${r.status}">${r.status.replace("_"," ")}</span>
          &nbsp;·&nbsp;
          <span class="${payment && payment.payment_status === "paid" ? "pay-paid" : "pay-unpaid"}">
            ${payment ? payment.payment_status : "unpaid"}
          </span>
        </span>
      </div>
      <div class="li-actions">
        ${payment && payment.payment_status === "unpaid" && r.status !== "cancelled"
          ? `<button class="btn btn-primary btn-small" data-pay="${payment.id}" data-res="${r.id}" data-amount="${payment.amount}">Pay now</button>`
          : ""}
        ${payment && payment.payment_status === "paid"
          ? `<button class="btn btn-ghost btn-small" data-receipt="${r.id}">Receipt &amp; QR</button>`
          : ""}
        ${r.status === "pending"
          ? `<button class="btn btn-danger btn-small" data-cancel="${r.id}">Cancel</button>`
          : ""}
      </div>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll("[data-pay]").forEach(btn => {
    btn.addEventListener("click", () => openPaymentModal(btn.dataset.pay, btn.dataset.res, btn.dataset.amount));
  });
  list.querySelectorAll("[data-cancel]").forEach(btn => {
    btn.addEventListener("click", () => cancelReservation(btn.dataset.cancel));
  });
  list.querySelectorAll("[data-receipt]").forEach(btn => {
    btn.addEventListener("click", () => openReceipt(data.find(r => r.id === btn.dataset.receipt)));
  });
}

async function cancelReservation(id){
  if (!confirm("Cancel this reservation?")) return;
  const { error } = await supabase.from("reservations").update({ status: "cancelled" }).eq("id", id);
  if (error){ showToast(error.message, "error"); return; }
  await logActivity("reservation.cancelled", `Reservation ${id}`);
  showToast("Reservation cancelled.", "success");
  loadMyBookings();
}

// ---------------------------------------------------------
// Printable receipt + QR code
// ---------------------------------------------------------
function openReceipt(reservation){
  if (!reservation) return;
  const r = reservation;
  const confirmationCode = r.id.slice(0, 8).toUpperCase();
  $("#receiptBody").innerHTML = `
    <div class="receipt-row"><span>Confirmation #</span><strong>${esc(confirmationCode)}</strong></div>
    <div class="receipt-row"><span>Guest</span><strong>${esc(currentProfile.full_name)}</strong></div>
    <div class="receipt-row"><span>Room</span><strong>${esc(r.rooms.room_number)} — ${esc(r.rooms.room_type)}</strong></div>
    <div class="receipt-row"><span>Check-in</span><strong>${esc(r.check_in)}</strong></div>
    <div class="receipt-row"><span>Check-out</span><strong>${esc(r.check_out)}</strong></div>
    <div class="receipt-row"><span>Total paid</span><strong>${peso(r.total_price)}</strong></div>
    <div class="receipt-row"><span>Status</span><strong>${r.status.replace("_"," ")}</strong></div>
  `;
  const qrBox = $("#receiptQR");
  qrBox.innerHTML = "";
  if (window.QRCode){
    new QRCode(qrBox, {
      text: `HMS-RESERVATION:${r.id}`,
      width: 160, height: 160,
      colorDark: "#0a1a1e", colorLight: "#f3ede2",
    });
  } else {
    qrBox.innerHTML = `<p class="muted">QR code unavailable offline — confirmation code above still works at the desk.</p>`;
  }
  $("#receiptModal").classList.remove("hidden");
}
$("#closeReceiptModal").addEventListener("click", () => $("#receiptModal").classList.add("hidden"));
$("#printReceiptBtn").addEventListener("click", () => window.print());

// =========================================================
// GUEST — PROFILE MANAGEMENT
// =========================================================
function loadProfile(){
  $("#profileName").value = currentProfile.full_name || "";
  $("#profileContact").value = currentProfile.contact || "";
  $("#profileEmail").value = currentUser.email || "";
  setMsg($("#profileMsg"), "");
  setMsg($("#passwordMsg"), "");
}

$("#profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  const full_name = $("#profileName").value.trim();
  const contact = $("#profileContact").value.trim();
  if (!full_name){
    setMsg($("#profileMsg"), "Full name is required.", "error");
    return;
  }
  setButtonLoading(btn, "Saving…");
  const { error } = await supabase.from("profiles").update({ full_name, contact }).eq("id", currentUser.id);
  resetButtonLoading(btn);
  if (error){
    setMsg($("#profileMsg"), error.message, "error");
    return;
  }
  currentProfile.full_name = full_name;
  currentProfile.contact = contact;
  $("#userName").textContent = full_name;
  setMsg($("#profileMsg"), "Profile updated.", "success");
  showToast("Profile updated.", "success");
});

$("#passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  const newPassword = $("#newPassword").value;
  if (newPassword.length < 6){
    setMsg($("#passwordMsg"), "Password must be at least 6 characters.", "error");
    return;
  }
  setButtonLoading(btn, "Updating…");
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  resetButtonLoading(btn);
  if (error){
    setMsg($("#passwordMsg"), error.message, "error");
    return;
  }
  $("#passwordForm").reset();
  setMsg($("#passwordMsg"), "Password updated.", "success");
  showToast("Password updated.", "success");
});

// =========================================================
// PAYMENT MODAL (guest pays for a reservation)
// =========================================================
function openPaymentModal(paymentId, reservationId, amount){
  selectedReservationForPayment = { paymentId, reservationId, amount };
  $("#paymentSummary").textContent = `Amount due: ${peso(amount)}`;
  setMsg($("#paymentMsg"), "");
  $("#paymentModal").classList.remove("hidden");
}
$("#closePaymentModal").addEventListener("click", () => $("#paymentModal").classList.add("hidden"));

$("#confirmPaymentBtn").addEventListener("click", async (e) => {
  const { paymentId, reservationId } = selectedReservationForPayment;
  const method = $("#paymentMethod").value;
  const btn = e.target;
  setMsg($("#paymentMsg"), "");
  setButtonLoading(btn, "Processing…");

  const { error: payErr } = await supabase
    .from("payments")
    .update({ payment_status: "paid", method, paid_at: new Date().toISOString() })
    .eq("id", paymentId);

  if (payErr){
    resetButtonLoading(btn);
    setMsg($("#paymentMsg"), payErr.message, "error");
    return;
  }

  await supabase.from("reservations").update({ status: "confirmed" }).eq("id", reservationId);
  await logActivity("payment.paid", `Reservation ${reservationId}, ${peso(selectedReservationForPayment.amount)}`);

  resetButtonLoading(btn);
  $("#paymentModal").classList.add("hidden");
  showToast("Payment received — booking confirmed!", "success");
  loadMyBookings();
});

// =========================================================
// STAFF — MANAGE RESERVATIONS (search, filter, pagination)
// =========================================================
$("#staffSearch").addEventListener("input", debounce(() => { pageState.staff = 1; loadStaffReservations(); }, 300));
$("#staffStatusFilter").addEventListener("change", () => { pageState.staff = 1; loadStaffReservations(); });

async function loadStaffReservations(){
  const list = $("#staffList");
  setLoading(list);

  const search = $("#staffSearch").value.trim();
  const status = $("#staffStatusFilter").value;

  let query = supabase
    .from("reservations")
    .select("*, rooms(room_number, room_type), profiles(full_name, contact), payments(payment_status)")
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data: all, error } = await query;
  if (error){
    list.innerHTML = `<div class="empty-note">Could not load reservations. ${esc(error.message)}</div>`;
    return;
  }

  let filtered = all || [];
  if (search){
    const s = search.toLowerCase();
    filtered = filtered.filter(r =>
      (r.profiles?.full_name || "").toLowerCase().includes(s) ||
      (r.rooms?.room_number || "").toLowerCase().includes(s)
    );
  }

  if (filtered.length === 0){
    list.innerHTML = `<div class="empty-note">No reservations match.</div>`;
    $("#staffPagination").innerHTML = "";
    return;
  }

  const page = pageState.staff;
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  list.innerHTML = "";
  pageItems.forEach(r => {
    const payment = (r.payments && r.payments[0]) || null;
    const item = document.createElement("div");
    item.className = "glass list-item";
    item.innerHTML = `
      <div class="li-info">
        <span class="li-title">${esc(r.profiles.full_name)} — Room ${esc(r.rooms.room_number)}</span>
        <span class="li-sub">${esc(r.rooms.room_type)} · ${esc(r.check_in)} → ${esc(r.check_out)} · ${esc(r.profiles.contact || "no contact")}</span>
        <span class="li-sub">
          <span class="status-pill status-${r.status}">${r.status.replace("_"," ")}</span>
          &nbsp;·&nbsp;
          <span class="${payment && payment.payment_status === "paid" ? "pay-paid" : "pay-unpaid"}">${payment ? payment.payment_status : "unpaid"}</span>
        </span>
      </div>
      <div class="li-actions">
        ${r.status === "pending" ? `<button class="btn btn-success btn-small" data-action="confirmed" data-id="${r.id}">Confirm</button>` : ""}
        ${r.status === "confirmed" ? `<button class="btn btn-success btn-small" data-action="checked_in" data-id="${r.id}">Check in</button>` : ""}
        ${r.status === "checked_in" ? `<button class="btn btn-ghost btn-small" data-action="checked_out" data-id="${r.id}">Check out</button>` : ""}
        ${["pending","confirmed"].includes(r.status) ? `<button class="btn btn-danger btn-small" data-action="cancelled" data-id="${r.id}">Cancel</button>` : ""}
      </div>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", async () => {
      setButtonLoading(btn, "…");
      const { error } = await supabase
        .from("reservations")
        .update({ status: btn.dataset.action })
        .eq("id", btn.dataset.id);
      if (error){ showToast(error.message, "error"); resetButtonLoading(btn); return; }
      await logActivity(`reservation.${btn.dataset.action}`, `Reservation ${btn.dataset.id}`);
      showToast("Reservation updated.", "success");
      loadStaffReservations();
    });
  });

  renderPager($("#staffPagination"), page, filtered.length, PAGE_SIZE, (p) => { pageState.staff = p; loadStaffReservations(); });
}

// =========================================================
// STAFF/ADMIN — PAYMENT RECORDS (search, filter, pagination)
// =========================================================
$("#paymentsSearch").addEventListener("input", debounce(() => { pageState.payments = 1; loadPayments(); }, 300));
$("#paymentsStatusFilter").addEventListener("change", () => { pageState.payments = 1; loadPayments(); });

async function loadPayments(){
  const list = $("#paymentsList");
  setLoading(list);

  const search = $("#paymentsSearch").value.trim();
  const status = $("#paymentsStatusFilter").value;

  let query = supabase
    .from("payments")
    .select("*, reservations(check_in, check_out, rooms(room_number), profiles(full_name))")
    .order("paid_at", { ascending: false, nullsFirst: false });
  if (status) query = query.eq("payment_status", status);

  const { data: all, error } = await query;
  if (error){
    list.innerHTML = `<div class="empty-note">Could not load payments. ${esc(error.message)}</div>`;
    return;
  }

  let filtered = all || [];
  if (search){
    const s = search.toLowerCase();
    filtered = filtered.filter(p =>
      (p.reservations?.profiles?.full_name || "").toLowerCase().includes(s) ||
      (p.reservations?.rooms?.room_number || "").toLowerCase().includes(s)
    );
  }

  if (filtered.length === 0){
    list.innerHTML = `<div class="empty-note">No payments match.</div>`;
    $("#paymentsPagination").innerHTML = "";
    return;
  }

  const page = pageState.payments;
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  list.innerHTML = "";
  pageItems.forEach(p => {
    const res = p.reservations;
    const item = document.createElement("div");
    item.className = "glass list-item";
    item.innerHTML = `
      <div class="li-info">
        <span class="li-title">${esc(res?.profiles?.full_name || "Unknown guest")} — Room ${esc(res?.rooms?.room_number || "?")}</span>
        <span class="li-sub">${res ? `${esc(res.check_in)} → ${esc(res.check_out)}` : ""} · ${peso(p.amount)} · ${esc(p.method)}</span>
      </div>
      <span class="status-pill ${p.payment_status === "paid" ? "status-checked_in" : p.payment_status === "refunded" ? "status-cancelled" : "status-pending"}">
        ${esc(p.payment_status)}
      </span>
    `;
    list.appendChild(item);
  });

  renderPager($("#paymentsPagination"), page, filtered.length, PAGE_SIZE, (p) => { pageState.payments = p; loadPayments(); });
}

// =========================================================
// STAFF/ADMIN — MANAGE ROOMS (image upload, search, pagination)
// =========================================================
$("#roomImageFile").addEventListener("change", (e) => {
  selectedRoomImageFile = e.target.files[0] || null;
});
$("#roomsSearch").addEventListener("input", debounce(() => { pageState.rooms = 1; loadAdminRooms(); }, 300));

async function uploadRoomImage(file, roomNumber){
  const ext = file.name.split(".").pop();
  const path = `rooms/${roomNumber}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("room-images").upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("room-images").getPublicUrl(path);
  return data.publicUrl;
}

$("#roomForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  const room_number = $("#roomNumber").value.trim();
  const price = Number($("#roomPrice").value);
  const capacity = Number($("#roomCapacity").value);

  if (!room_number){ setMsg($("#roomFormMsg"), "Room number is required.", "error"); return; }
  if (price <= 0){ setMsg($("#roomFormMsg"), "Price must be greater than 0.", "error"); return; }
  if (capacity <= 0){ setMsg($("#roomFormMsg"), "Capacity must be at least 1.", "error"); return; }

  const payload = {
    room_number,
    room_type: $("#roomType").value,
    price,
    capacity,
    description: $("#roomDescription").value.trim(),
    availability: $("#roomAvailability").checked,
  };
  const id = $("#roomId").value;

  setMsg($("#roomFormMsg"), "");
  setButtonLoading(btn, "Saving…");

  try{
    if (selectedRoomImageFile){
      payload.image_url = await uploadRoomImage(selectedRoomImageFile, room_number);
    }
    let error;
    if (id){
      ({ error } = await supabase.from("rooms").update(payload).eq("id", id));
    } else {
      ({ error } = await supabase.from("rooms").insert(payload));
    }
    if (error) throw error;

    await logActivity(id ? "room.updated" : "room.created", `Room ${room_number}`);
    showToast(id ? "Room updated." : "Room added.", "success");
    resetRoomForm();
    loadAdminRooms();
  } catch(err){
    setMsg($("#roomFormMsg"), err.message, "error");
  } finally {
    resetButtonLoading(btn);
  }
});
$("#roomFormReset").addEventListener("click", resetRoomForm);
function resetRoomForm(){
  $("#roomForm").reset();
  $("#roomId").value = "";
  $("#roomAvailability").checked = true;
  selectedRoomImageFile = null;
  setMsg($("#roomFormMsg"), "");
}

async function loadAdminRooms(){
  const list = $("#adminRoomsList");
  setLoading(list);

  const search = $("#roomsSearch").value.trim().toLowerCase();
  const { data: all, error } = await supabase.from("rooms").select("*").order("room_number");
  if (error){
    list.innerHTML = `<div class="empty-note">Could not load rooms. ${esc(error.message)}</div>`;
    return;
  }

  let filtered = all || [];
  if (search){
    filtered = filtered.filter(r => r.room_number.toLowerCase().includes(search) || r.room_type.toLowerCase().includes(search));
  }
  if (filtered.length === 0){
    list.innerHTML = `<div class="empty-note">No rooms match — add one above.</div>`;
    $("#roomsPagination").innerHTML = "";
    return;
  }

  const page = pageState.rooms;
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  list.innerHTML = "";
  pageItems.forEach(room => {
    const item = document.createElement("div");
    item.className = "glass list-item";
    item.innerHTML = `
      <div class="li-info li-with-thumb">
        ${room.image_url ? `<img src="${esc(room.image_url)}" class="li-thumb" alt="" />` : `<div class="li-thumb li-thumb-empty"></div>`}
        <div>
          <span class="li-title">Room ${esc(room.room_number)} — ${esc(room.room_type)}</span>
          <span class="li-sub">${peso(room.price)} / night · sleeps ${esc(room.capacity)} · ${room.availability ? "listed" : "hidden"}</span>
        </div>
      </div>
      <div class="li-actions">
        <button class="btn btn-ghost btn-small" data-edit="${room.id}">Edit</button>
        <button class="btn btn-danger btn-small" data-del="${room.id}">Delete</button>
      </div>
    `;
    item.querySelector("[data-edit]").addEventListener("click", () => {
      $("#roomId").value = room.id;
      $("#roomNumber").value = room.room_number;
      $("#roomType").value = room.room_type;
      $("#roomPrice").value = room.price;
      $("#roomCapacity").value = room.capacity;
      $("#roomDescription").value = room.description || "";
      $("#roomAvailability").checked = room.availability;
      selectedRoomImageFile = null;
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    item.querySelector("[data-del]").addEventListener("click", async () => {
      if (!confirm(`Delete room ${room.room_number}?`)) return;
      const { error } = await supabase.from("rooms").delete().eq("id", room.id);
      if (error){ showToast(error.message, "error"); return; }
      await logActivity("room.deleted", `Room ${room.room_number}`);
      showToast("Room deleted.", "success");
      loadAdminRooms();
    });
    list.appendChild(item);
  });

  renderPager($("#roomsPagination"), page, filtered.length, PAGE_SIZE, (p) => { pageState.rooms = p; loadAdminRooms(); });
}

// =========================================================
// ADMIN — MANAGE USERS (search, role filter, pagination, promote)
// =========================================================
$("#usersSearch").addEventListener("input", debounce(() => { pageState.users = 1; loadUsers(); }, 300));
$("#usersRoleFilter").addEventListener("change", () => { pageState.users = 1; loadUsers(); });

async function loadUsers(){
  const list = $("#usersList");
  setLoading(list);

  const search = $("#usersSearch").value.trim().toLowerCase();
  const roleFilter = $("#usersRoleFilter").value;

  let query = supabase.from("profiles").select("*").order("created_at", { ascending: false });
  if (roleFilter) query = query.eq("role", roleFilter);

  const { data: all, error } = await query;
  if (error){
    list.innerHTML = `<div class="empty-note">Could not load users. ${esc(error.message)}</div>`;
    return;
  }

  let filtered = all || [];
  if (search){
    filtered = filtered.filter(u => u.full_name.toLowerCase().includes(search) || (u.contact || "").toLowerCase().includes(search));
  }
  if (filtered.length === 0){
    list.innerHTML = `<div class="empty-note">No users match.</div>`;
    $("#usersPagination").innerHTML = "";
    return;
  }

  const page = pageState.users;
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  list.innerHTML = "";
  pageItems.forEach(u => {
    const item = document.createElement("div");
    item.className = "glass list-item";
    item.innerHTML = `
      <div class="li-info">
        <span class="li-title">${esc(u.full_name)}</span>
        <span class="li-sub">${esc(u.contact || "no contact")} · joined ${new Date(u.created_at).toLocaleDateString()}</span>
      </div>
      <div class="li-actions">
        <select data-role="${u.id}">
          <option value="guest" ${u.role === "guest" ? "selected" : ""}>Guest</option>
          <option value="staff" ${u.role === "staff" ? "selected" : ""}>Staff</option>
          <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
        </select>
      </div>
    `;
    item.querySelector("select").addEventListener("change", async (e) => {
      const newRole = e.target.value;
      const { error } = await supabase.from("profiles").update({ role: newRole }).eq("id", u.id);
      if (error){ showToast(error.message, "error"); return; }
      await logActivity("user.role_changed", `${u.full_name} → ${newRole}`);
      showToast(`${u.full_name} is now ${newRole}.`, "success");
    });
    list.appendChild(item);
  });

  renderPager($("#usersPagination"), page, filtered.length, PAGE_SIZE, (p) => { pageState.users = p; loadUsers(); });
}

// =========================================================
// ADMIN — ACTIVITY LOGS (audit trail, pagination)
// =========================================================
async function loadActivityLogs(){
  const list = $("#activityList");
  setLoading(list);

  const page = pageState.activity;
  const start = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await supabase
    .from("activity_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(start, start + PAGE_SIZE - 1);

  if (error){
    list.innerHTML = `<div class="empty-note">Could not load activity logs. ${esc(error.message)}</div>`;
    return;
  }
  if (!data || data.length === 0){
    list.innerHTML = `<div class="empty-note">No activity recorded yet.</div>`;
    $("#activityPagination").innerHTML = "";
    return;
  }

  list.innerHTML = "";
  data.forEach(log => {
    const item = document.createElement("div");
    item.className = "glass list-item";
    item.innerHTML = `
      <div class="li-info">
        <span class="li-title">${esc(log.actor_name)} — ${esc(log.action.replace(/[._]/g, " "))}</span>
        <span class="li-sub">${esc(log.details || "")} · ${new Date(log.created_at).toLocaleString()}</span>
      </div>
    `;
    list.appendChild(item);
  });

  renderPager($("#activityPagination"), page, count || data.length, PAGE_SIZE, (p) => { pageState.activity = p; loadActivityLogs(); });
}

} // end of __hmsAppBooted guard
