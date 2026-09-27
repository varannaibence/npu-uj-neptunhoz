// "Mi van ma?" - three cards of what matters today, atop the dashboard's own columns
// and in place of its greeting:
// today's classes and exams with their rooms, payment deadlines, and registration
// periods that are running or about to open. Neptun spreads the same facts over the
// calendar, the finances page and the periods list, and shows its nine dashboard cards
// collapsed on every visit.
//
// The same data drives a once-a-day reminder on any page: a payment due or a period
// opening within a few days gets one toast. Measured endpoints: docs/API.md#api-calendar.
const interceptor = require("../interceptor");
const router = require("../router");
const storage = require("../storage");
const utils = require("../utils");
const tokens = require("../neptunTokens");
const settings = require("../settings");
const { showToast } = require("../toast");
const { wallClockToEpoch } = require("./rajtolo/protocol");
const { httpRequest } = require("./rajtolo/net");

const API_BASE = "/hallgato_ng/api/";
const DASHBOARD_ROUTES = ["/hallgato_ng/dashboard", "/hallgato_ng/", "/hallgato_ng"];
// Measured dashboard anchors: the greeting band and the three-column widget grid.
const BAND_SELECTOR = "neptun-dashboard .primary-bg-wrapper";
const GREETING_SELECTOR = ".header__left";
const GRID_SELECTOR = "neptun-dashboard div.widgets";
const CARD_ATTR = "data-npu-daily";
// With the greeting gone, the band only has to stay tall enough for the grid's
// measured 16 px overlap to still read as Neptun's layout.
const BAND_HEIGHT = "64px";
const TIME_ZONE = "Europe/Budapest";
const DAY_MS = 24 * 60 * 60 * 1000;
// Classes are read for today and tomorrow; periods and exams further ahead. Periods
// that opened weeks ago and are still running have to be inside the window too.
const LOOKBACK_DAYS = 60;
const HORIZON_DAYS = 45;
// What earns a toast: a payment due, or a period opening or closing, this soon.
const ALERT_DAYS = 3;
const CACHE_MS = 10 * 60 * 1000;
const EXAM_TYPE = 1;
const PERIOD_TYPE = 6;
const HOLIDAY_TYPE = 8;

const meta = {
  id: "dailyOverview",
  group: "daily",
  name: "Mi van ma?",
  where: "Kezdőlap, a tetején",
  description:
    "A kezdőlap tetején, a Neptun kártyáival egyező kártyákon: mai órák, befizetési határidők, tárgyfelvételi időszakok.",
  options: [
    {
      id: "dueCard",
      name: "Befizetendő tételek",
      where: "Kezdőlap: a „Befizetendő” kártya",
      description: "Kártya a befizetendő tételekkel, összeggel és határidővel.",
      defaultEnabled: true,
    },
    {
      id: "periodsCard",
      name: "Időszakok",
      where: "Kezdőlap: az „Időszakok” kártya",
      description: "Kártya a futó és 45 napon belül nyíló tárgy- és vizsgajelentkezési időszakokkal.",
      defaultEnabled: true,
    },
    {
      id: "reminders",
      name: "Napi értesítés",
      where: "Bejelentkezés után, felugró értesítésben",
      description:
        "Bejelentkezés után naponta egyszer értesít, ha egy befizetés vagy időszak 3 napon belül esedékes, vagy egy befizetés lejárt.",
      defaultEnabled: true,
    },
  ],
};

function shouldActivate() {
  return true;
}

// --- pure ---

// "YYYY-MM-DD" of `epochMs` in Budapest, the zone every Neptun date is written in.
function dayKey(epochMs) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epochMs));
  const field = type => parts.find(part => part.type === type).value;
  return `${field("year")}-${field("month")}-${field("day")}`;
}

// Whole calendar days from today to the day `value` falls on; negative in the past,
// NaN without a readable date.
function daysUntil(value, nowMs) {
  const utcDay = key => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(key || "");
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
  };
  return Math.round((utcDay(value) - utcDay(dayKey(nowMs))) / DAY_MS);
}

function dayWord(days) {
  if (days === 0) {
    return "ma";
  }
  if (days === 1) {
    return "holnap";
  }
  return days > 1 ? `${days} nap múlva` : `${-days} napja`;
}

