// A fast drop-in for csv-reader 1.0.0: the same answers, less work.
//
// The text is read once, left to right, and run() returns
// {columns, rows, errors} exactly as the reference does. The speed comes
// from never building a field one character at a time: a plain field is
// sliced out whole, and the next comma, line feed and carriage return are
// chased with cached indexOf probes, so the sweep is native search instead
// of a JavaScript loop. The awkward paths (a quote that never closes, junk
// after a closing quote, a stray CR, doubled quotes, line breaks inside a
// quoted field) keep their own careful code, but they are rare, so they can
// afford to be slow.

const COMMA = 44;
const LF = 10;
const CR = 13;
const QUOTE = 34;

// How a field finished: at a comma, at a line break, at the end of text.
const END_COMMA = 0;
const END_BREAK = 1;
const END_TEXT = 2;

export function run(input) {
  const src = String(input.text);
  const headed = input.header === true;
  const n = src.length;

  let p = 0; // next unread offset
  let ln = 1; // line that offset sits on
  let head = null;
  let width = -1;
  const rowsOut = [];
  const errs = [];

  // Next comma / LF / CR at or after the last probe point; -1 means none
  // is left. Each is only re-probed once the cursor has passed it, so over
  // one case every probe sweeps each byte at most once.
  let nextComma = src.indexOf(',', 0);
  let nextLf = src.indexOf('\n', 0);
  let nextCr = src.indexOf('\r', 0);

  // The field the scanners just read, how it ended, and how many
  // characters this call kept (the junk rule counts those).
  let fVal = '';
  let fEnd = END_TEXT;
  let fKept = 0;

  // The record being read: the line it starts on, and the index it takes
  // in rows (null while it is the header).
  let recLine = 1;
  let recRow = null;

  const note = (code) => {
    errs.push({ code, line: recLine, row: recRow });
  };

  // Reads a plain field starting at p, or the tail after a closing quote
  // when seed already holds that field. Sets fVal, fEnd and fKept.
  const plain = (seed) => {
    let pieces = null;
    let kept = 0;
    let seg = p;
    let tail = '';
    let end = END_TEXT;
    let adv = n;
    for (;;) {
      if (nextComma !== -1 && nextComma < p) nextComma = src.indexOf(',', p);
      if (nextLf !== -1 && nextLf < p) nextLf = src.indexOf('\n', p);
      if (nextCr !== -1 && nextCr < p) nextCr = src.indexOf('\r', p);
      let e = -1;
      let kind = END_COMMA;
      if (nextComma !== -1) {
        e = nextComma;
        kind = END_COMMA;
      }
      if (nextLf !== -1 && (e === -1 || nextLf < e)) {
        e = nextLf;
        kind = END_BREAK;
      }
      if (nextCr !== -1 && (e === -1 || nextCr < e)) {
        e = nextCr;
        kind = 2;
      }
      if (e === -1) {
        tail = src.slice(seg);
        end = END_TEXT;
        adv = n;
        break;
      }
      if (kind === END_COMMA) {
        tail = src.slice(seg, e);
        end = END_COMMA;
        adv = e + 1;
        break;
      }
      if (kind === END_BREAK) {
        tail = src.slice(seg, e);
        end = END_BREAK;
        adv = e + 1;
        ln += 1;
        break;
      }
      // A CR: CRLF ends the field, a lone one is dropped with an error.
      if (src.charCodeAt(e + 1) === LF) {
        tail = src.slice(seg, e);
        end = END_BREAK;
        adv = e + 2;
        ln += 1;
        break;
      }
      note('stray_cr');
      const bit = src.slice(seg, e);
      kept += bit.length;
      if (pieces === null) pieces = [];
      pieces.push(bit);
      p = e + 1;
      seg = p;
    }
    kept += tail.length;
    fVal =
      pieces === null ? (seed === '' ? tail : seed + tail) : seed + pieces.join('') + tail;
    fEnd = end;
    fKept = kept;
    p = adv;
  };

  // What follows a closing quote found at `after`: a comma, a line break,
  // the end of the text, or junk read as a plain tail.
  const afterQuote = (val, after) => {
    p = after;
    if (p >= n) {
      fVal = val;
      fEnd = END_TEXT;
      fKept = 0;
      return;
    }
    const c = src.charCodeAt(p);
    if (c === COMMA) {
      p += 1;
      fVal = val;
      fEnd = END_COMMA;
      fKept = 0;
      return;
    }
    if (c === LF) {
      p += 1;
      ln += 1;
      fVal = val;
      fEnd = END_BREAK;
      fKept = 0;
      return;
    }
    if (c === CR && src.charCodeAt(p + 1) === LF) {
      p += 2;
      ln += 1;
      fVal = val;
      fEnd = END_BREAK;
      fKept = 0;
      return;
    }
    plain(val);
    if (fKept > 0) note('quote_junk');
  };

  // A quote that never closes: it is a literal character, and the text
  // after it is read again as a plain field.
  const unterminated = (open, openLine) => {
    p = open + 1;
    ln = openLine;
    note('unterminated_quote');
    plain('"');
  };

  // The quoted field at p, when it holds doubled quotes or line breaks
  // inside: walked one character at a time, "" becoming one quote and
  // every CR, CRLF or LF inside becoming one LF.
  const quotedSlow = (open, openLine) => {
    const parts = [];
    let seg = open + 1;
    let i = open + 1;
    let closed = false;
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === QUOTE) {
        if (src.charCodeAt(i + 1) === QUOTE) {
          parts.push(src.slice(seg, i));
          parts.push('"');
          i += 2;
          seg = i;
          continue;
        }
        parts.push(src.slice(seg, i));
        i += 1;
        closed = true;
        break;
      }
      if (c === CR) {
        parts.push(src.slice(seg, i));
        parts.push('\n');
        ln += 1;
        i += src.charCodeAt(i + 1) === LF ? 2 : 1;
        seg = i;
        continue;
      }
      if (c === LF) {
        parts.push(src.slice(seg, i));
        parts.push('\n');
        ln += 1;
        i += 1;
        seg = i;
        continue;
      }
      i += 1;
    }
    if (!closed) {
      unterminated(open, openLine);
      return;
    }
    afterQuote(parts.join(''), i);
  };

  // A field that opens with a quote at p. The common shape, a quoted run
  // with no doubled quote and no line break inside, is one slice.
  const quoted = () => {
    const open = p;
    const openLine = ln;
    const q = src.indexOf('"', p + 1);
    if (q === -1) {
      unterminated(open, openLine);
      return;
    }
    if (src.charCodeAt(q + 1) === QUOTE) {
      quotedSlow(open, openLine);
      return;
    }
    if (nextLf !== -1 && nextLf < p) nextLf = src.indexOf('\n', p);
    if (nextCr !== -1 && nextCr < p) nextCr = src.indexOf('\r', p);
    if ((nextLf !== -1 && nextLf < q) || (nextCr !== -1 && nextCr < q)) {
      quotedSlow(open, openLine);
      return;
    }
    afterQuote(src.slice(p + 1, q), q + 1);
  };

  if (src.charCodeAt(0) === 0xfeff) p = 1;

  for (;;) {
    // Lines left with no characters are no records.
    while (p < n) {
      const c = src.charCodeAt(p);
      if (c === LF) {
        p += 1;
        ln += 1;
      } else if (c === CR && src.charCodeAt(p + 1) === LF) {
        p += 2;
        ln += 1;
      } else {
        break;
      }
    }
    if (p >= n) break;

    recLine = ln;
    recRow = headed && head === null ? null : rowsOut.length;
    const fields = [];
    let wasQuoted = false;
    let end;
    do {
      if (src.charCodeAt(p) === QUOTE) {
        quoted();
        wasQuoted = true;
      } else {
        plain('');
        wasQuoted = false;
      }
      fields.push(fVal);
      end = fEnd;
    } while (end === END_COMMA);

    // One empty plain field is a line of stray CRs only: no record, but
    // its stray_cr errors stay.
    if (fields.length === 1 && fields[0] === '' && !wasQuoted) continue;

    if (width < 0) width = fields.length;
    if (headed && head === null) {
      head = fields;
      continue;
    }
    if (fields.length < width) {
      errs.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errs.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
    }
    rowsOut.push(fields);
  }

  return { columns: headed ? (head ?? []) : null, rows: rowsOut, errors: errs };
}
