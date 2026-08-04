// =========================================================
// Hotel Management System — app.js
// Talks to Supabase for auth + data. No build step needed.
// =========================================================

// Guard: if this file ever gets loaded/executed more than once on the
// same page (duplicate <script> tag, browser extension re-injecting it,
// a dev-server double-fire, etc.), the second run stops immediately
// instead of throwing "Identifier has already been declared".
if (window.__hmsAppBooted) {
  console.warn("app.js already initialized — skipping duplicate load.");
} else {
window.__hmsAppBooted = true;

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------
// Global state
// ---------------------------------------------------------
let currentUser = null;   // supabase auth user
let currentProfile = null; // row from public.profiles
let selectedRoom = null;   // room object chosen in booking modal
let selectedReservationForPayment = null;

// ---------------------------------------------------------
// Small helpers
// ---------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function peso(n){
  return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 });
}
function daysBetween(a, b){
  const d1 = new Date(a), d2 = new Date(b);
  return Math.max(0, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
}
function todayStr(){
  return new Date().toISOString().slice(0,10);
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
  el.textContent = text || "";
  el.className = "form-msg" + (type ? " " + type : "");
}

// =========================================================
// AUTH
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

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;
  setMsg($("#loginMsg"), "Signing in…");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error){
    setMsg($("#loginMsg"), error.message, "error");
    return;
  }
  setMsg($("#loginMsg"), "");
  await bootAfterAuth();
});

$("#registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const full_name = $("#regName").value.trim();
  const contact = $("#regContact").value.trim();
  const email = $("#regEmail").value.trim();
  const password = $("#regPassword").value;

  setMsg($("#registerMsg"), "Creating your account…");
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name, contact, role: "guest" } }
  });
  if (error){
    setMsg($("#registerMsg"), error.message, "error");
    return;
  }
  if (data.session){
    // Email confirmation disabled -> logged in immediately
    setMsg($("#registerMsg"), "");
    await bootAfterAuth();
  } else {
    setMsg($("#registerMsg"), "Account created! Check your email to confirm, then sign in.", "success");
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  currentUser = null;
  currentProfile = null;
  $("#topbar").classList.add("hidden");
  $("#appView").classList.add("hidden");
  $("#authView").classList.remove("hidden");
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
  $("#topbar").classList.remove("hidden");
  $("#appView").classList.remove("hidden");
  $("#userName").textContent = profile.full_name;
  $("#roleBadge").textContent = profile.role.toUpperCase();

  buildNav();
  goToView(defaultViewForRole(profile.role));
}

// Restore session on page load
(async function initSession(){
  const { data: { session } } = await supabase.auth.getSession();
  if (session){ await bootAfterAuth(); }
})();

// =========================================================
// NAVIGATION (role-based)
// =========================================================
const NAV_BY_ROLE = {
  guest: [
    { id: "view-search", label: "Search rooms" },
    { id: "view-mybookings", label: "My reservations" },
  ],
  staff: [
    { id: "view-staff", label: "Front desk" },
    { id: "view-search", label: "Search rooms" },
  ],
  admin: [
    { id: "view-admin-rooms", label: "Rooms & prices" },
    { id: "view-admin-users", label: "Users" },
    { id: "view-staff", label: "Front desk" },
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
    btn.addEventListener("click", () => goToView(item.id));
    nav.appendChild(btn);
  });
}
function goToView(viewId){
  $$(".view").forEach(v => v.classList.add("hidden"));
  $("#" + viewId).classList.remove("hidden");
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === viewId));

  if (viewId === "view-search") loadRooms();
  if (viewId === "view-mybookings") loadMyBookings();
  if (viewId === "view-staff") loadStaffReservations();
  if (viewId === "view-admin-rooms") loadAdminRooms();
  if (viewId === "view-admin-users") loadUsers();
}

// =========================================================
// GUEST — SEARCH & BOOK ROOMS
// =========================================================
$("#searchBtn").addEventListener("click", loadRooms);

