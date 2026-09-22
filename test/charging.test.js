import assert from 'node:assert/strict';
import test from 'node:test';

import { createResultChargeBudget, DEFAULT_RESULT_EVENT } from '../src/charging.js';

function manager({ isPayPerEvent = true, price = 0.00499, remaining = 100 } = {}) {
    return {
        getPricingInfo: () => ({
            pricingModel: isPayPerEvent ? 'PAY_PER_EVENT' : 'PAY_PER_USAGE',
            isPayPerEvent,
            maxTotalChargeUsd: 1,
            perEventPrices: isPayPerEvent ? { [DEFAULT_RESULT_EVENT]: price } : {},
        }),
        calculateMaxEventChargeCountWithinLimit: () => remaining,
    };
}

test('result charge budget caps paid work before scraping', () => {
    const budget = createResultChargeBudget(manager({ remaining: 7 }));
    assert.equal(budget.resultEventEnabled, true);
    assert.equal(budget.capRequestedRows(100), 7);
    assert.equal(budget.pushedRows(7, { chargedCount: 7 }), 7);
});

test('result charge budget recognizes an exhausted event limit', () => {
    const budget = createResultChargeBudget(manager({ remaining: 0 }));
    assert.equal(budget.capRequestedRows(100), 0);
    assert.equal(budget.limitReached({ eventChargeLimitReached: true }), true);
});

test('non-PPE runs preserve requested and pushed row counts', () => {
    const budget = createResultChargeBudget(manager({ isPayPerEvent: false, remaining: 0 }));
    assert.equal(budget.resultEventEnabled, false);
    assert.equal(budget.capRequestedRows(100), 100);
    assert.equal(budget.pushedRows(100, { chargedCount: 0 }), 100);
    assert.equal(budget.limitReached({ eventChargeLimitReached: true }), false);
});
