// Tiny DOM helper. Text is always inserted with text nodes, never innerHTML,
// so a player name or chat message can never inject HTML (XSS protection).

/**
 * h("button", { class: "btn", onClick: fn, disabled: true }, "Texte", childElement)
 * - props starting with "on" become event listeners
 * - class / text / dataset / aria-* / other attributes are supported
 * - null, undefined and false children are skipped
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in el && typeof value !== "string") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }

  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replaces all children of `el`. */
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}
