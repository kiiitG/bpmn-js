export function elementToString(e) {
  if (!e) {
    return '<null>';
  }

  return '<' + e.$type + (e.id ? ' id="' + e.id : '') + '" />';
}

export function contextual(fn, ctx) {
  return function(e) {
    fn(e, ctx);
  };
}

export function is(element, type) {
  return element.$instanceOf(type);
}

export function findDisplayCandidate(definitions) {
  return find(definitions.rootElements, function(e) {
    return is(e, 'bpmn:Process') || is(e, 'bpmn:Collaboration');
  });
}