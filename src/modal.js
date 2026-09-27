// A dialog that is Neptun's dialog, not an imitation of one.
//
// Neptun's dialog styling is split between global classes and Angular-scoped layout
// rules. Reproduce the global class structure in plain DOM, then keep the few measured
// surface/footer/layout values below for the scoped rules our node cannot inherit.
//
// Two things do not come for free:
//   1. The CDK's structural CSS is absent until Angular opens its own first overlay,
//      so position, inset and centring are ours. Layout only, never appearance.
//   2. Buttons are `_nghost-*` scoped and that hash changes every build, so they are
//      cloned from a live one - the clone carries the hash along.
const utils = require("./utils");
const tokens = require("./neptunTokens");

const OVERLAY_CLASS = "npu-overlay";
const DIALOG_CLASS = "npu-dialog";

// Neptun's dialogs are generously inset on a responsive scale (105/60/20px), carried
// by their own class names. Nothing here re-declares horizontal padding - that would
// break the scale at exactly the sizes it exists to handle. The inset also dictates
// the width: 105px a side eats 210px.
const PANE_MAX_WIDTH = 1040;

// Cloning drags the source's accent along, so the clone's must be set explicitly.
const ACCENT_CLASSES = ["primary", "secondary", "tertiary", "error", "warning", "pink", "lightgrey"];

// Always the *primary* button, never "whatever is not primary": that matched the
// header's Menü button, which is `tertiary`, and turned every secondary dialog
// button dark navy. The same Menü button is also the only `.flat` on the dashboard,
// and it is shaped to join the search box (square right corners), so it is never a
// reference at all.
function referenceButton() {
  return (
    document.querySelector("button.flat.primary:not(.header__main-menu):not([data-npu-feature])") ||
    document.querySelector("button.flat:not(.header__main-menu):not([data-npu-feature])")
  );
}

// For a page with no `.flat` button to clone. Built from `:root` tokens rather than
// literal hex, so an institution running its own theme still gets its colours.
function fallbackButton(primary) {
  const button = document.createElement("button");
  const skin = primary
    ? `background:${tokens.primary};color:#fff;`
    : `background:${tokens.subtleSurface};color:${tokens.text};`;
  // Sized like Neptun's own dialog buttons (measured 44px tall, 8px corners).
  button.style.cssText =
    "font:inherit;font-size:16px;font-weight:600;border:0;border-radius:8px;" +
    `height:44px;min-width:120px;padding:0 24px;cursor:pointer;${skin}`;
  return button;
}

// Cloned from the page where possible, so it is the real thing, hash and all.
function actionButton(label, primary) {
  const reference = referenceButton();
  const button = reference ? utils.cloneButton(reference) : fallbackButton(primary);
  if (reference) {
    // `lightgrey` is Neptun's own secondary, not a colour of ours.
    ACCENT_CLASSES.forEach(accent => button.classList.remove(accent));
    button.classList.add(primary ? "primary" : "lightgrey");
  }
  // The login submit is a full-width block, which in a footer row would stretch
  // across the dialog. Sizing only; appearance stays the clone's.
  button.style.width = "auto";
  button.style.flex = "0 0 auto";
  utils.setButtonLabel(button, label);
  return button;
}

let cssInjected = false;

