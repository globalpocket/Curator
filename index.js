/**
 * GitHub Actions デモプロジェクトのメインファイル
 * gulpfile.jsの機能を移行し、CI/CD実行用に最適化
 */

// 必要なパッケージを読み込む
require('dotenv').config();
const axios = require('axios');
const FormData = require('form-data');
// const { exec } = require('child_process'); // 未使用のためコメントアウト
const fetch = require('node-fetch').default;
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 環境変数の設定
const WP_API = process.env.WP_URL;
const WP_AUTH = process.env.WP_AUTH ? Buffer.from(process.env.WP_AUTH).toString('base64') : null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 環境変数チェック（テスト時はスキップ）
if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'test') {
  if (!WP_API || !WP_AUTH || !GEMINI_API_KEY) {
    console.error('❌ 必須な環境変数が設定されていません:');
    console.error('   WP_URL:', WP_API ? '設定済み' : '未設定');
    console.error('   WP_AUTH:', WP_AUTH ? '設定済み' : '未設定');
    console.error('   GEMINI_API_KEY:', GEMINI_API_KEY ? '設定済み' : '未設定');
    process.exit(1);
  }
}

// Google Geminiの初期化（テスト時はスキップ）
let genAI;
if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'test') {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
}
// const aiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' }); // 未使用のためコメントアウト

// 共通リクエスト関数
async function wpReq(path, method = 'GET', body = null, options = {}) {
  const headers = { Authorization: `Basic ${WP_AUTH}` };

  // FormDataの場合はContent-Typeを自動設定、JSONの場合はapplication/json
  if (body instanceof FormData) {
    Object.assign(headers, body.getHeaders());
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  // 追加のヘッダーをマージ
  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  const res = await fetch(`${WP_API}${path}`, {
    method,
    headers,
    body,
  });
  
  // レスポンスがJSONでない場合のエラーハンドリング
  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error(`Invalid response type: ${contentType}. Status: ${res.status}`);
  }
  
  return res.json();
}

// 現在の日本時間をISO形式で取得する関数
function getJSTDateTime() {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstTime = new Date(now.getTime() + jstOffset);
  return jstTime.toISOString().replace('Z', '') + '+09:00';
}

