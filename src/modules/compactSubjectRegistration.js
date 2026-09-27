// An opt-in density pass for the desktop subject-registration page. It keeps the
// native typography and controls intact; only content width and list rhythm change.
const router = require("../router");
const utils = require("../utils");

const ROUTE = "/hallgato_ng/subjects/registration";
const ROOT_ATTRIBUTE = "data-npu-compact-subject-registration";

const meta = {
  id: "compactSubjectRegistration",
  group: "registration",
  name: "Kompakt tárgyfelvételi nézet",
  where: "Tárgyak › Tárgyfelvétel, nagy asztali kijelzőn",
  description: "Szélesebb és sűrűbb tárgy- és kurzuslistát használ nagy asztali kijelzőn.",
  defaultEnabled: false,
};

function shouldActivate() {
  return true;
}

function setRouteState(path, root) {
  if (!root || typeof root.toggleAttribute !== "function") {
    return;
  }
  root.toggleAttribute(ROOT_ATTRIBUTE, path === ROUTE);
}

function initialize() {
  utils.injectCss(`
    @media (min-width: 1200px) {
      html[${ROOT_ATTRIBUTE}] .neptun-wrapper--max-width-xxl {
        max-width: 1600px !important;
      }

      html[${ROOT_ATTRIBUTE}] .neptun-wrapper-padding {
        padding-left: 16px !important;
        padding-right: 16px !important;
      }

      html[${ROOT_ATTRIBUTE}] neptun-subject-list-item .subject-list-item__expansion-panel {
        margin-bottom: 8px !important;
      }

      html[${ROOT_ATTRIBUTE}] neptun-subject-list-item .mat-expansion-panel-header {
        padding-top: 8px !important;
        padding-bottom: 8px !important;
      }

      html[${ROOT_ATTRIBUTE}] neptun-subject-list-item .mat-expansion-panel-body {
        padding-left: 16px !important;
        padding-right: 16px !important;
        padding-top: 12px !important;
        padding-bottom: 12px !important;
      }

      html[${ROOT_ATTRIBUTE}] neptun-course-list-item .course-list-item-container {
        padding-top: 6px !important;
        padding-bottom: 6px !important;
      }

      html[${ROOT_ATTRIBUTE}] neptun-course-list-item [data-npu-conflict] {
        margin-top: 4px;
        margin-bottom: 6px;
      }
    }
  `);

  const root = document.documentElement;
  router.onChange(path => setRouteState(path, root));
  setRouteState(router.getPath(), root);
}

module.exports = { meta, shouldActivate, initialize, setRouteState, ROOT_ATTRIBUTE };