// Layout and measured fallback skin. The class names still carry typography and
// button styling; the surface/footer values mirror the live native dialog because
// those particular rules are scoped to Angular's component tree.
function injectCss() {
  if (cssInjected) {
    return;
  }
  cssInjected = true;
  utils.injectCss(`
.${OVERLAY_CLASS} { position: fixed; inset: 0; }
.${OVERLAY_CLASS}[hidden] { display: none; }
.${OVERLAY_CLASS} .cdk-overlay-backdrop { position: absolute; inset: 0; }
/* The wrapper fills the overlay and sits ON TOP of the backdrop (it is appended
   after it), so without this it would swallow every click meant for the backdrop and
   click-outside-to-close would silently not work. The real CDK solves it exactly this
   way; we have to say it ourselves because its structural CSS is absent until Angular
   opens a dialog of its own, which is what made this work only *sometimes*. */
.${OVERLAY_CLASS} .cdk-global-overlay-wrapper {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  pointer-events: none;
}
.${OVERLAY_CLASS} .cdk-overlay-pane {
  display: flex; width: 100%; max-width: min(${PANE_MAX_WIDTH}px, 94vw); pointer-events: auto;
}
.${OVERLAY_CLASS} .mat-mdc-dialog-container { width: 100%; max-height: calc(100vh - 40px); }
.${OVERLAY_CLASS} .mat-mdc-dialog-container,
.${OVERLAY_CLASS} .mat-mdc-dialog-surface {
  background: ${tokens.surface};
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,.08);
  overflow: hidden;
}
.${OVERLAY_CLASS} .mat-mdc-dialog-surface { width: 100%; }
/* The native classes provide the surface, title, content and action styling. These
   are supplemented only where the component's scoped layout rules cannot reach a
   userscript-created node. */
/* !important: once Neptun has opened a small dialog of its own, its global
   basic-dialog-container rules narrow ours into a card inside a wider white surface. */
.${DIALOG_CLASS} {
  position: relative; display: flex; flex-direction: column;
  width: 100% !important; max-width: none !important; margin: 0 !important;
  box-sizing: border-box; max-height: calc(100vh - 40px);
}
.${OVERLAY_CLASS} .cdk-overlay-pane.npu-dialog-small { max-width: min(560px, 94vw); }
.${OVERLAY_CLASS} .npu-dialog-small .basic-dialog-title,
.${OVERLAY_CLASS} .npu-dialog-small .basic-dialog-content,
.${OVERLAY_CLASS} .npu-dialog-small .mat-mdc-dialog-actions { padding-left: 40px; padding-right: 40px; }
@media (max-width: 480px) {
  .${OVERLAY_CLASS} .npu-dialog-small .basic-dialog-title,
  .${OVERLAY_CLASS} .npu-dialog-small .basic-dialog-content,
  .${OVERLAY_CLASS} .npu-dialog-small .mat-mdc-dialog-actions { padding-left: 20px; padding-right: 20px; }
}
.${DIALOG_CLASS} .basic-dialog-wrapper {
  position: relative; display: flex; flex: 1 1 auto; flex-direction: column;
  min-height: 0; overflow: hidden;
}
.${DIALOG_CLASS} .basic-dialog-title {
  flex: 0 0 auto; margin: 0 0 20px; padding: 0 105px;
}
.${DIALOG_CLASS} .mat-mdc-dialog-content {
  flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0;
  background: ${tokens.surface};
}
.${DIALOG_CLASS} .basic-dialog-content { padding: 0 105px 48px; }
.${DIALOG_CLASS} .mat-mdc-dialog-actions {
  display: flex; flex: 0 0 auto; align-items: center; box-sizing: border-box;
  min-height: 77px; padding: 16px 105px; background: #213055;
  border-radius: 0 0 8px 8px; color: #fff;
}
.${DIALOG_CLASS} .basic-dialog-actions,
.${DIALOG_CLASS} .neptun-basic-dialog-layout-actions {
  display: flex; flex: 1 1 0; align-items: center; gap: 12px; min-width: 0;
}
.${DIALOG_CLASS} .close {
  position: absolute; top: 24px; right: 24px; z-index: 1;
}
.${DIALOG_CLASS} .dialog-close {
  display: flex; width: 48px !important; height: 48px !important; align-items: center; justify-content: center;
  margin: -12px; padding: 12px; border: 0; background: transparent;
  color: ${tokens.text}; cursor: pointer;
}
.${DIALOG_CLASS} .dialog-close .icon-circle-x { font-size: 24px; line-height: 24px; }
.${DIALOG_CLASS} .actions { gap: 12px; flex-wrap: wrap; }
/* Neptun zeroes dialog-title padding with a four-class selector; without this the
   heading sits flush against the top edge of the dialog. */
.${OVERLAY_CLASS} .mat-mdc-dialog-container .${DIALOG_CLASS} .basic-dialog-title.mdc-dialog__title {
  padding-top: 40px;
}
.${DIALOG_CLASS} button:focus-visible,
.${DIALOG_CLASS} input:focus-visible,
.${DIALOG_CLASS} select:focus-visible {
  outline: 2px solid ${tokens.focus};
  outline-offset: 2px;
}
/* Neptun's inputs are OUTLINED, not filled. The border colour is literal because no
   :root token carries it - the outlined-card/text-field tokens hold different
   values, so using one would change the colour rather than preserve it. */
.${DIALOG_CLASS} input:not([type="checkbox"]),
.${DIALOG_CLASS} select {
  font: inherit;
  font-size: 16px;
  color: ${tokens.text};
  background: ${tokens.surface};
  border: 1px solid rgba(154, 158, 188, 0.8);
  border-radius: 8px;
  padding: 0 16px;
  height: 48px;
  box-sizing: border-box;
}
.${DIALOG_CLASS} input:not([type="checkbox"]):focus,
.${DIALOG_CLASS} select:focus {
  outline: none;
  border-color: ${tokens.focus};
}
.${DIALOG_CLASS} label {
  color: ${tokens.text};
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.${DIALOG_CLASS} .dialog-close { cursor: pointer; }
@media (max-width: 800px) {
  .${DIALOG_CLASS} .basic-dialog-title,
  .${DIALOG_CLASS} .basic-dialog-content,
  .${DIALOG_CLASS} .mat-mdc-dialog-actions { padding-left: 60px; padding-right: 60px; }
}
@media (max-width: 480px) {
  .${DIALOG_CLASS} .basic-dialog-title,
  .${DIALOG_CLASS} .basic-dialog-content,
  .${DIALOG_CLASS} .mat-mdc-dialog-actions { padding-left: 20px; padding-right: 20px; }
  .${DIALOG_CLASS} .close { right: 20px; }
}
`);
}

