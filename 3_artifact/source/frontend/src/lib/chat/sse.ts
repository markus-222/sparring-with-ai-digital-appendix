export interface SseParser {
  push(chunk: string): void;
  flush(): void;
}

/** Incremental Server-Sent-Events parser (event/data fields, comments ignored). */
export function createSseParser(onFrame: (name: string, data: string) => void): SseParser {
  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];

  function dispatch(): void {
    if (dataLines.length > 0) {
      onFrame(eventName || "message", dataLines.join("\n"));
    }
    eventName = "";
    dataLines = [];
  }

  function handleLine(line: string): void {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
  }

  return {
    push(chunk: string): void {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    },
    flush(): void {
      if (buffer !== "") {
        handleLine(buffer);
        buffer = "";
      }
      dispatch();
    },
  };
}