async function loadRooms(){
  const grid = $("#roomsGrid");
  grid.innerHTML = `<div class="empty-note">Loading rooms…</div>`;

  const type = $("#filterType").value;
  const checkIn = $("#filterCheckIn").value;
  const checkOut = $("#filterCheckOut").value;

  let query = supabase.from("rooms").select("*").eq("availability", true).order("room_number");
  if (type) query = query.eq("room_type", type);

  const { data: rooms, error } = await query;
  if (error){
    grid.innerHTML = `<div class="empty-note">Could not load rooms.</div>`;
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
      <span class="room-type">${room.room_type}</span>
      <span class="room-number">Room ${room.room_number}</span>
      <p class="room-desc">${room.description || "Comfortable, well-appointed room."} · Sleeps ${room.capacity}</p>
      <div class="room-meta">
        <span class="room-price">${peso(room.price)} <span>/ night</span></span>
        <span class="badge ${isFree ? "badge-open" : "badge-full"}">${isFree ? "Available" : "Booked"}</span>
      </div>
      <button class="btn btn-primary full" ${isFree ? "" : "disabled"} data-room='${JSON.stringify(room).replace(/'/g, "&apos;")}'>
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

$("#confirmBookingBtn").addEventListener("click", async () => {
  const check_in = $("#modalCheckIn").value;
  const check_out = $("#modalCheckOut").value;
  if (!check_in || !check_out || check_out <= check_in){
    setMsg($("#modalMsg"), "Please choose a valid check-in and check-out date.", "error");
    return;
  }
  const nights = daysBetween(check_in, check_out);
  const total_price = nights * Number(selectedRoom.price);

  setMsg($("#modalMsg"), "Reserving…");
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
    setMsg($("#modalMsg"), error.message, "error");
    return;
  }

  await supabase.from("payments").insert({
    reservation_id: reservation.id,
    amount: total_price,
    payment_status: "unpaid",
  });

  $("#bookingModal").classList.add("hidden");
  showToast("Room reserved! Complete payment under 'My reservations'.", "success");
  goToView("view-mybookings");
});

// =========================================================
// GUEST — MY RESERVATIONS
// =========================================================
async function loadMyBookings(){
  const list = $("#myBookingsList");
  list.innerHTML = `<div class="empty-note">Loading…</div>`;

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
        <span class="li-title">Room ${r.rooms.room_number} — ${r.rooms.room_type}</span>
        <span class="li-sub">${r.check_in} → ${r.check_out} · ${peso(r.total_price)}</span>
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
}

async function cancelReservation(id){
  const { error } = await supabase.from("reservations").update({ status: "cancelled" }).eq("id", id);
  if (error){ showToast(error.message, "error"); return; }
  showToast("Reservation cancelled.", "success");
  loadMyBookings();
}

// =========================================================
// PAYMENT MODAL
// =========================================================
function openPaymentModal(paymentId, reservationId, amount){
  selectedReservationForPayment = { paymentId, reservationId, amount };
  $("#paymentSummary").textContent = `Amount due: ${peso(amount)}`;
  setMsg($("#paymentMsg"), "");
  $("#paymentModal").classList.remove("hidden");
}
$("#closePaymentModal").addEventListener("click", () => $("#paymentModal").classList.add("hidden"));

$("#confirmPaymentBtn").addEventListener("click", async () => {
  const { paymentId, reservationId } = selectedReservationForPayment;
  const method = $("#paymentMethod").value;

  setMsg($("#paymentMsg"), "Processing payment…");
  const { error: payErr } = await supabase
    .from("payments")
    .update({ payment_status: "paid", method, paid_at: new Date().toISOString() })
    .eq("id", paymentId);

  if (payErr){
    setMsg($("#paymentMsg"), payErr.message, "error");
    return;
  }

  await supabase.from("reservations").update({ status: "confirmed" }).eq("id", reservationId);

  $("#paymentModal").classList.add("hidden");
  showToast("Payment received — booking confirmed!", "success");
  loadMyBookings();
});

