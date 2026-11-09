// A clock the code asks for the time, so tests can control "now".

export function createClock(now = () => new Date()) {
  return { now };
}

export const systemClock = createClock();
