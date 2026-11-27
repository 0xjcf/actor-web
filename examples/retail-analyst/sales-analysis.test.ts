import { describe, expect, it } from 'vitest';
import { sales } from './fixtures.js';
import { findLargestSalesIncrease } from './sales-analysis.js';

const rows = (...quantities: number[]) =>
  quantities.map((quantity, index) => ({
    date: `2024-01-${String(index + 1).padStart(2, '0')}`,
    quantity,
  }));

describe('maximum sales increase', () => {
  it('finds the fixture maximum by percentage rather than absolute quantity', () => {
    expect(findLargestSalesIncrease(sales)).toEqual({
      status: 'found',
      increase: {
        date: '2024-01-12',
        amount_before_increase: 114,
        amount_after_increase: 342,
        percentage_increase: 200,
      },
    });
    expect(findLargestSalesIncrease(rows(10, 20, 100, 200))).toMatchObject({
      increase: { date: '2024-01-03', percentage_increase: 400 },
    });
  });
  it('sorts a copy and resolves exact ties to the earliest date', () => {
    const input = Object.freeze(
      rows(100, 200, 400)
        .reverse()
        .map((row) => Object.freeze(row))
    );
    expect(findLargestSalesIncrease(input)).toMatchObject({
      increase: { date: '2024-01-02', percentage_increase: 100 },
    });
    expect(input[0].date).toBe('2024-01-03');
  });
  it('selects the unrounded maximum before rounding its output', () => {
    expect(findLargestSalesIncrease(rows(100001, 100011, 100000, 100010))).toMatchObject({
      increase: { date: '2024-01-04', percentage_increase: 0.01 },
    });
    expect(findLargestSalesIncrease(rows(3, 4))).toMatchObject({
      increase: { percentage_increase: 33.33 },
    });
  });
  it.each([{ input: [] }, { input: rows(10) }])('reports insufficient records', ({ input }) => {
    expect(findLargestSalesIncrease(input)).toEqual({
      status: 'unavailable',
      code: 'INSUFFICIENT_SALES_DATA',
    });
  });
  it.each([{ input: rows(10, 10) }, { input: rows(30, 20, 10) }])(
    'reports no positive increase',
    ({ input }) => {
      expect(findLargestSalesIncrease(input)).toEqual({
        status: 'unavailable',
        code: 'NO_SALES_INCREASE',
      });
    }
  );
  it('refuses a zero baseline rather than skipping an undefined comparison', () => {
    expect(findLargestSalesIncrease(rows(10, 20, 0, 30))).toEqual({
      status: 'unavailable',
      code: 'ZERO_SALES_BASELINE',
    });
  });
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'refuses invalid quantity %s',
    (quantity) => {
      expect(findLargestSalesIncrease(rows(10, quantity))).toEqual({
        status: 'unavailable',
        code: 'INVALID_SALES_DATA',
      });
    }
  );
  it('refuses invalid, duplicate, or nonconsecutive dates', () => {
    expect(
      findLargestSalesIncrease([{ date: '2024-02-30', quantity: 10 }, ...rows(20)])
    ).toMatchObject({ code: 'INVALID_SALES_DATA' });
    expect(findLargestSalesIncrease([...rows(10), ...rows(20)])).toMatchObject({
      code: 'NON_CONSECUTIVE_SALES_DATES',
    });
    expect(
      findLargestSalesIncrease([
        { date: '2024-01-01', quantity: 10 },
        { date: '2024-01-03', quantity: 20 },
      ])
    ).toMatchObject({ code: 'NON_CONSECUTIVE_SALES_DATES' });
  });
});
