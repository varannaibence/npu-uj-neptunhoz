// NPU's icon, built as inline SVG so it needs no request and no innerHTML.
const SVG_NS = "http://www.w3.org/2000/svg";
// The app icon from docs/assets/npu-icon.svg: an italic N on a dark tile, its
// right stem an up arrow and its left stem a lightning bolt. The tile keeps it
// readable on Neptun's blue and white buttons alike.
const SHAPES = [
  ["rect", { width: 512, height: 512, rx: 112, fill: "#15181e" }],
  ["path", { d: "M147.3 100.6L218.3 100.6L342.3 413.2L278.4 413.2Z", fill: "#fff" }],
  [
    "path",
    { d: "M278.4 413.2L342.3 413.2L387.4 187.6L430.1 187.6L376.1 84.6L280.9 187.6L323.5 187.6Z", fill: "#4d8bff" },
  ],
  ["path", { d: "M147.3 100.6L216.6 100.6L202 217.8L235.7 217.8L81.9 427.4L128.1 294.2L89 294.2Z", fill: "#f5b82e" }],
];

function icon(doc, size) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 512 512");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "display:inline-block;flex:none;vertical-align:-3px;margin-right:6px";
  SHAPES.forEach(([tag, attributes]) => {
    const shape = doc.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([name, value]) => shape.setAttribute(name, value));
    svg.appendChild(shape);
  });
  return svg;
}

module.exports = { icon };