function clock(value) {
  const match = /T(\d{2}):(\d{2})/.exec(value || "");
  return match ? `${Number(match[1])}:${match[2]}` : "";
}

// Sorts the calendar feed into what the panel shows. Classes carry classInstanceId;
// their eventTypeId was not captured in the measurement, so it is not relied on.
function sortEvents(events, nowMs) {
  const list = Array.isArray(events) ? events.filter(e => e && typeof e.startDate === "string") : [];
  const ends = e => wallClockToEpoch(e.endDate || e.startDate);
  const byStart = (a, b) => wallClockToEpoch(a.startDate) - wallClockToEpoch(b.startDate);
  const lessons = list
    .filter(e => e.classInstanceId || e.eventTypeId === EXAM_TYPE)
    .filter(e => ends(e) > nowMs)
    .sort(byStart);
  const today = lessons.filter(e => daysUntil(e.startDate, nowMs) === 0);
  const next = today.length === 0 ? lessons.find(e => daysUntil(e.startDate, nowMs) > 0) || null : null;
  const holidayToday = list.some(
    e =>
      e.eventTypeId === HOLIDAY_TYPE &&
      daysUntil(e.startDate, nowMs) <= 0 &&
      daysUntil(e.endDate || e.startDate, nowMs) >= 0
  );
  const periods = list
    .filter(e => e.eventTypeId === PERIOD_TYPE && ends(e) > nowMs)
    .map(e => {
      const running = wallClockToEpoch(e.startDate) <= nowMs;
      return {
        name: e.intervalType || e.name || "Időszak",
        running,
        at: running ? e.endDate : e.startDate,
        days: daysUntil(running ? e.endDate : e.startDate, nowMs),
      };
    })
    .filter(p => p.running || p.days <= HORIZON_DAYS)
    .sort((a, b) => wallClockToEpoch(a.at) - wallClockToEpoch(b.at));
  return { today, next, holidayToday, periods };
}

// An item without a readable deadline is still due: kept, last, with `days` null -
// dropping it let the card claim there was nothing to pay.
function dueItems(items, nowMs) {
  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .map(item => {
      const days = daysUntil(item.latestExecutionDate, nowMs);
      return {
        name: item.name || "Befizetendő tétel",
        value: typeof item.value === "number" ? item.value : null,
        currency: item.currency || "",
        at: item.latestExecutionDate || null,
        days: Number.isNaN(days) ? null : days,
      };
    })
    .sort((a, b) => (a.days === null) - (b.days === null) || a.days - b.days);
}

function money(value, currency) {
  if (typeof value !== "number") {
    return "";
  }
  return `${value.toLocaleString("hu-HU")} ${currency}`.trim();
}

// The reminders worth a toast. Periods count only when they open or close soon; a
// payment counts from ALERT_DAYS before its deadline, and every day once overdue.
function alertsFor(overview) {
  const alerts = [];
  (overview.due || [])
    .filter(item => item.days !== null && item.days <= ALERT_DAYS)
    .forEach(item => {
      alerts.push(
        item.days < 0
          ? { text: `Lejárt befizetés: ${item.name} (${dayWord(item.days)})`, tone: "error" }
          : { text: `Befizetési határidő ${dayWord(item.days)}: ${item.name}`, tone: "warn" }
      );
    });
  overview.periods
    .filter(p => p.days >= 0 && p.days <= ALERT_DAYS)
    .forEach(p => {
      alerts.push({ text: `${p.name}: ${dayWord(p.days)} ${p.running ? "zárul" : "nyílik"}`, tone: "warn" });
    });
  return alerts;
}

// Whether a reminder run said all it could. A failed load, or a payments list that
// could not be read, gives the day's claim back so the next page load tries again.
function reminderOutcome(overview, withDue) {
  if (!overview || (withDue && overview.due === null)) {
    return { alerts: [], release: true };
  }
  return { alerts: alertsFor(overview).slice(0, 3), release: false };
}

// --- network ---

function isOk(body) {
  return body && Array.isArray(body.data) && !(body.__npuStatus >= 400);
}

