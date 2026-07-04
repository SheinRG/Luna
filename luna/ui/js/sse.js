// luna/ui/js/sse.js
//
// Generic Server-Sent-Events frame parser for a `fetch()` POST response body.
// We cannot use `EventSource` (spec §6 note: "EventSource can't POST"), so we
// read `response.body` as a stream and parse the SSE wire format ourselves.
//
// SSE wire format (https://html.spec.whatwg.org/multipage/server-sent-events.html):
//   - Events are separated by a blank line (\n\n, or \r\n\r\n, or bare \r\r).
//   - Each event is made of fields "field: value" (or "field:value", the single
//     leading space after ':' is stripped if present).
//   - `data:` may repeat across multiple lines; values are joined with "\n".
//   - `event:` sets the event name; defaults to "message" if absent.
//   - Lines starting with ':' are comments and ignored.
//   - `id:` / `retry:` are part of the spec but unused by our API contract —
//     tolerated (parsed, not acted on) so a future addition doesn't break us.

/**
 * @param {Response} response - a fetch() Response whose body is a stream of
 *   SSE-formatted bytes.
 * @param {(eventName: string, data: any) => void} onEvent - called once per
 *   parsed frame with the event name (e.g. "token") and the JSON-parsed data.
 *   If a frame's data isn't valid JSON, onEvent is called with
 *   eventName "__parse_error__" and { raw, error } instead of throwing.
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<void>} resolves when the stream ends (naturally, or via abort).
 */
export async function readSSEStream(response, onEvent, opts = {}) {
  const { signal } = opts;

  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('This response has no readable stream body (streaming not supported).');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const onAbort = () => {
    try {
      // cancel() returns a promise that can itself reject once the stream is
      // in an errored state — swallow both the sync throw and the rejection,
      // otherwise every Esc/stop logs "Uncaught (in promise) AbortError".
      Promise.resolve(reader.cancel('aborted')).catch(() => {});
    } catch (_err) {
      /* ignore */
    }
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let readResult;
      try {
        readResult = await reader.read();
      } catch (_err) {
        // Stream errored (aborted mid-read, connection reset, etc). Treat as end-of-stream;
        // the caller decides what an unexpected close means for its own UI state.
        break;
      }
      const { value, done } = readResult;
      if (done) break;
      if (!value) continue;

      buffer += decoder.decode(value, { stream: true });

      let boundary = findFrameBoundary(buffer);
      while (boundary) {
        const rawFrame = buffer.slice(0, boundary.start);
        buffer = buffer.slice(boundary.end);
        if (rawFrame.length) dispatchFrame(rawFrame, onEvent);
        boundary = findFrameBoundary(buffer);
      }
    }

    // Flush a trailing frame that never got a final blank-line terminator
    // (server closed the socket immediately after its last write).
    const tail = buffer + decoder.decode(); // flush any pending multi-byte tail
    if (tail.trim().length) dispatchFrame(tail, onEvent);
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch (_err) {
      /* ignore */
    }
  }
}

/** Finds the earliest blank-line frame terminator in `buffer`.
 *  Returns { start, end } (end = index right after the terminator) or null. */
function findFrameBoundary(buffer) {
  const idxCRLF = buffer.indexOf('\r\n\r\n');
  const idxLF = buffer.indexOf('\n\n');
  if (idxCRLF === -1 && idxLF === -1) return null;
  if (idxCRLF !== -1 && (idxLF === -1 || idxCRLF <= idxLF)) {
    return { start: idxCRLF, end: idxCRLF + 4 };
  }
  return { start: idxLF, end: idxLF + 2 };
}

/** Parses one raw frame's lines into { event, data } and invokes onEvent. */
function dispatchFrame(rawFrame, onEvent) {
  const lines = rawFrame.split(/\r\n|\n|\r/);
  let eventName = 'message';
  const dataLines = [];

  for (const line of lines) {
    if (line === '' || line.startsWith(':')) continue; // blank / comment
    let field = line;
    let value = '';
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      field = line;
    } else {
      field = line.slice(0, colonIdx);
      value = line.slice(colonIdx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
    }

    if (field === 'event') eventName = value || 'message';
    else if (field === 'data') dataLines.push(value);
    // 'id' / 'retry' fields are recognized-but-ignored per our contract.
  }

  if (dataLines.length === 0) return; // frame carried no data payload; nothing to deliver
  const rawData = dataLines.join('\n');

  let parsed;
  try {
    parsed = JSON.parse(rawData);
  } catch (err) {
    onEvent('__parse_error__', { raw: rawData, error: String(err) });
    return;
  }
  onEvent(eventName, parsed);
}