// テキストをAIで処理する関数（リトライ機能付き）
async function toAiPrompt(prompt, retryCount = 0) {
  const maxRetries = 3;
  const baseWaitTime = 60000;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log('--- AIの回答を受信しました ---');

    // レート制限回避のため待機
    console.log('Waiting 30 seconds to avoid API limits...');
    await new Promise((resolve) => setTimeout(resolve, baseWaitTime));

    return text;
  } catch (error) {
    console.error('❌ AIプロンプト中にエラーが発生しました:', error);

    // 429エラーの場合はリトライ
    if (error.status === 429 && retryCount < maxRetries) {
      const waitTime = baseWaitTime * Math.pow(2, retryCount);
      console.log(`⚠️ レート制限エラー。${waitTime / 1000}秒待機してリトライします... (${retryCount + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return await toAiPrompt(prompt, retryCount + 1);
    }

    return null;
  }
}

// Gemini APIを使用してHTMLコンテンツから最適な画像URLを抽出する関数
async function extractImageUrlFromContent(content) {
  try {
    console.log('🤖 Gemini APIを使用して画像URLを抽出します...');

    // 簡易的な画像検出プロンプト
    const prompt = `
    以下のHTMLコンテンツから最も適切な画像URLを1つだけ抽出してください。
    JSON形式で返してください：
    
    {
      "found": true/false,
      "image_url": "画像URL"
    }
    
    HTMLコンテンツ：
    ${content}
    `;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log('🔍 Gemini APIの応答を受信しました');

    // API応答からJSON部分を抽出
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('⚠️ Gemini APIの応答からJSONを抽出できませんでした');
      return null;
    }

    const aiData = JSON.parse(jsonMatch[0]);

    if (aiData.found && aiData.image_url) {
      console.log(`✅ Gemini APIが画像URLを検出: ${aiData.image_url}`);
      return aiData.image_url;
    } else {
      console.log('⚠️ Gemini APIは有効な画像URLを検出できませんでした');
      return null;
    }
  } catch (error) {
    console.error('Gemini APIによる画像URL抽出エラー:', error.message);
    return null;
  }
}

// 画像ダウンロードを即時実行する関数
async function downloadAndProcessImage(postId, imageUrl) {
  try {
    console.log(`📥 投稿ID ${postId} の画像をダウンロード中: ${imageUrl}`);

    // 画像をダウンロード
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    const imageBuffer = Buffer.from(response.data);
    const fileName = `image_${postId}_${Date.now()}.jpg`;

    // FormDataを作成
    const formData = new FormData();
    formData.append('file', imageBuffer, fileName);
    formData.append('title', `投稿ID ${postId} の画像`);
    formData.append('alt_text', `投稿ID ${postId} の画像`);

    // WordPressにアップロード
    const uploadResponse = await wpReq('/media', 'POST', formData);

    if (uploadResponse.id) {
      console.log(`✅ 投稿ID ${postId} の画像アップロード完了 (メディアID: ${uploadResponse.id})`);
      try {
        await wpReq(`/posts/${postId}`, 'POST', {
          featured_media: uploadResponse.id,
        });
        console.log(`🖼️ 投稿ID ${postId} にアイキャッチ画像を設定しました (メディアID: ${uploadResponse.id})`);
        return { postId, mediaId: uploadResponse.id, success: true };
      } catch (updateError) {
        console.log(`❌ 投稿ID ${postId} のアイキャッチ画像設定失敗:`, updateError.message);
        return { postId, mediaId: uploadResponse.id, success: false };
      }
    } else {
      console.log(`❌ 投稿ID ${postId} の画像アップロード失敗`);
      return { postId, success: false };
    }
  } catch (error) {
    console.log(`❌ 投稿ID ${postId} の画像処理エラー:`, error.message);
    return { postId, success: false };
  }
}

// WordPressに投稿するHTMLを生成する関数
function generatePostContent(aiData, postData) {
  let aiHtml = '';

  // 出典元情報と原文リンクを表示するセクション
  if (postData.acf?.source_name || postData.acf?.link || postData.acf?.source_url) {
    aiHtml += '<div class="source-info-bar" style="display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 20px;">';

    if (postData.acf?.source_name) {
      aiHtml += '<div class="source-left" style="display: flex; align-items: center; gap: 8px;">';
      aiHtml += '<strong style="white-space: nowrap;">出典元:</strong>';

      if (postData.acf?.source_url) {
        aiHtml += '<a href="' + postData.acf.source_url + '" target="_blank" rel="noopener" style="text-decoration: none;">' + postData.acf.source_name + '</a>';
      } else {
        aiHtml += postData.acf.source_name;
      }
      aiHtml += '</div>';
    }

    if (postData.acf?.link) {
      aiHtml += '<a href="' + postData.acf.link + '" target="_blank" rel="noopener" style="margin-left: auto; text-decoration: none; font-weight: bold;">→ 原文記事を読む</a>';
    }

    aiHtml += '</div>';
  }

  // AI要約をメインコンテンツとして表示
  if (aiData.ai_summary) {
    aiHtml += '<div class="ai-summary-content" style="margin: 20px 0; line-height: 1.6;">';
    aiHtml += aiData.ai_summary;
    aiHtml += '</div>';
  }

  // AI分析コンテナ
  aiHtml += '<div class="ai-analysis-container" style="margin-top: 30px; padding: 20px; border: 1px solid #ddd; background: #f9f9f9; border-radius: 8px;">';
  aiHtml += '<h3 style="margin-top:0; display: inline-block; vertical-align: middle; margin-right: 15px;">🤖 AIによる分析</h3>';

  // 重要度と感情分析をバッジ表示
  if (aiData.ai_importance || aiData.ai_sentiment) {
    aiHtml += '<div style="margin-bottom: 15px; display: inline-block; vertical-align: middle;">';
    if (aiData.ai_importance) {
      aiHtml += '<span style="background:#e91e63; color:#fff; padding:2px 8px; border-radius:4px; margin-right:10px; font-size:12px;">重要度: ' + aiData.ai_importance + '/5</span>';
    }
    if (aiData.ai_sentiment) {
      const sentimentLabel = aiData.ai_sentiment === 'positive' ? 'ポジティブ' : aiData.ai_sentiment === 'negative' ? 'ネガティブ' : 'ニュートラル';
      aiHtml += '<span style="background:#607d8b; color:#fff; padding:2px 8px; border-radius:4px; font-size:12px;">論調: ' + sentimentLabel + '</span>';
    }
    aiHtml += '</div>';
  }

  // 3行要点
  if (aiData.ai_summary_points) {
    aiHtml += '<div class="ai-points" style="margin-bottom: 15px;"><strong>💡 この記事のポイント:</strong>' + aiData.ai_summary_points + '</div>';
  }

  // ターゲット読者
  if (aiData.ai_target_audience) {
    aiHtml += '<p style="font-size: 0.85em; color: #666;">🎯 読者ターゲット層: ' + aiData.ai_target_audience + '</p>';
  }

  // 推奨タグ
  if (aiData.ai_tags_suggest) {
    const tagsList = Array.isArray(aiData.ai_tags_suggest) ? aiData.ai_tags_suggest : aiData.ai_tags_suggest.split(',');
    aiHtml += '<div style="margin-top: 10px;">';
    tagsList.forEach((tag) => {
      aiHtml += '<span style="display:inline-block; background:#eee; padding:2px 6px; border-radius:3px; margin-right:5px; font-size:11px;">#' + tag.trim() + '</span>';
    });
    aiHtml += '</div>';
  }

  aiHtml += '</div>';

  return aiHtml;
}

// 投稿更新を即時実行する関数
async function updatePostImmediately(updateInfo) {
  try {
    console.log(`📝 投稿ID ${updateInfo.postId} を更新中...`);

    const updateResponse = await wpReq(`/posts/${updateInfo.postId}`, 'POST', updateInfo.updateData);

    if (updateResponse.id) {
      console.log(`✅ 投稿ID ${updateInfo.postId} を更新しました。`);
      return { postId: updateInfo.postId, success: true };
    } else {
      console.error(`❌ 投稿ID ${updateInfo.postId} の更新に失敗しました。`);
      return { postId: updateInfo.postId, success: false };
    }
  } catch (error) {
    console.error(`❌ 投稿ID ${updateInfo.postId} の更新中にエラーが発生しました:`, error);
    return { postId: updateInfo.postId, success: false };
  }
}

// 個別投稿処理関数
async function doProcessPost(post) {
  console.log(`\n--- 処理中の投稿 ID: ${post.id} ---`);

  const sourceContent = post.content?.rendered || post.content?.raw || post.meta?.content_encoded || post.title?.rendered || post.excerpt?.rendered || '';

  if (!sourceContent) {
    console.log(`⚠️ 投稿ID ${post.id} に解析用コンテンツがないためスキップします。`);
    return;
  }

  const categoryMap = {
    選ぶ: 2082,
    体験する: 2083,
    深掘り: 2084,
    買う: 2085,
    コミュニティ: 2086,
  };

  // Geminiへの指示
  const prompt = `
  以下の記事内容を分析し、JSON形式で回答してください：
  
  {
    "ai_summary": "記事の要約",
    "ai_summary_points": "要点を3点",
    "ai_importance": 1-5,
    "ai_sentiment": "positive/neutral/negative",
    "ai_target_audience": "対象読者層",
    "ai_tags_suggest": ["タグ1", "タグ2"],
    "selected_category": "選ぶ|体験する|深掘り|買う|コミュニティ",
    "is_beer_related": true/false,
    "content_description": "記事の説明"
  }
  
  記事内容：
  ${sourceContent}
  `;

  console.log('Geminiによる高度な分析を開始...');
  const aiRawResponse = await toAiPrompt(prompt);

  if (!aiRawResponse) return;

  try {
    // JSON部分のみを抽出
    const jsonMatch = aiRawResponse.match(/\{[\s\S]*\}/);
    const aiData = JSON.parse(jsonMatch[0]);

    // ステータスの決定ロジック
    let postStatus = 'draft';

    // 飲食関連と無関係な記事はスキップ
    if (aiData.is_beer_related === false) {
      console.log('⚠️ 飲食関連と無関係な記事と判定されました。スキップします。');
      return;
    }

    // カテゴリーIDの決定
    const selectedCatName = aiData.selected_category;
    const mainCategoryId = categoryMap[selectedCatName] || categoryMap['深掘り'];

    // カテゴリー配列の作成
    let targetCategories = [mainCategoryId];

    // 重要度4以上の場合は注目ニュースを追加
    if (aiData.ai_importance >= 4) {
      targetCategories.push(1677);
      console.log(`🌟 注目ニュースカテゴリーを追加: 重要度=${aiData.ai_importance}`);
    }

    // 更新データの準備
    let updateDate = new Date().toISOString();
    if (post.meta?.pubdate) {
      try {
        const pubDate = new Date(post.meta.pubdate);
        if (!isNaN(pubDate.getTime())) {
          updateDate = pubDate.toISOString();
        }
      } catch (error) {
        console.log(`⚠️ pubDateの処理エラー: ${error.message}`);
      }
    }

    // アイキャッチ画像がない場合、元記事の最初の画像を抽出して設定
    if (!post.featured_media || post.featured_media <= 0) {
      console.log(`🖼️ 投稿ID ${post.id} にアイキャッチ画像がないため、元記事の画像を抽出します...`);

      const imageUrl = await extractImageUrlFromContent(
        post.content.raw || post.content.rendered,
        post.acf?.link,
      );

      if (imageUrl) {
        console.log(`🔗 投稿ID ${post.id} の画像URLを検出: ${imageUrl}`);
        const imageResult = await downloadAndProcessImage(post.id, imageUrl);

        if (imageResult.success) {
          console.log(`✅ 投稿ID ${post.id} の画像処理が完了しました`);
          postStatus = 'publish';
        } else {
          console.log(`⚠️ 投稿ID ${post.id} の画像処理に失敗しましたが、処理を続行します`);
          postStatus = 'draft';
        }
      } else {
        console.log(`⚠️ 投稿ID ${post.id} の元記事から画像を抽出できませんでした`);
        postStatus = 'draft';
      }
    } else {
      console.log(`🖼️ 投稿ID ${post.id} にはすでにアイキャッチ画像があります`);
      postStatus = 'publish';
    }

    // 投稿本文を生成
    const postContent = generatePostContent(aiData, post);

    const updateData = {
      categories: targetCategories,
      date: updateDate,
      content: postContent,
      acf: {
        ...post.meta,
        last_processed: getJSTDateTime(),
        ai_summary_points: aiData.ai_summary_points,
        ai_importance: aiData.ai_importance,
        ai_sentiment: aiData.ai_sentiment,
        ai_target_audience: aiData.ai_target_audience,
        ai_tags_suggest: Array.isArray(aiData.ai_tags_suggest) ? aiData.ai_tags_suggest.join(',') : aiData.ai_tags_suggest,
        content_description: aiData.content_description,
      },
      excerpt: aiData.content_description,
      status: postStatus,
    };

    // 投稿を更新
    const updateResult = await updatePostImmediately({
      postId: post.id,
      updateData,
      currentCategories: targetCategories,
      currentFeaturedMedia: post.featured_media,
      aiImportance: aiData.ai_importance,
    });

    if (updateResult.success) {
      console.log(`✅ 投稿ID ${post.id} を更新しました（ステータス: ${postStatus}）`);
    } else {
      console.error(`❌ 投稿ID ${post.id} の更新に失敗しました`);
    }
  } catch (error) {
    console.error('❌ 更新処理中にエラーが発生しました:', error);
  }
}

// インポート処理関数
async function handleImport(baseUrl) {
  try {
    console.log('=== インポートをトリガーします ===');

    // インポートをトリガー
    const importResponse = await fetch(`${baseUrl}&action=trigger`);

    if (importResponse.ok) {
      console.log('✅ インポートトリガーが正常に実行されました');
    } else {
      console.error(`❌ インポートトリガーに失敗しました: ${importResponse.status}`);
      return false;
    }

    // インポート完了をチェック
    console.log('⏳ インポート完了を待機します...');
    let remainingCount = -1;
    let attempts = 0;
    const maxAttempts = 30;

    while (remainingCount !== 0 && attempts < maxAttempts) {
      attempts++;
      console.log(`📊 インポート進捗チェック (${attempts}回目)...`);

      try {
        const progressResponse = await fetch(`${baseUrl}&action=processing`);

        if (progressResponse.ok) {
          const progressText = await progressResponse.text();
          console.log('進捗レスポンス:', progressText);

          try {
            const progressData = JSON.parse(progressText);
            if (progressData.status === 200 && progressData.message && progressData.message.includes('complete')) {
              remainingCount = 0;
              console.log('✅ インポート完了メッセージを検出しました！');
              break;
            }
          } catch (jsonError) {
            const countMatch = progressText.match(/(\d+)/);
            if (countMatch) {
              remainingCount = parseInt(countMatch[1]);
              console.log(`📈 残りインポート数: ${remainingCount}`);

              if (remainingCount === 0) {
                console.log('✅ インポートが完了しました！');
                break;
              }
            }
          }
        } else {
          console.error('❌ 進捗チェックに失敗しました:', progressResponse.status);
        }
      } catch (error) {
        console.error('❌ 進捗チェック中にエラーが発生しました:', error);
      }

      if (remainingCount !== 0 && attempts < maxAttempts) {
        console.log('⏱️ 1分待機します...');
        await new Promise((resolve) => setTimeout(resolve, 60000));
      }
    }

    if (attempts >= maxAttempts) {
      console.warn('⚠️ 最大待機時間を超過しました。処理を続行します。');
    }

    console.log('🚀 AI分析処理を開始します。');
    return true;
  } catch (error) {
    console.error('❌ インポート処理中にエラーが発生しました:', error);
    return false;
  }
}

// ニュースインポート処理
async function importNews() {
  try {
    console.log('--- ニュースインポート処理を開始します ---');

    const importIds = [1, 2, 3, 4, 6, 7]; // 5は除外

    for (const importId of importIds) {
      const importSuccess = await handleImport(
        `${WP_API.replace('/wp-json/wp/v2', '')}/wp-load.php?import_key=r_9pwmOfJ&import_id=${importId}`,
      );

      if (!importSuccess) {
        console.error(`❌ インポートID ${importId} の処理が失敗しました。`);
      }
    }

    console.log('--- ニュースインポート処理が完了しました ---');
  } catch (error) {
    console.error('❌ インポート処理中にエラーが発生しました:', error);
  }
}

// ニュース処理
async function processNews() {
  try {
    // ページネーションで全投稿を取得
    let allPosts = [];
    let page = 1;
    const perPage = 100;

    console.log('--- 投稿データを取得中... ---');

    let hasMorePosts = true;
    while (hasMorePosts) {
      const response = await wpReq(
        `/posts?status=pending&_embed&context=edit&acf_format=standard&per_page=${perPage}&page=${page}`,
      );

      const posts = response;
      if (!Array.isArray(posts) || posts.length === 0) {
        hasMorePosts = false;
        break;
      }

      allPosts.push(...posts);
      console.log(`--- ページ${page}: ${posts.length}件取得（累計: ${allPosts.length}件） ---`);

      if (posts.length < perPage) {
        hasMorePosts = false;
        break;
      }
      page++;
    }

    const posts = allPosts;
    console.log(`--- 全投稿取得完了: ${posts.length}件 ---`);

    // 投稿をランダムにシャッフル
    const shuffledPosts = posts.sort(() => Math.random() - 0.5);
    console.log('--- 投稿をランダムにシャッフルしました ---');

    for (const post of shuffledPosts) {
      await doProcessPost(post);
    }
  } catch (error) {
    console.error('タスク実行エラー:', error);
  }

  console.log('✅ すべての処理が完了しました');
}

// 個別投稿処理
async function processPostById(postId) {
  try {
    if (!postId) {
      console.error('❌ 投稿IDが指定されていません。');
      return;
    }

    if (isNaN(postId)) {
      console.error('❌ 投稿IDは数字で指定してください。');
      return;
    }

    console.log(`--- 投稿ID ${postId} の処理を開始します ---`);

    const post = await wpReq(`/posts/${postId}?status=pending&_embed&context=edit&acf_format=standard`);

    if (!post || !post.id) {
      console.error(`❌ 投稿ID ${postId} が見つからないか、アクセスできません。`);
      return;
    }

    console.log(`✅ 投稿ID ${postId} を取得しました`);
    console.log(`タイトル: ${post.title?.rendered || 'タイトルなし'}`);
    console.log(`ステータス: ${post.status}`);

    await doProcessPost(post);

    console.log(`--- 投稿ID ${postId} の処理が完了しました ---`);
  } catch (error) {
    console.error('❌ タスク実行エラー:', error);
  }
}

// メイン処理
async function main() {
  const command = process.argv[2];

  switch (command) {
  case 'import-news':
    await importNews();
    break;
  case 'process-news':
    await processNews();
    break;
  case 'fetch-news':
    await importNews();
    await processNews();
    break;
  case 'process-post': {
    const postId = process.argv[3];
    await processPostById(postId);
    break;
  }
  default:
    console.log('使用方法:');
    console.log('  node index.js import-news     # ニュースインポート実行');
    console.log('  node index.js process-news    # ニュース処理実行');
    console.log('  node index.js fetch-news      # インポート+処理実行');
    console.log('  node index.js process-post [ID] # 個別投稿処理');
    break;
  }
}

// 元の関数（互換性維持）
function greet(name) {
  return `こんにちは、${name}さん！`;
}

function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

// エントリーポイント
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  greet,
  add,
  multiply,
  wpReq,
  toAiPrompt,
  extractImageUrlFromContent,
  downloadAndProcessImage,
  generatePostContent,
  updatePostImmediately,
  doProcessPost,
  handleImport,
  importNews,
  processNews,
  processPostById,
};
