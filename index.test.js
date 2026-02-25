/**
 * テストファイル
 */

const { greet, add, multiply } = require('./index');

describe('ユーティリティ関数のテスト', () => {
  test('greet関数が正しい挨拶を返す', () => {
    expect(greet('テスト')).toBe('こんにちは、テストさん！');
  });

  test('add関数が正しい合計を返す', () => {
    expect(add(2, 3)).toBe(5);
    expect(add(-1, 1)).toBe(0);
    expect(add(0, 0)).toBe(0);
  });

  test('multiply関数が正しい積を返す', () => {
    expect(multiply(3, 4)).toBe(12);
    expect(multiply(-2, 5)).toBe(-10);
    expect(multiply(0, 100)).toBe(0);
  });
});

describe('エッジケースのテスト', () => {
  test('greet関数が空文字列を処理できる', () => {
    expect(greet('')).toBe('こんにちは、さん！');
  });

  test('add関数が小数を処理できる', () => {
    expect(add(0.1, 0.2)).toBeCloseTo(0.3);
  });
});
