export type SendParseMode = 'HTML';

export type TelegramSender = {
  sendMessage(
    text: string,
    keyboard?: import('./keyboards/keyboards.js').Keyboard,
    parseMode?: SendParseMode,
  ): Promise<void>;
  sendDocument(file: Buffer, filename: string): Promise<void>;
  answerCallback(text?: string): Promise<void>;
};

export class MemorySender implements TelegramSender {
  readonly messages: {
    text: string;
    keyboard?: import('./keyboards/keyboards.js').Keyboard;
    parseMode?: SendParseMode;
  }[] = [];
  readonly documents: { filename: string; buffer: Buffer }[] = [];
  readonly callbackAnswers: (string | undefined)[] = [];

  async sendMessage(
    text: string,
    keyboard?: import('./keyboards/keyboards.js').Keyboard,
    parseMode?: SendParseMode,
  ): Promise<void> {
    const message: (typeof this.messages)[number] = { text };
    if (keyboard !== undefined) {
      message.keyboard = keyboard;
    }
    if (parseMode !== undefined) {
      message.parseMode = parseMode;
    }
    this.messages.push(message);
  }

  async sendDocument(file: Buffer, filename: string): Promise<void> {
    this.documents.push({ filename, buffer: file });
  }

  async answerCallback(text?: string): Promise<void> {
    this.callbackAnswers.push(text);
  }

  get lastText(): string {
    return this.messages.at(-1)?.text ?? '';
  }

  get lastKeyboard(): import('./keyboards/keyboards.js').Keyboard | undefined {
    return this.messages.at(-1)?.keyboard;
  }

  allTexts(): string {
    return this.messages.map((message) => message.text).join('\n');
  }
}

export type IncomingUpdate =
  | { kind: 'message'; updateId: number; telegramId: string; text: string }
  | { kind: 'callback'; updateId: number; telegramId: string; data: string };
