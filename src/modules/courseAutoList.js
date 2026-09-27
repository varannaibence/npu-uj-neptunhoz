// The subject-registration page starts empty: the user has to press "Tárgy keresése"
// before anything shows up. This presses it for them, once per arrival.
const router = require("../router");

const ROUTE = "/hallgato_ng/subjects/registration";
// Measured, stable: <button id="filter-table" ...>
const BUTTON_ID = "filter-table";
const RETRY_DELAY_MS = 250;
const MAX_ATTEMPTS = 20;

// Shown in the settings panel; `id` is also the key the switch is stored under.
const meta = {
  id: "courseAutoList",
  group: "registration",
  name: "Tárgylista automatikus betöltése",
  where: "Tárgyak › Tárgyfelvétel: az oldal megnyitásakor",
  description: "Megnyomja helyetted a „Tárgy keresése” gombot a tárgyfelvételi oldalon.",
  defaultEnabled: false,
};

function shouldActivate() {
  return true;
}

// Disabled can live on the property or the attribute. Check both, so a just-rendered
// Angular button is not pressed while the form is pristine or a request is in flight.
function isButtonEnabled(button) {
  if (!button || button.disabled) {
    return false;
  }
  return !(typeof button.hasAttribute === "function" && button.hasAttribute("disabled"));
}

function findButton() {
  return typeof document === "undefined" ? null : document.getElementById(BUTTON_ID);
}

// One bounded, cancellable wait for the button. Dependencies are injected so the
// race and its cancellation are testable without a DOM or a real clock.
function createArrivalController(options = {}) {
  const getPath = options.getPath || (() => router.getPath());
  const getButton = options.getButton || findButton;
  const schedule = options.schedule || ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.cancel || (timer => clearTimeout(timer));
  const click = options.click || (button => button.click());
  const maxAttempts =
    Number.isInteger(options.maxAttempts) && options.maxAttempts > 0 ? options.maxAttempts : MAX_ATTEMPTS;
  const retryDelay =
    typeof options.retryDelay === "number" && options.retryDelay >= 0 ? options.retryDelay : RETRY_DELAY_MS;

  let generation = 0;
  let timer = null;

  function leave() {
    generation++;
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  }

  function arrive() {
    leave();
    const arrival = generation;
    let attempts = 0;

    function tryPress() {
      // The route can change before the next timer fires; without this guard a stale
      // attempt would act on a DOM that now belongs to a different page.
      if (arrival !== generation || getPath() !== ROUTE) {
        return;
      }

      attempts++;
      const button = getButton();
      if (isButtonEnabled(button)) {
        timer = null;
        click(button);
        return;
      }

      if (attempts >= maxAttempts) {
        timer = null;
        return;
      }
      timer = schedule(tryPress, retryDelay);
    }

    tryPress();
  }

  return { arrive, leave };
}

// Only the registration route starts a wait; any other arrival cancels a pending one.
function handleNavigation(path, onArrive, onLeave) {
  if (path === ROUTE) {
    onArrive();
  } else if (onLeave) {
    onLeave();
  }
}

function initialize() {
  const controller = createArrivalController();
  router.onChange(path => handleNavigation(path, controller.arrive, controller.leave));

  // A direct load on this route emits no route change, so check the starting path.
  handleNavigation(router.getPath(), controller.arrive, controller.leave);
}

module.exports = {
  meta,
  shouldActivate,
  initialize,
  handleNavigation,
  isButtonEnabled,
  createArrivalController,
};