// =========================================================
// STAFF — MANAGE RESERVATIONS
// =========================================================
async function loadStaffReservations(){
  const list = $("#staffList");
  list.innerHTML = `<div class="empty-note">Loading…</div>`;

  const { data, error } = await supabase
    .from("reservations")
    .select("*, rooms(room_number, room_type), profiles(full_name, contact), payments(payment_status)")
    .order("created_at", { ascending: false });

  if (error || !data || data.length === 0){
    list.innerHTML = `<div class="empty-note">No reservations yet.</div>`;
    return;
  }

  list.innerHTML = "";
  data.forEach(r => {
    const payment = (r.payments && r.payments[0]) || null;
    const item = document.createElement("div");
    item.className = "glass list-item";
    item.innerHTML = `
      <div class="li-info">
        <span class="li-title">${r.profiles.full_name} — Room ${r.rooms.room_number}</span>
        <span class="li-sub">${r.rooms.room_type} · ${r.check_in} → ${r.check_out} · ${r.profiles.contact || "no contact"}</span>
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
      const { error } = await supabase
        .from("reservations")
        .update({ status: btn.dataset.action })
        .eq("id", btn.dataset.id);
      if (error){ showToast(error.message, "error"); return; }
      showToast("Reservation updated.", "success");
      loadStaffReservations();
    });
  });
}

// =========================================================
// ADMIN — MANAGE ROOMS
// =========================================================
$("#roomForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    room_number: $("#roomNumber").value.trim(),
    room_type: $("#roomType").value,
    price: Number($("#roomPrice").value),
    capacity: Number($("#roomCapacity").value),
    description: $("#roomDescription").value.trim(),
    availability: $("#roomAvailability").checked,
  };
  const id = $("#roomId").value;

  let error;
  if (id){
    ({ error } = await supabase.from("rooms").update(payload).eq("id", id));
  } else {
    ({ error } = await supabase.from("rooms").insert(payload));
  }
  if (error){ showToast(error.message, "error"); return; }

  showToast(id ? "Room updated." : "Room added.", "success");
  resetRoomForm();
  loadAdminRooms();
});
$("#roomFormReset").addEventListener("click", resetRoomForm);
function resetRoomForm(){
  $("#roomForm").reset();
  $("#roomId").value = "";
  $("#roomAvailability").checked = true;
}

async function loadAdminRooms(){
  const list = $("#adminRoomsList");
  list.innerHTML = `<div class="empty-note">Loading…</div>`;

  const { data, error } = await supabase.from("rooms").select("*").order("room_number");
  if (error || !data || data.length === 0){
    list.innerHTML = `<div class="empty-note">No rooms yet — add one above.</div>`;
    return;
  }

  list.innerHTML = "";
  data.forEach(room => {
    const item = document.createElement("div");
    item.className = "glass list-item";
    item.innerHTML = `
      <div class="li-info">
        <span class="li-title">Room ${room.room_number} — ${room.room_type}</span>
        <span class="li-sub">${peso(room.price)} / night · sleeps ${room.capacity} · ${room.availability ? "listed" : "hidden"}</span>
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
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    item.querySelector("[data-del]").addEventListener("click", async () => {
      if (!confirm(`Delete room ${room.room_number}?`)) return;
      const { error } = await supabase.from("rooms").delete().eq("id", room.id);
      if (error){ showToast(error.message, "error"); return; }
      showToast("Room deleted.", "success");
      loadAdminRooms();
    });
    list.appendChild(item);
  });
}

// =========================================================
// ADMIN — MANAGE USERS
// =========================================================
async function loadUsers(){
  const list = $("#usersList");
  list.innerHTML = `<div class="empty-note">Loading…</div>`;

  const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
  if (error || !data || data.length === 0){
    list.innerHTML = `<div class="empty-note">No users found.</div>`;
    return;
  }

  list.innerHTML = "";
  data.forEach(u => {
    const item = document.createElement("div");
    item.className = "glass list-item";
    item.innerHTML = `
      <div class="li-info">
        <span class="li-title">${u.full_name}</span>
        <span class="li-sub">${u.contact || "no contact"} · joined ${new Date(u.created_at).toLocaleDateString()}</span>
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
      const { error } = await supabase.from("profiles").update({ role: e.target.value }).eq("id", u.id);
      if (error){ showToast(error.message, "error"); return; }
      showToast(`${u.full_name} is now ${e.target.value}.`, "success");
    });
    list.appendChild(item);
  });
}

} // end of __hmsAppBooted guard