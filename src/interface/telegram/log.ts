export type SafeLogFields = {
  userId: number;
  correlationId: string;
  updateId?: number;
  action?: string;
  cardId?: number;
  state?: string;
};

export type AppLogger = {
  info(fields: SafeLogFields, message: string): void;
  warn(fields: SafeLogFields, message: string): void;
  error(fields: SafeLogFields & { err?: string }, message: string): void;
};

function assertSafe(fields: object): void {
  const json = JSON.stringify(fields);
  if (json.includes('₽') || /"(amount|balance|capital|delta|sum)":/i.test(json)) {
    throw new Error('refusing to log monetary fields');
  }
}

export function createSafeLogger(write: (line: string) => void = (line) => process.stderr.write(`${line}\n`)): AppLogger {
  const emit = (level: string, fields: object, message: string): void => {
    assertSafe(fields);
    write(JSON.stringify({ level, ...fields, msg: message }));
  };
  return {
    info(fields, message) {
      emit('info', fields, message);
    },
    warn(fields, message) {
      emit('warn', fields, message);
    },
    error(fields, message) {
      emit('error', fields, message);
    },
  };
}
