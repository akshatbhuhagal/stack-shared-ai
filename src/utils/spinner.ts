// Lightweight CLI spinner. No dependencies — uses ANSI escape codes.
// Disabled automatically in non-TTY environments (CI, piped output) and in
// verbose mode (where log lines would clobber the animation).

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

// ANSI codes
const CLEAR_LINE = "\r\x1b[2K";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

export interface SpinnerOptions {
  enabled?: boolean;
}

export class Spinner {
  private text = "";
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private enabled: boolean;

  constructor(options: SpinnerOptions = {}) {
    // Default: enabled if stdout is a TTY and not explicitly disabled
    this.enabled = options.enabled ?? !!process.stdout.isTTY;
  }

  start(text: string): this {
    this.text = text;
    if (!this.enabled) {
      console.log(text);
      return this;
    }
    process.stdout.write(HIDE_CURSOR);
    this.render();
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % FRAMES.length;
      this.render();
    }, INTERVAL_MS);
    return this;
  }

  update(text: string): this {
    this.text = text;
    if (this.enabled && this.timer) {
      this.render();
    }
    // Silent in non-TTY mode — avoids spamming logs with intermediate updates.
    return this;
  }

  succeed(text?: string): this {
    this.stopWith(`${GREEN}✔${RESET} ${text ?? this.text}`);
    return this;
  }

  fail(text?: string): this {
    this.stopWith(`${RED}✖${RESET} ${text ?? this.text}`);
    return this;
  }

  info(text: string): this {
    // Print a line without stopping the spinner — pauses animation briefly
    if (!this.enabled) {
      console.log(text);
      return this;
    }
    process.stdout.write(CLEAR_LINE);
    process.stdout.write(`${CYAN}ℹ${RESET} ${text}\n`);
    this.render();
    return this;
  }

  stop(): this {
    this.stopWith(null);
    return this;
  }

  private stopWith(finalLine: string | null): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.enabled) {
      if (finalLine) console.log(stripAnsi(finalLine));
      return;
    }
    process.stdout.write(CLEAR_LINE);
    if (finalLine) {
      process.stdout.write(`${finalLine}\n`);
    }
    process.stdout.write(SHOW_CURSOR);
  }

  private render(): void {
    process.stdout.write(`${CLEAR_LINE}${CYAN}${FRAMES[this.frame]}${RESET} ${DIM}${this.text}${RESET}`);
  }
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// Ensure cursor is restored if the process dies mid-spinner
process.on("exit", () => {
  if (process.stdout.isTTY) process.stdout.write(SHOW_CURSOR);
});
