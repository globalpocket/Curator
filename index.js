/**
 * GitHub Actions デモプロジェクトのメインファイル
 */

function greet(name) {
  return `こんにちは、${name}さん！`;
}

function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

// メイン処理
if (require.main === module) {
  console.log(greet('GitHub Actions'));
  console.log('5 + 3 =', add(5, 3));
  console.log('4 × 7 =', multiply(4, 7));
}

module.exports = {
  greet,
  add,
  multiply
};
