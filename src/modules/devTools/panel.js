// The developer panel: the log, the state behind it and the Mérőmód samples, in one
// dialog opened from the userscript manager's menu. Everything it shows or copies is
// masked where it is recorded, so the one "copy all" can go into a bug report as is.
const devlog = require("../../devlog");
const modal = require("../../modal");
const utils = require("../../utils");
const tokens = require("../../neptunTokens");
const storage = require("../../storage");
const { showToast } = require("../../toast");
const samples = require("./samples");

const PANEL_CLASS = "npu-dev";
const ISSUES_URL = "https://github.com/varannaibence/npu-uj-neptunhoz/issues";
// .github/ISSUE_TEMPLATE/measurement.yml: its form has the paste field and the
// warning. With issue forms in the repo, GitHub ignores a `body` parameter anyway.
const ISSUE_TEMPLATE = "measurement.yml";
// The live log redraws at most this often while it streams.
const REDRAW_MS = 250;

const KIND_LABELS = {
  api: "API",
  auth: "Munkamenet",
  route: "Útvonal",
  clock: "Szerveróra",
  module: "Modul",
  rajtolo: "Rajtoló",
  sample: "Mérőmód",
  error: "Hiba",
};

const TABS = [
  { id: "log", label: "Napló" },
  { id: "state", label: "Állapot" },
  { id: "samples", label: "Minták" },
];

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