function calendarQuery(trainingId, nowMs) {
  return new URLSearchParams({
    startDate: new Date(nowMs - LOOKBACK_DAYS * DAY_MS).toISOString(),
    endDate: new Date(nowMs + HORIZON_DAYS * DAY_MS).toISOString(),
    "studentTrainingIds[0]": trainingId,
    isClassesVisible: "true",
    isExamsVisible: "true",
    isFinalExamsVisible: "false",
    isOnlineMeetingsVisible: "false",
    isOtherEventsVisible: "true",
    isPeriodsVisible: "true",
    isTasksVisible: "false",
  }).toString();
}

// Bound to the Neptun code it was read for, and dropped on every identity change:
// logging in as someone else in the same tab must never show the previous day.
let cache = null;

// Three GETs, at most once per CACHE_MS. Null on anything unexpected: the panel then
// says so rather than showing a half-true day.
async function loadOverview(withDue) {
  const nowMs = Date.now();
  const code = utils.getNeptunCode();
  if (!code) {
    return null;
  }
  if (cache && cache.code === code && cache.withDue === withDue && nowMs - cache.at < CACHE_MS) {
    return cache.value;
  }
  const trainings = await httpRequest("GET", `${API_BASE}Calendar/GetStudentTrainings`);
  if (!isOk(trainings)) {
    return null;
  }
  const training = trainings.data.find(t => t && t.actualStudentTraining) || trainings.data[0];
  if (!training || !training.studentTrainingId) {
    return null;
  }
  const [events, payments] = await Promise.all([
    httpRequest("GET", `${API_BASE}Calendar/GetCalendarEvents?${calendarQuery(training.studentTrainingId, nowMs)}`),
    withDue
      ? httpRequest("GET", `${API_BASE}FinancialItem/GetItemsToBePayed?sortAndPage.firstRow=0&sortAndPage.lastRow=100`)
      : null,
  ]);
  // Answered after an identity change: it belongs to someone else.
  if (!isOk(events) || utils.getNeptunCode() !== code) {
    return null;
  }
  const value = Object.assign(sortEvents(events.data, nowMs), {
    // Null, not empty, when the payments call failed: "nothing due" would be a claim
    // we cannot make. The rest of the day stays intact.
    due: !withDue ? [] : isOk(payments) ? dueItems(payments.data, nowMs) : null,
  });
  // A partial answer is shown once but not kept, so the next visit asks again.
  if (value.due !== null) {
    cache = { at: nowMs, code, withDue, value };
  }
  return value;
}

// --- UI ---
// Built like Neptun's own dashboard widgets (measured computed styles, not their
// encapsulated classes): white card, the same shadow, a 58 px header with an
// evericons glyph and a 21 px heavy title, 16 px list lines, a primary link below.

const CARDS = [
  { key: "today", title: "Ma", icon: "icon-calendar", link: "/hallgato_ng/calendar", more: "Naptár" },
  {
    key: "due",
    title: "Befizetendő",
    icon: "icon-wallet",
    link: "/hallgato_ng/finances/overview/to-be-paid",
    more: "Befizetendő tételek",
  },
  {
    key: "periods",
    title: "Időszakok",
    icon: "icon-calendar-dates",
    link: "/hallgato_ng/informations/periods",
    more: "Összes időszak",
  },
];

function buildCard(spec) {
  const card = document.createElement("section");
  card.setAttribute(CARD_ATTR, spec.key);
  card.setAttribute("aria-label", spec.title);
  card.style.cssText = `background:${tokens.surface};box-shadow:0 8px 32px rgba(0,0,0,.08);margin-bottom:20px`;
  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;height:58px;padding:0 16px";
  const icon = document.createElement("i");
  icon.className = spec.icon;
  icon.setAttribute("aria-hidden", "true");
  icon.style.cssText = `font-size:22px;margin-right:8px;color:${tokens.text}`;
  const title = document.createElement("h4");
  title.textContent = spec.title;
  title.style.cssText = `margin:0;font-family:"Source Sans Pro",sans-serif;font-size:21px;font-weight:900;color:${tokens.text}`;
  header.appendChild(icon);
  header.appendChild(title);
  const body = document.createElement("div");
  body.setAttribute("data-npu-daily-body", "");
  body.style.cssText = "padding:2px 16px 16px";
  body.appendChild(line("Betöltés…"));
  card.appendChild(header);
  card.appendChild(body);
  return card;
}

