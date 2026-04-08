export interface ParseOptions {
  strict: boolean;
  maxDepth?: number;
}

export type ParseResult = { kind: "ok"; value: unknown } | { kind: "err"; reason: string };

export function parse(input: string, options: ParseOptions): ParseResult {
  if (input.trim() === "") return { kind: "err", reason: "empty input" };
  return { kind: "ok", value: input };
}

export class Parser {
  options: ParseOptions;

  constructor(options: ParseOptions) {
    this.options = options;
  }

  parse(input: string): ParseResult {
    return parse(input, this.options);
  }
}