function closeIcon() {
  const body = document.createElement("span");
  body.className = "neptun-button__body";
  const label = document.createElement("span");
  label.className = "neptun-button__label";
  const icon = document.createElement("i");
  icon.className = "icon-circle-x";
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", "Bezárás");
  label.appendChild(icon);
  body.appendChild(label);
  return body;
}

let openDialog = null;

// `build(content)` fills the scrollable body; `actions` become footer buttons,
// rightmost last. Closing is deliberately easy - Escape, the X, the backdrop - since
// a user trapped in a popup our script drew would rightly be alarmed.
//
// Only one NPU dialog exists at a time; opening a second closes the first.
function open(options) {
  injectCss();
  if (openDialog) {
    openDialog.close();
  }

  const previousFocus = document.activeElement;
  const overlay = document.createElement("div");
  // The native overlay class keeps this in the same stacking context as Neptun's
  // dialogs.
  overlay.className = `${OVERLAY_CLASS} cdk-overlay-container`;

  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop cdk-overlay-backdrop cdk-overlay-backdrop-showing";

  const wrapper = document.createElement("div");
  wrapper.className = "cdk-global-overlay-wrapper";
  const pane = document.createElement("div");
  // `small`: a short confirmation, not a 1040px workspace.
  pane.className = `cdk-overlay-pane${options.small ? " npu-dialog-small" : ""}`;
  const container = document.createElement("div");
  container.className = `mat-mdc-dialog-container mdc-dialog cdk-dialog-container${
    options.actions && options.actions.length ? " mat-mdc-dialog-container-with-actions" : ""
  }`;
  const surface = document.createElement("div");
  surface.className = "mat-mdc-dialog-surface mdc-dialog__surface";

  const dialog = document.createElement("div");
  dialog.className = `${DIALOG_CLASS} basic-dialog-container mat-typography`;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.tabIndex = -1;

  const titleId = `npu-dialog-title-${Date.now()}`;
  const title = document.createElement("div");
  title.className = "basic-dialog-title mat-mdc-dialog-title mdc-dialog__title";
  title.id = titleId;
  dialog.setAttribute("aria-labelledby", titleId);

  const titleContainer = document.createElement("div");
  titleContainer.className = "dialog-container";
  const titleContent = document.createElement("div");
  titleContent.className = "dialog__title";
  const heading = document.createElement("h2");
  heading.className = "mat-h2 break-text-with-hyphen";
  heading.textContent = options.title || "";
  titleContent.appendChild(heading);
  titleContainer.appendChild(titleContent);
  title.appendChild(titleContainer);

  const content = document.createElement("div");
  content.className = "mat-mdc-dialog-content mdc-dialog__content mat-dialog-content";
  const contentBody = document.createElement("div");
  // Carries the responsive horizontal inset and bottom padding - Neptun's class.
  contentBody.className = "dialog-container basic-dialog-content";
  content.appendChild(contentBody);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "close__container icon lightgrey has-offset dialog-close";
  closeButton.setAttribute("aria-label", "Bezárás");
  closeButton.appendChild(closeIcon());

  const closeHost = document.createElement("div");
  closeHost.className = "close";
  closeHost.appendChild(closeButton);

  let closed = false;
  function close() {
    if (closed) {
      return;
    }
    closed = true;
    openDialog = null;
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    if (previousFocus && typeof previousFocus.focus === "function") {
      previousFocus.focus();
    }
    if (typeof options.onClose === "function") {
      options.onClose();
    }
  }

  function focusable() {
    return Array.from(
      dialog.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(element => element.getAttribute("aria-hidden") !== "true");
  }

  // Keep keyboard focus inside the modal while it is open. The native Neptun dialog
  // does this through CDK; this small wrapper must provide the same basic guarantee.
  function onKeydown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const controls = focusable();
    if (controls.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", onKeydown, true);

  const wrapperContent = document.createElement("div");
  wrapperContent.className = "basic-dialog-wrapper";
  wrapperContent.appendChild(closeHost);
  wrapperContent.appendChild(title);
  wrapperContent.appendChild(content);
  dialog.appendChild(wrapperContent);

  const buttons = [];
  if (options.actions && options.actions.length) {
    const actions = document.createElement("div");
    // Brings the matching footer inset.
    actions.className = "mat-mdc-dialog-actions mdc-dialog__actions actions";
    const justifyContent = options.spread ? "space-between" : "flex-end";
    actions.style.justifyContent = justifyContent;
    const outerActions = document.createElement("div");
    outerActions.className = "neptun-basic-dialog-layout-actions dialog-container basic-dialog-actions";
    const innerActions = document.createElement("div");
    innerActions.className = "neptun-basic-dialog-layout-actions";
    innerActions.style.justifyContent = justifyContent;
    outerActions.appendChild(innerActions);
    actions.appendChild(outerActions);
    options.actions.forEach(action => {
      const button = actionButton(action.label, action.primary);
      button.addEventListener("click", () => {
        // Returning false keeps the dialog open - what a Start button needs, since
        // the run it kicks off is what the dialog shows.
        const keepOpen = action.onClick && action.onClick() === false;
        if (!keepOpen) {
          close();
        }
      });
      innerActions.appendChild(button);
      buttons.push(button);
    });
    dialog.appendChild(actions);
  }

  surface.appendChild(dialog);
  container.appendChild(surface);
  pane.appendChild(container);
  wrapper.appendChild(pane);
  overlay.appendChild(backdrop);
  overlay.appendChild(wrapper);
  document.body.appendChild(overlay);

  if (typeof options.build === "function") {
    options.build(contentBody);
  }
  dialog.focus();

  // Handed back so a caller can relabel a footer action while the dialog is open -
  // the Rajtoló's one button is both Start and Stop.
  const handle = { close, content: contentBody, dialog, buttons };
  openDialog = handle;
  return handle;
}

module.exports = {
  open,
  actionButton,
  OVERLAY_CLASS,
  DIALOG_CLASS,
};