// One item, laid out like Neptun's own event list: a coloured square with the kind,
// the name, then the detail line; a hairline between items.
function entry(kind, primary, secondary, alert) {
  const box = document.createElement("div");
  box.style.cssText = "padding:12px 0;border-bottom:1px solid rgba(0,0,0,.12);min-width:0";
  if (kind) {
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:8px;font-size:16px;line-height:22px;color:#222";
    const square = document.createElement("span");
    square.setAttribute("aria-hidden", "true");
    square.style.cssText = `width:10px;height:10px;border-radius:2px;flex:0 0 10px;background:${
      alert ? "#c0392b" : tokens.primary
    }`;
    head.appendChild(square);
    head.appendChild(document.createTextNode(kind));
    box.appendChild(head);
  }
  const first = document.createElement("div");
  first.textContent = primary;
  first.title = primary;
  first.style.cssText =
    `padding-left:${kind ? 18 : 0}px;font-size:16px;font-weight:800;line-height:22px;color:${tokens.text};` +
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  box.appendChild(first);
  if (secondary) {
    const second = document.createElement("div");
    second.textContent = secondary;
    second.style.cssText = `padding-left:${kind ? 18 : 0}px;font-size:16px;line-height:22px;color:${
      alert ? "#c0392b" : "#222"
    }`;
    box.appendChild(second);
  }
  return box;
}

function line(text) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = "font-size:16px;line-height:20px;color:#222";
  return el;
}

function moreLink(spec) {
  const a = document.createElement("a");
  a.href = spec.link;
  a.textContent = `${spec.more} ›`;
  a.style.cssText = `display:inline-block;margin-top:12px;font-size:16px;font-weight:900;color:${tokens.primary};text-decoration:none`;
  return a;
}

function lessonItem(e, when) {
  const kind = e.eventTypeId === EXAM_TYPE ? "Vizsga" : e.courseType || "Tanóra";
  const time = `${when ? `${when}, ` : ""}${clock(e.startDate)}–${clock(e.endDate)}`;
  return entry(kind, e.name || e.courseCode || "", [time, e.rooms].filter(Boolean).join(" · "));
}

function fill(card, spec, overview) {
  const body = card.querySelector("[data-npu-daily-body]");
  body.textContent = "";
  const nowMs = Date.now();
  const items = [];
  if (!overview) {
    items.push(entry("", "Nem sikerült betölteni.", "Próbáld újra az oldal frissítésével."));
  } else if (spec.key === "today") {
    if (overview.holidayToday) {
      items.push(entry("Szünnap", "Ma szünnap van.", ""));
    }
    overview.today.forEach(e => items.push(lessonItem(e, "")));
    if (overview.today.length === 0) {
      items.push(entry("", "Ma nincs órád.", ""));
      if (overview.next) {
        items.push(lessonItem(overview.next, dayWord(daysUntil(overview.next.startDate, nowMs))));
      }
    }
  } else if (spec.key === "due" && overview.due === null) {
    items.push(entry("", "Nem sikerült betölteni a befizetendő tételeket.", "Próbáld újra az oldal frissítésével."));
  } else if (spec.key === "due") {
    overview.due.slice(0, 3).forEach(d => {
      const when =
        d.days === null ? "határidő nélkül" : d.days < 0 ? `lejárt ${dayWord(d.days)}` : `határidő ${dayWord(d.days)}`;
      const alert = d.days !== null && d.days <= ALERT_DAYS;
      items.push(entry("Befizetés", d.name, [money(d.value, d.currency), when].filter(Boolean).join(" · "), alert));
    });
    if (items.length === 0) {
      items.push(entry("", "Nincs befizetendő tétel.", ""));
    }
  } else {
    overview.periods.slice(0, 3).forEach(p => {
      items.push(
        entry("Időszak", p.name, `${dayWord(p.days)} ${p.running ? "zárul" : "nyílik"}`, p.days <= ALERT_DAYS)
      );
    });
    if (items.length === 0) {
      items.push(entry("", "Nincs futó vagy közelgő időszak.", ""));
    }
  }
  items.forEach(el => body.appendChild(el));
  body.appendChild(moreLink(spec));
}

