/**
 * Doppio minimale di jQuery per testare `www/js/app.js` senza DOM reale.
 * Implementa solo ciò che l'app usa: selezione per id, `val`, `text`, `html`,
 * `append`, `find`, `on`/`trigger`, classi, `hide`, `attr`, `listview`.
 */

/** Crea un elemento finto. */
export function createElement(tagName = 'div') {
  const element = {
    tagName,
    textContent: '',
    htmlContent: '',
    value: '',
    attrs: {},
    classes: new Set(),
    hidden: false,
    children: [],
    handlers: new Map(),
    listviewRefreshes: 0,

    val(next) {
      if (next === undefined) return element.value;
      element.value = next;
      return element;
    },
    text(next) {
      if (next === undefined) return element.textContent;
      element.textContent = String(next);
      return element;
    },
    html(next) {
      if (next === undefined) return element.htmlContent;
      element.htmlContent = String(next);
      if (String(next) === '') element.children = [];
      return element;
    },
    append(child) {
      element.children.push(child);
      return element;
    },
    find(selector) {
      const wanted = selector.replace(/[^a-z0-9]/gi, '').toLowerCase();
      let found = element.children.find((child) => child.tagName.toLowerCase() === wanted);
      if (!found) {
        found = createElement(wanted || 'div');
        element.children.push(found);
      }
      return found;
    },
    on(event, handler) {
      if (!element.handlers.has(event)) element.handlers.set(event, []);
      element.handlers.get(event).push(handler);
      return element;
    },
    off(event) {
      element.handlers.delete(event);
      return element;
    },
    trigger(event, ...args) {
      for (const handler of element.handlers.get(event) || []) handler(...args);
      return element;
    },
    /** Esegue gli handler e attende le eventuali Promise restituite. */
    triggerAsync(event, ...args) {
      const results = [];
      for (const handler of element.handlers.get(event) || []) results.push(handler(...args));
      return Promise.all(results).then(() => element);
    },
    hide() {
      element.hidden = true;
      return element;
    },
    show() {
      element.hidden = false;
      return element;
    },
    addClass(name) {
      element.classes.add(name);
      return element;
    },
    removeClass(name) {
      element.classes.delete(name);
      return element;
    },
    hasClass(name) {
      return element.classes.has(name);
    },
    attr(name, value) {
      if (value === undefined) return element.attrs[name];
      element.attrs[name] = value;
      return element;
    },
    listview() {
      element.listviewRefreshes += 1;
      return element;
    },
  };
  return element;
}

/**
 * Crea la funzione `$` finta.
 * @param {{ids?:string[], onChangePage?:Function}} [options]
 */
export function createJQueryStub({ ids = [], onChangePage } = {}) {
  const elements = new Map();
  const elementFor = (selector) => {
    const id = selector.startsWith('#') ? selector.slice(1) : selector;
    if (!elements.has(id)) elements.set(id, createElement('div'));
    return elements.get(id);
  };
  for (const id of ids) elementFor(id);

  const $ = (target) => {
    if (typeof target === 'string') {
      if (target.startsWith('#')) return elementFor(target);
      if (target.trimStart().startsWith('<')) {
        const element = createElement(/<li/i.test(target) ? 'li' : 'div');
        if (/<a[\s>]/i.test(target)) element.children.push(createElement('a'));
        return element;
      }
      return createElement('div');
    }
    return target;
  };

  $.mobile = {
    changePage(page) {
      $.mobile.changePage.calls += 1;
      $.mobile.changePage.lastPage = page;
      if (typeof onChangePage === 'function') onChangePage(page);
    },
  };
  $.mobile.changePage.calls = 0;
  $.elements = elements;
  return $;
}

export default createJQueryStub;