// Wall-clock time with milliseconds, in the browser's zone.
function clockText(epochMs) {
  const date = new Date(epochMs);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3
  )}`;
}

function durationText(ms) {
  const abs = Math.abs(ms);
  if (abs < 1000) {
    return `${Math.round(abs)} ms`;
  }
  if (abs < 120000) {
    return `${Math.round(abs / 1000)} mp`;
  }
  return `${Math.round(abs / 60000)} perc`;
}

// Pure: one log line. Server time, since the Rajtoló's opening is a server instant.
function formatEntry(entry) {
  const label = KIND_LABELS[entry.kind] || entry.kind;
  const stack = entry.fields && entry.fields.stack ? `\n    ${entry.fields.stack.split("\n").join("\n    ")}` : "";
  return `${clockText(entry.serverAt)}  ${label.padEnd(10)}  ${entry.message}${stack}`;
}

// Pure: the state tab's rows from a snapshot the module gathers. Says whether a
// token or a Neptun code is there, never what it is.
function stateRows(snapshot) {
  const now = snapshot.now;
  const timing = snapshot.authTiming || {};
  let token = "nincs adat";
  if (typeof timing.expiresAtMs === "number") {
    const left = timing.expiresAtMs - now;
    token = left >= 0 ? `lejár ${durationText(left)} múlva` : `lejárt ${durationText(left)} ezelőtt`;
    if (typeof timing.issuedAtMs === "number") {
      token += `, ${durationText(now - timing.issuedAtMs)} ezelőtt kiadva`;
    }
  }
  const offset = snapshot.serverOffsetMs;
  const enabled = (snapshot.modules || []).filter(module => module.on).map(module => module.id);
  return [
    ["NPU", snapshot.version || "ismeretlen"],
    ["Neptun", snapshot.host || "ismeretlen"],
    ["Útvonal", snapshot.path || "ismeretlen"],
    ["Bejelentkezés", snapshot.hasAuth ? "van érvényes fejléc" : "nincs fejléc"],
    ["Token", token],
    [
      "Az oldal utolsó saját kérése",
      typeof snapshot.lastPageRequestAt === "number"
        ? `${durationText(now - snapshot.lastPageRequestAt)} ezelőtt`
        : "még nem volt",
    ],
    [
      "Szerveróra-eltérés",
      typeof offset === "number" ? `${offset >= 0 ? "+" : "−"}${Math.abs(offset)} ms` : "még nincs minta",
    ],
    ["Neptun-kód", snapshot.hasCode ? "rögzítve (itt nem látszik)" : "nincs"],
    ["Tárhely", snapshot.store || "ismeretlen"],
    ["Bekapcsolt modulok", enabled.length > 0 ? enabled.join(", ") : "egy sem"],
    ["Napló", `${snapshot.logCount} bejegyzés (legfeljebb ${devlog.MAX_ENTRIES}, csak memóriában)`],
    ["Mérőmód", snapshot.samplesOn ? `be, ${snapshot.sampleCount} minta` : "ki"],
  ];
}

// Pure: everything the panel knows, as one JSON text for a bug report.
function exportText({ snapshot, entries, sampleList }) {
  return JSON.stringify(
    {
      npu: snapshot.version || null,
      exportedAt: new Date(snapshot.now).toISOString(),
      state: Object.fromEntries(stateRows(snapshot)),
      log: entries.map(entry => ({
        serverTime: new Date(entry.serverAt).toISOString(),
        kind: entry.kind,
        message: entry.message,
        ...(entry.fields ? { fields: entry.fields } : {}),
      })),
      samples: sampleList,
    },
    null,
    2
  );
}

let cssInjected = false;
function injectCss() {
  if (cssInjected) {
    return;
  }
  cssInjected = true;
  utils.injectCss(`
    .${PANEL_CLASS}{display:flex;flex-direction:column;gap:12px;color:${tokens.text}}
    .${PANEL_CLASS}__tabs{display:inline-flex;align-self:flex-start;border:1px solid ${tokens.primary};border-radius:8px;overflow:hidden}
    .${PANEL_CLASS}__tab{border:0;background:transparent;color:${tokens.primary};padding:6px 14px;cursor:pointer;font:inherit;font-weight:600}
    .${PANEL_CLASS}__tab[aria-selected="true"]{background:${tokens.primary};color:#fff}
    .${PANEL_CLASS}__body{display:flex;flex-direction:column;gap:12px}
    .${PANEL_CLASS}__bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
    .${PANEL_CLASS}__log{margin:0;max-height:50vh;overflow:auto;padding:8px 10px;border-radius:8px;
      background:${tokens.subtleSurface};font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
    .${PANEL_CLASS}__log [data-kind="error"]{color:#c0392b}
    .${PANEL_CLASS}__state{border-collapse:collapse;font-size:14px}
    .${PANEL_CLASS}__state th{text-align:left;font-weight:600;padding:4px 16px 4px 0;vertical-align:top;white-space:nowrap}
    .${PANEL_CLASS}__state td{padding:4px 0;overflow-wrap:anywhere}
    .${PANEL_CLASS} textarea{width:100%;box-sizing:border-box;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;resize:vertical}
    .${PANEL_CLASS} select{font:inherit;padding:4px 6px;border-radius:6px}
  `);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

// Resolves whether the text reached the clipboard, and says so either way.
function copyText(text, doneMessage = "A vágólapra került.") {
  const fallback = () => {
    const area = el("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (e) {
      copied = false;
    }
    area.remove();
    return copied;
  };
  const attempt =
    navigator.clipboard && typeof navigator.clipboard.writeText === "function"
      ? navigator.clipboard.writeText(text).then(() => true, fallback)
      : Promise.resolve(fallback());
  return attempt.then(copied => {
    showToast(
      copied ? doneMessage : "A másolás nem sikerült: a böngésző nem engedte a vágólapot.",
      copied ? "ok" : "warn"
    );
    return copied;
  });
}

// Pure: the measurement form with a title. The data itself never goes into the URL
// - it is too long for one, and a URL ends up in histories and logs; it travels by
// the clipboard, which the student pastes and reviews.
function issueUrl(host) {
  const params = new URLSearchParams({
    template: ISSUE_TEMPLATE,
    title: `Mérés: ${host || "ismeretlen intézmény"}`,
  });
  return `${ISSUES_URL}/new?${params}`;
}

function submitToGitHub(text, host) {
  const url = issueUrl(host);
  copyText(text, "A napló a vágólapon: illeszd be a megnyíló GitHub-oldalon, és küldés előtt nézd át.").then(copied => {
    if (!copied) {
      return;
    }
    // After the copy, not before: a new tab takes the focus the clipboard needs.
    // Chrome and Firefox still count this as the click's own; where a browser does
    // not, the link comes in a toast instead.
    const opened = window.open(url, "_blank");
    if (opened) {
      opened.opener = null;
    } else {
      showToast("A böngésző nem nyitotta meg az új lapot.", "warn", {
        link: { href: url, label: "GitHub-issue megnyitása" },
        durationMs: 0,
      });
    }
  });
}

// `getSnapshot()` is the module's view of the live state; see stateRows.
function open(getSnapshot) {
  injectCss();
  // The samples wait for the store; the log does not. A manager without a writable
  // store must not keep the panel shut - that is when it is needed most.
  const ready = storage.whenReady().catch(error => devlog.error("tárhely", error));
  ready.then(() => {
    let tab = "log";
    let filter = "";
    let body = null;
    let tabBar = null;
    let redrawPending = false;
    let unsubscribe = () => {};

    function renderTabs() {
      tabBar.textContent = "";
      TABS.forEach(item => {
        const button = el("button", `${PANEL_CLASS}__tab`, item.label);
        button.type = "button";
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(item.id === tab));
        button.addEventListener("click", () => {
          tab = item.id;
          render();
        });
        tabBar.appendChild(button);
      });
    }

    // The bar is built once per visit to the tab; a stream update only refills the
    // lines, so an open filter menu or a scrolled-up reader is left alone.
    let logView = null;
    let logCount = null;
    function fillLog() {
      if (!logView) {
        return;
      }
      const atBottom = logView.scrollTop + logView.clientHeight >= logView.scrollHeight - 4;
      const top = logView.scrollTop;
      const entries = devlog.getEntries().filter(entry => !filter || entry.kind === filter);
      logCount.textContent = `${entries.length} bejegyzés · szerveridő`;
      logView.textContent =
        entries.length === 0 ? "Még nincs bejegyzés. A napló a bekapcsolás utáni oldalbetöltéstől gyűlik." : "";
      entries.forEach(entry => {
        const line = el("div", "", formatEntry(entry));
        line.setAttribute("data-kind", entry.kind);
        logView.appendChild(line);
      });
      logView.scrollTop = atBottom ? logView.scrollHeight : top;
    }

    function renderLog() {
      const bar = el("div", `${PANEL_CLASS}__bar`);
      const select = el("select");
      select.setAttribute("aria-label", "Szűrés típusra");
      [["", "Minden típus"]].concat(Object.entries(KIND_LABELS)).forEach(([value, label]) => {
        const option = el("option", "", label);
        option.value = value;
        option.selected = value === filter;
        select.appendChild(option);
      });
      select.addEventListener("change", () => {
        filter = select.value;
        fillLog();
      });
      const clearButton = modal.actionButton("Napló törlése", false);
      clearButton.addEventListener("click", () => devlog.clear());
      logCount = el("span");
      bar.appendChild(select);
      bar.appendChild(logCount);
      bar.appendChild(clearButton);
      logView = el("div", `${PANEL_CLASS}__log`);
      logView.setAttribute("role", "log");
      body.appendChild(bar);
      body.appendChild(logView);
      fillLog();
      logView.scrollTop = logView.scrollHeight;
    }

    function renderState() {
      const table = el("table", `${PANEL_CLASS}__state`);
      stateRows(getSnapshot()).forEach(([label, value]) => {
        const row = el("tr");
        row.appendChild(el("th", "", label));
        row.appendChild(el("td", "", value));
        table.appendChild(row);
      });
      body.appendChild(table);
    }

    function renderSamples() {
      const list = samples.stored();
      body.appendChild(
        el(
          "p",
          "",
          list.length > 0
            ? "A minták maszkoltak, de küldés előtt nézd át őket: ne legyen bennük név, Neptun-kód, jegy vagy " +
                "tárgy, amit nem akarsz megosztani. Beküldés: GitHub-issue „Mérés: <intézmény>” címmel."
            : "Még nincs minta. Tárgyfelvételkor magától gyűlik, akár kézzel veszed fel a tárgyat, akár a " +
                "Rajtolóval; a SystemParameters már a Tárgyfelvétel oldal megnyitásakor ad egyet."
        )
      );
      if (list.length === 0) {
        return;
      }
      const area = el("textarea");
      area.readOnly = true;
      area.rows = 16;
      area.value = JSON.stringify(list, null, 2);
      const bar = el("div", `${PANEL_CLASS}__bar`);
      const copyButton = modal.actionButton("Minták másolása", false);
      copyButton.addEventListener("click", () => copyText(area.value));
      // One run's success sample is worth a semester: a stray click only asks.
      const clearButton = modal.actionButton("Minták törlése", false);
      let confirming = false;
      clearButton.addEventListener("click", () => {
        if (!confirming) {
          confirming = true;
          utils.setButtonLabel(clearButton, "Biztosan törlöd?");
          return;
        }
        samples
          .clear()
          .catch(error => devlog.error("Minták törlése", error))
          .then(render);
      });
      bar.appendChild(copyButton);
      bar.appendChild(clearButton);
      body.appendChild(area);
      body.appendChild(bar);
    }

    function render() {
      if (!body) {
        return;
      }
      renderTabs();
      body.textContent = "";
      logView = null;
      ({ log: renderLog, state: renderState, samples: renderSamples })[tab]();
    }

    const everything = () =>
      exportText({ snapshot: getSnapshot(), entries: devlog.getEntries(), sampleList: samples.stored() });

    const dialog = modal.open({
      title: "NPU fejlesztői eszközök",
      onClose() {
        unsubscribe();
        body = null;
      },
      build(content) {
        const root = el("div", PANEL_CLASS);
        tabBar = el("div", `${PANEL_CLASS}__tabs`);
        tabBar.setAttribute("role", "tablist");
        body = el("div", `${PANEL_CLASS}__body`);
        root.appendChild(tabBar);
        root.appendChild(body);
        content.appendChild(root);
        render();
      },
      actions: [
        { label: "Bezárás" },
        {
          label: "Minden másolása",
          onClick() {
            copyText(everything());
            return false;
          },
        },
        {
          label: "Beküldés GitHubon",
          primary: true,
          onClick() {
            submitToGitHub(everything(), location.host);
            return false;
          },
        },
      ],
    });
    if (!dialog) {
      return;
    }
    // The log streams while its tab is open; redraws are batched.
    unsubscribe = devlog.subscribe(() => {
      if (!logView || redrawPending) {
        return;
      }
      redrawPending = true;
      setTimeout(() => {
        redrawPending = false;
        fillLog();
      }, REDRAW_MS);
    });
  });
}

module.exports = { open, formatEntry, stateRows, exportText, durationText, issueUrl };