// Which cards to draw, from the panel's options. "Ma" is the module itself.
function visibleCards(options) {
  return CARDS.filter(spec => spec.key === "today" || options[spec.key]);
}

// Set once in initialize(); the panel's switches apply on the next page load.
let options = { due: true, periods: true, reminders: true };

// Payments are fetched only when a card or the reminder will use them.
function wantDue() {
  return options.due || options.reminders;
}

function mount() {
  const grid = document.querySelector(GRID_SELECTOR);
  const columns = grid ? Array.from(grid.children) : [];
  if (columns.length === 0 || grid.querySelector(`[${CARD_ATTR}]`)) {
    return;
  }
  const band = document.querySelector(BAND_SELECTOR);
  const greeting = band && band.querySelector(GREETING_SELECTOR);
  if (greeting) {
    greeting.style.display = "none";
    band.style.height = BAND_HEIGHT;
  }
  // Top of each of Neptun's columns; a narrow screen with fewer columns stacks them.
  const specs = visibleCards(options);
  const cards = specs.map((spec, i) => {
    const card = buildCard(spec);
    const column = columns[i % columns.length];
    column.insertBefore(card, column.firstChild);
    return card;
  });
  loadOverview(wantDue())
    .catch(() => null)
    .then(overview => {
      cards.forEach((card, i) => {
        if (card.isConnected) {
          fill(card, specs[i], overview);
        }
      });
    });
}

// --- the once-a-day reminder ---

function remind() {
  const today = dayKey(Date.now());
  const code = utils.getNeptunCode();
  let previous;
  storage
    .whenReady()
    .then(() => {
      previous = storage.getForUser("dailyOverview", "remindedOn");
      if (!code || utils.getNeptunCode() !== code || previous === today) {
        return undefined;
      }
      // Claimed before the requests, so a second tab opened meanwhile stays quiet.
      storage.setForUser("dailyOverview", "remindedOn", today);
      return loadOverview(wantDue()).catch(() => null);
    })
    .then(overview => {
      // Another user logged in meanwhile: their record and their screen are not ours.
      if (overview === undefined || utils.getNeptunCode() !== code) {
        return;
      }
      const outcome = reminderOutcome(overview, wantDue());
      if (outcome.release) {
        storage.setForUser("dailyOverview", "remindedOn", previous || null);
      }
      outcome.alerts.forEach(alert => showToast(alert.text, alert.tone, { durationMs: 0 }));
    })
    .catch(() => {
      // A reminder is a courtesy; a failure here must never surface as an error.
    });
}

function initialize() {
  const flags = settings.readFlags();
  const option = id =>
    settings.isOptionEnabled(
      { meta },
      meta.options.find(o => o.id === id),
      flags
    );
  options = { due: option("dueCard"), periods: option("periodsCard"), reminders: option("reminders") };
  let scheduled = false;
  function tick() {
    scheduled = false;
    // The cards are per user (cache, payments), so not before the identity is known.
    if (DASHBOARD_ROUTES.includes(router.getPath()) && interceptor.getAuthHeader() && utils.getNeptunCode()) {
      mount();
    }
  }
  function scheduleTick() {
    if (!scheduled) {
      scheduled = true;
      setTimeout(tick, 0);
    }
  }
  router.onChange(scheduleTick);
  new MutationObserver(scheduleTick).observe(document.documentElement, { childList: true, subtree: true });
  // After the identity is known, so the reminder is per user and never before login.
  utils.onNeptunCodeChange(code => {
    cache = null;
    // Cards drawn for the previous user go; the next tick draws the new user's.
    document.querySelectorAll(`[${CARD_ATTR}]`).forEach(card => card.remove());
    scheduleTick();
    if (code && options.reminders) {
      setTimeout(remind, 3000);
    }
  });
}

module.exports = {
  meta,
  shouldActivate,
  initialize,
  dayKey,
  daysUntil,
  dayWord,
  sortEvents,
  dueItems,
  alertsFor,
  reminderOutcome,
  visibleCards,
};
