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