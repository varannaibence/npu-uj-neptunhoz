// The panel behind the footer's "Beállítások" link: the accent colour, then switches
// for modules and their sub-options, organized into collapsible groups.
//
// Switching takes effect on the next page load, not immediately. A module that is
// already running has registered interceptor handlers and MutationObservers that
// cannot be cleanly withdrawn, and pretending otherwise would leave half a feature
// on screen. So the panel says so, and offers to reload. The colour is the one
// exception: it is only CSS, so it previews live and Mégse puts it back.
const modal = require("./modal");
const settings = require("./settings");
const theme = require("./theme");
const tokens = require("./neptunTokens");
const utils = require("./utils");

let registry = [];
let idSequence = 0;

const STYLE_ID = "npu-settings-style";
const LINE = "rgba(33,48,85,.12)";

// Class-based rather than inline, so hover, focus and the switch animation are CSS.
// Every colour is a Neptun token, so the panel follows a chosen theme as well.
const CSS = `
.npu-s { display: flex; flex-direction: column; gap: 24px; color: ${tokens.text}; }
.npu-s p { margin: 0; }
.npu-s__hint { font-size: 13px; opacity: .68; }
.npu-s__alert {
  font-size: 13px; line-height: 1.45; padding: 10px 14px; border-radius: 10px;
  background: rgba(242,153,74,.12); border-left: 3px solid #f2994a;
}
.npu-s__label {
  font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  opacity: .6; margin: 0 0 10px;
}
.npu-s__card { border: 1px solid ${LINE}; border-radius: 16px; overflow: hidden; }
.npu-s__theme { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.npu-s__swatches { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.npu-s__swatch {
  position: relative; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 50%;
  background: var(--npu-c); cursor: pointer; box-shadow: inset 0 0 0 1px rgba(0,0,0,.1);
  transition: transform .15s ease, box-shadow .15s ease;
}
.npu-s__swatch:hover { transform: scale(1.1); }
.npu-s__swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px ${tokens.surface}, 0 0 0 4px var(--npu-c); }
.npu-s__swatch[aria-pressed="true"]::after {
  content: ""; position: absolute; left: 12px; top: 9px; width: 7px; height: 12px;
  border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg);
}
.npu-s__custom { background: conic-gradient(#e53935, #fdd835, #43a047, #1e88e5, #8e24aa, #e53935); overflow: hidden; }
.npu-s__custom input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; padding: 0; }
.npu-s__theme-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.npu-s__link {
  font: inherit; font-size: 13px; font-weight: 600; color: ${tokens.primary};
  background: none; border: 0; padding: 4px 0; cursor: pointer;
}
.npu-s__link:disabled { opacity: .4; cursor: default; }
.npu-s__group-head {
  display: flex; align-items: center; justify-content: space-between; width: 100%;
  margin: 0 0 10px; padding: 0; border: 0; background: none; cursor: pointer;
  font: inherit; color: inherit; text-align: left;
}
.npu-s__group-head .npu-s__label { margin: 0; }
.npu-s__chevron { width: 16px; height: 16px; opacity: .6; transition: transform .2s ease; }
.npu-s__group-head[aria-expanded="false"] .npu-s__chevron { transform: rotate(-90deg); }
.npu-s__group-body { display: grid; grid-template-rows: 1fr; transition: grid-template-rows .25s ease; }
.npu-s__group-body[data-collapsed] { grid-template-rows: 0fr; }
.npu-s__group-body > .npu-s__card { min-height: 0; }
.npu-s__group-body[data-collapsed] > .npu-s__card { border-color: transparent; }
.npu-s__row {
  display: flex; gap: 16px; align-items: flex-start; justify-content: space-between;
  padding: 14px 16px; cursor: pointer; transition: background-color .15s ease;
}
.npu-s__card > * + * > .npu-s__row:first-child, .npu-s__row + .npu-s__row { border-top: 1px solid ${LINE}; }
.npu-s__row:hover { background: ${tokens.subtleSurface}; }
.npu-s__row[data-disabled] { cursor: default; }
.npu-s__row[data-disabled]:hover { background: none; }
.npu-s__row--option { padding-left: 32px; }
.npu-s__row--option .npu-s__text { border-left: 2px solid ${LINE}; padding-left: 12px; }
.npu-s__row[data-disabled] .npu-s__text { opacity: .5; }
.npu-s__title { display: block; font-weight: 600; font-size: 15px; line-height: 1.3; }
.npu-s__row--option .npu-s__title { font-size: 14px; }
.npu-s__desc { display: block; font-size: 13px; line-height: 1.4; opacity: .72; margin-top: 3px; }
.npu-s__where { display: block; font-size: 12px; line-height: 1.4; opacity: .6; margin-top: 3px; }
.npu-s__where b { font-weight: 700; }
.npu-s__switch {
  position: relative; flex: 0 0 auto; width: 40px; height: 24px; margin-top: 1px; padding: 0;
  border: 0; border-radius: 12px; background: #c4c9d6; cursor: pointer; transition: background-color .2s ease;
}
.npu-s__switch::after {
  content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .2s ease;
}
.npu-s__switch[aria-checked="true"] { background: ${tokens.primary}; }
.npu-s__switch[aria-checked="true"]::after { transform: translateX(16px); }
.npu-s__switch:disabled { opacity: .45; cursor: default; }
.npu-s button:focus-visible, .npu-s__custom:focus-within { outline: 2px solid ${tokens.focus}; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .npu-s *, .npu-s *::after { transition: none !important; }
}
`;

