// A pretend payment provider. No real money moves.

import { newId } from '../domain/ids.js';

export const SUCCESS_TOKEN = 'tok_success';
export const DECLINED_TOKEN = 'tok_declined';

export function createMockPaymentGateway({ delayMs = 0 } = {}) {
  const chargesByKey = new Map();
  const refundsByKey = new Map();
  let chargeCount = 0;
  let refundCount = 0;

  return {
    async charge({ amountCents, paymentToken, idempotencyKey }) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

      const previous = chargesByKey.get(idempotencyKey);
      if (previous) return previous;

      if (paymentToken !== SUCCESS_TOKEN) {
        return { status: 'declined', reason: 'Card declined' };
      }

      chargeCount += 1;
      const result = { status: 'succeeded', chargeId: `ch_${newId()}`, amountCents };
      chargesByKey.set(idempotencyKey, result);
      return result;
    },

    async refund({ chargeId, amountCents, idempotencyKey }) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (idempotencyKey) {
        const previous = refundsByKey.get(idempotencyKey);
        if (previous) return previous;
      }
      refundCount += 1;
      const result = { status: 'succeeded', refundId: `re_${newId()}`, chargeId, amountCents };
      if (idempotencyKey) refundsByKey.set(idempotencyKey, result);
      return result;
    },

    get chargeCount() {
      return chargeCount;
    },
    get refundCount() {
      return refundCount;
    },
  };
}