function injectCss(doc) {
  if (doc.getElementById(STYLE_ID)) {
    return;
  }
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

// index.js hands over the list it is about to initialize, so the panel never has to
// import the modules itself - that would be a cycle.
function setRegistry(modules) {
  registry = modules.filter(module => module && module.meta && module.meta.id);
}

// The panel's sections, in this order; they mirror the README's feature tables. A
// module names its section by id in `meta.group`; one without a known id lands in
// "Egyéb" at the end rather than disappearing.
const GROUPS = [
  { id: "registration", name: "Tárgyfelvétel" },
  { id: "rajtolo", name: "Rajtoló" },
  { id: "daily", name: "Mindennapok" },
  { id: "comfort", name: "Megjelenés és kényelem" },
];

// Pure: modules -> [{ id, name, modules }], empty sections left out.
function groupModules(modules) {
  const sections = GROUPS.map(group => ({ id: group.id, name: group.name, modules: [] }));
  const rest = { id: null, name: "Egyéb", modules: [] };
  modules.forEach(module => {
    const id = module.meta && module.meta.group;
    (sections.find(section => section.id === id) || rest).modules.push(module);
  });
  return sections.concat(rest).filter(section => section.modules.length > 0);
}

// A button with role="switch": keyboard, focus and screen-reader state for free.
function buildSwitch(doc, checked, disabled) {
  const input = el(doc, "button", "npu-s__switch");
  input.type = "button";
  input.setAttribute("role", "switch");
  input.setAttribute("aria-checked", String(checked));
  input.disabled = disabled;
  input.addEventListener("click", event => {
    event.stopPropagation();
    input.setAttribute("aria-checked", String(!isOn(input)));
    input.dispatchEvent(new Event("change"));
  });
  return input;
}

function isOn(input) {
  return input.getAttribute("aria-checked") === "true";
}

// One switch row. The whole row is the click target; the switch carries the state.
function switchRow(doc, { name, description, where, checked, disabled, option }, onToggle) {
  const item = el(doc, "div", option ? "npu-s__row npu-s__row--option" : "npu-s__row");
  const text = el(doc, "span", "npu-s__text");
  const title = el(doc, "span", "npu-s__title", name);
  title.id = `npu-s-title-${++idSequence}`;
  text.appendChild(title);
  const input = buildSwitch(doc, checked, disabled);
  input.setAttribute("aria-labelledby", title.id);
  if (description) {
    const desc = el(doc, "span", "npu-s__desc", description);
    desc.id = `npu-s-desc-${++idSequence}`;
    input.setAttribute("aria-describedby", desc.id);
    text.appendChild(desc);
  }
  // Where on Neptun's pages the feature shows up, so a switched-on one can be found.
  if (where) {
    const place = el(doc, "span", "npu-s__where");
    place.appendChild(el(doc, "b", null, "Hol: "));
    place.appendChild(doc.createTextNode(where));
    place.id = `npu-s-where-${++idSequence}`;
    const described = input.getAttribute("aria-describedby");
    input.setAttribute("aria-describedby", described ? `${described} ${place.id}` : place.id);
    text.appendChild(place);
  }
  item.appendChild(text);
  item.appendChild(input);
  item.toggleAttribute("data-disabled", disabled);
  item.addEventListener("click", () => {
    if (!input.disabled) {
      input.click();
    }
  });
  input.addEventListener("change", () => onToggle(isOn(input)));
  return { item, input };
}

function setRowDisabled(row, disabled) {
  row.input.disabled = disabled;
  row.item.toggleAttribute("data-disabled", disabled);
}

// Render a module switch with its sub-options below it.
function moduleRows(doc, module, flags, editable, onChange) {
  const meta = module.meta;
  const container = doc.createElement("div");
  const optionRows = [];

  const main = switchRow(
    doc,
    {
      name: meta.required ? `${meta.name} (mindig bekapcsolva)` : meta.name,
      description: meta.description,
      where: meta.where,
      checked: settings.isEnabled(module, flags),
      disabled: Boolean(meta.required) || !editable,
    },
    on => {
      onChange(meta.id, on);
      // When the module toggle changes, update the disable state of all sub-options.
      optionRows.forEach(optionRow => setRowDisabled(optionRow, !on || !editable));
    }
  );
  container.appendChild(main.item);

  (Array.isArray(meta.options) ? meta.options : []).forEach(option => {
    const optionKey = `${meta.id}.${option.id}`;
    const optionRow = switchRow(
      doc,
      {
        name: option.name,
        description: option.description,
        where: option.where,
        checked: settings.isOptionEnabled(module, option, flags),
        disabled: !isOn(main.input) || !editable,
        option: true,
      },
      on => onChange(optionKey, on)
    );
    optionRows.push(optionRow);
    container.appendChild(optionRow.item);
  });

  return container;
}

// Swatches plus the browser's own colour picker. `onPick` receives "#rrggbb".
function themeSection(doc, initial, onPick) {
  const section = doc.createElement("section");
  section.appendChild(el(doc, "p", "npu-s__label", "Színtéma"));
  const card = el(doc, "div", "npu-s__card npu-s__theme");
  const swatches = el(doc, "div", "npu-s__swatches");
  swatches.setAttribute("role", "group");
  swatches.setAttribute("aria-label", "Kiemelőszín");
  const buttons = [];

  theme.PRESETS.forEach(preset => {
    const button = el(doc, "button", "npu-s__swatch");
    button.type = "button";
    button.style.setProperty("--npu-c", preset.color);
    button.title = preset.name;
    button.setAttribute("aria-label", preset.name);
    button.dataset.color = preset.color;
    button.addEventListener("click", () => select(preset.color));
    buttons.push(button);
    swatches.appendChild(button);
  });

  const custom = el(doc, "label", "npu-s__swatch npu-s__custom");
  custom.title = "Egyéni szín";
  const picker = doc.createElement("input");
  picker.type = "color";
  picker.setAttribute("aria-label", "Egyéni szín");
  picker.addEventListener("input", () => select(picker.value));
  custom.appendChild(picker);
  swatches.appendChild(custom);

  const foot = el(doc, "div", "npu-s__theme-foot");
  const hint = el(doc, "p", "npu-s__hint", "A fejléc és a lábléc a választott szín sötét árnyalatát kapja.");
  const reset = el(doc, "button", "npu-s__link", "Eredeti Neptun-színek");
  reset.type = "button";
  reset.addEventListener("click", () => select(theme.NEPTUN_PRIMARY));
  foot.appendChild(hint);
  foot.appendChild(reset);

  card.appendChild(swatches);
  card.appendChild(foot);
  section.appendChild(card);

  function paintState(colour) {
    const isPreset = theme.PRESETS.some(preset => preset.color === colour);
    buttons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.color === colour)));
    custom.setAttribute("aria-pressed", String(!isPreset));
    custom.style.setProperty("--npu-c", colour);
    custom.style.background = isPreset ? "" : colour;
    picker.value = colour;
    reset.disabled = colour === theme.NEPTUN_PRIMARY;
  }

  function select(colour) {
    paintState(colour);
    onPick(colour);
  }

  paintState(initial);
  return section;
}

// A collapsible group: a heading button over a card of rows. Open/closed is a
// per-browser convenience, remembered in localStorage when it is available.
function groupSection(doc, group, buildRows) {
  const section = doc.createElement("section");
  const bodyId = `npu.group.${group.id || "default"}.expanded`;
  let expanded = true;
  try {
    expanded = localStorage.getItem(bodyId) !== "false";
  } catch (e) {
    // localStorage unavailable or blocked; default to expanded.
  }

  const head = el(doc, "button", "npu-s__group-head");
  head.type = "button";
  head.setAttribute("aria-controls", bodyId);
  head.appendChild(el(doc, "span", "npu-s__label", group.name));
  const chevron = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevron.setAttribute("class", "npu-s__chevron");
  chevron.setAttribute("viewBox", "0 0 16 16");
  chevron.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3.5 6l4.5 4.5L12.5 6");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  chevron.appendChild(path);
  head.appendChild(chevron);

  const body = el(doc, "div", "npu-s__group-body");
  body.id = bodyId;
  const card = el(doc, "div", "npu-s__card");
  buildRows(card);
  body.appendChild(card);

  function paint() {
    head.setAttribute("aria-expanded", String(expanded));
    body.toggleAttribute("data-collapsed", !expanded);
    // Collapsed rows must not stay reachable by Tab.
    card.inert = !expanded;
  }
  head.addEventListener("click", () => {
    expanded = !expanded;
    paint();
    try {
      localStorage.setItem(bodyId, String(expanded));
    } catch (e) {
      // localStorage unavailable or blocked; silently ignore.
    }
  });
  paint();

  section.appendChild(head);
  section.appendChild(body);
  return section;
}

function alert(doc, text) {
  return el(doc, "p", "npu-s__alert", text);
}

async function open() {
  // Unlike startup, the panel can wait for the durable GM value. This also warms
  // the synchronous cache used by managers that expose only the Promise API.
  const flags = await settings.loadFlags();
  const pending = Object.assign({}, flags);
  const canPersist = settings.canPersist();
  const savedColour = settings.themeColor(flags);
  let saving = false;
  let dialog = null;
  let saveError = null;
  let warningHost = null;

  // Some modules only listen to a request another one issues, so switching that one
  // off takes the listener's data with it - silently. The panel says so while the
  // user is still looking at the switch, rather than letting them find out later by
  // the feature having quietly gone missing.
  function repaintWarnings() {
    if (!warningHost) {
      return;
    }
    warningHost.textContent = "";
    settings.brokenDependencies(registry, pending).forEach(broken => {
      warningHost.appendChild(
        alert(warningHost.ownerDocument, `${broken.name}: hiányozni fog ${broken.to} szükséges adat.`)
      );
    });
    warningHost.hidden = warningHost.childElementCount === 0;
  }

  // Only a flipped switch needs the reload; the colour is already on screen. Saving
  // used to reload the page even for a colour, or with nothing changed at all, and
  // throw away whatever the user had open in Neptun.
  function reloadNeeded() {
    return settings.needsReload(flags, pending, registry);
  }

  function colourChanged() {
    return settings.themeColor(pending) !== savedColour;
  }

  function saveLabel() {
    if (!canPersist) {
      return "Újratöltés";
    }
    return reloadNeeded() ? "Mentés és újratöltés" : "Mentés";
  }

  function repaintSaveLabel() {
    const saveButton = dialog && dialog.buttons[1];
    if (saveButton) {
      utils.setButtonLabel(saveButton, saveLabel());
    }
  }

  dialog = modal.open({
    title: "Beállítások",
    onClose() {
      // Mégse, Escape, the X or the backdrop: the live preview goes back.
      if (!saving) {
        theme.apply(savedColour);
      }
    },
    build(content) {
      const doc = content.ownerDocument;
      injectCss(doc);
      const root = el(doc, "div", "npu-s");

      if (!canPersist) {
        root.appendChild(
          alert(
            doc,
            "Ez a kezelő nem ad írható tárhelyet az NPU-nak, ezért a kapcsolók nem menthetők. " +
              "Ellenőrizd a userscript engedélyeit."
          )
        );
      }
      saveError = alert(doc, "A mentés nem sikerült. A módosítások nem vesztek el; próbáld újra.");
      saveError.hidden = true;
      root.appendChild(saveError);

      root.appendChild(
        themeSection(doc, savedColour || theme.NEPTUN_PRIMARY, colour => {
          if (colour === theme.NEPTUN_PRIMARY) {
            delete pending[settings.THEME_COLOR_KEY];
          } else {
            pending[settings.THEME_COLOR_KEY] = colour;
          }
          theme.apply(colour);
          repaintSaveLabel();
        })
      );

      warningHost = doc.createElement("div");
      warningHost.style.cssText = "display:flex;flex-direction:column;gap:8px;";
      root.appendChild(warningHost);
      repaintWarnings();

      groupModules(registry).forEach(group => {
        root.appendChild(
          groupSection(doc, group, card => {
            group.modules.forEach(module => {
              card.appendChild(
                moduleRows(doc, module, flags, canPersist, (id, on) => {
                  pending[id] = on;
                  repaintWarnings();
                  repaintSaveLabel();
                })
              );
            });
          })
        );
      });

      root.appendChild(
        el(doc, "p", "npu-s__hint", "A funkciók ki- és bekapcsolása az oldal újratöltése után lép életbe.")
      );
      content.appendChild(root);
    },
    actions: [
      { label: "Mégse" },
      {
        label: saveLabel(),
        primary: true,
        onClick() {
          if (!canPersist) {
            location.reload();
            return false;
          }
          const reload = reloadNeeded();
          if (!reload && !colourChanged()) {
            // Nothing to save: just close.
            return true;
          }

          const saveButton = dialog && dialog.buttons[1];
          if (saveButton) {
            saveButton.disabled = true;
            saveButton.setAttribute("aria-busy", "true");
          }
          saving = true;
          settings.writeFlags(settings.pruneFlags(pending, registry)).then(saved => {
            if (saved) {
              if (reload) {
                location.reload();
              } else if (dialog) {
                // `saving` stays set, so onClose keeps the new colour on screen.
                dialog.close();
              }
              return;
            }
            saving = false;
            if (saveButton) {
              saveButton.disabled = false;
              saveButton.removeAttribute("aria-busy");
            }
            if (saveError) {
              saveError.hidden = false;
            }
          });
          // Keep the dialog visible until the durable extension write finishes, so
          // navigation cannot cancel an in-flight save.
          return false;
        },
      },
    ],
  });
}

// The footer link is measured on one institution's layout, and it is the only way
// into this panel - so at exactly the institutions where a module misbehaves, the
// switches could be unreachable. The manager's own menu does not depend on the
// page's DOM at all, so it is registered as well.
function registerMenuCommand() {
  if (typeof GM_registerMenuCommand !== "function") {
    return false;
  }
  try {
    GM_registerMenuCommand("Neptun PowerUp! beállítások", open);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { setRegistry, open, registerMenuCommand, groupModules, GROUPS };
