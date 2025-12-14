// KIRINUKI_RG.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

let fetch;
(async () => {
    const nodeFetch = await import('node-fetch');
    fetch = nodeFetch.default;
})();

const app = express();
const PORT = process.env.PORT || 3000;

// ▼▼▼ 4K画像を受け取るため、サイズ制限を50MBに ▼▼▼
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));


// 静的ファイル配信（プロジェクトルートを基準にする）
app.use(express.static(path.join(__dirname)));

const METADATA_BASE_URL = 'https://nft.financie.io/metadata/KRG/';


// サーバー起動時に一度だけ読み込むか、都度読み込むか（ここでは都度読み込む）
function loadTokenExceptions() {
    const exceptionsFilePath = path.join(__dirname, 'token_exceptions.json');
    if (fs.existsSync(exceptionsFilePath)) {
        try {
            const data = fs.readFileSync(exceptionsFilePath, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.error('token_exceptions.json の解析に失敗しました:', e);
            return {};
        }
    } else {
        console.warn('token_exceptions.json が見つかりません。');
        return {};
    }
}


app.get('/', (req, res) => {
    console.log('--- ブラウザからページへのアクセスがありました ---');
    res.sendFile(path.join(__dirname, 'KIRINUKI_RG.html'));
});

app.get('/api/get-traits', async (req, res) => {
    console.log('--- /api/get-traits へのリクエストを受信しました ---');
    
    const { tokenId } = req.query;
    if (!tokenId || !fetch) {
        return res.status(400).json({ error: '無効なリクエストです。' });
    }
    try {
        const metadataUrl = `${METADATA_BASE_URL}${tokenId}.json`;
        const response = await fetch(metadataUrl);
        if (!response.ok) {
            return res.status(response.status).json({ error: `メタデータの取得に失敗しました。` });
        }
        const data = await response.json();
        console.log('--- Traitsデータの取得に成功しました ---');
        res.json({ traits: data.traits || [] });
    } catch (error) {
        console.error('データ取得エラー:', error);
        res.status(500).json({ error: 'データの取得に失敗しました。' });
    }
});

app.get('/api/get-image', async (req, res) => {
    const { tokenId } = req.query;
    if (!tokenId || !fetch) {
        return res.status(400).json({ error: '無効なリクエストです。' });
    }
    try {
        const metadataUrl = `${METADATA_BASE_URL}${tokenId}.json`;
        const response = await fetch(metadataUrl);
        if (!response.ok) {
            return res.status(response.status).json({ error: `メタデータの取得に失敗しました。` });
        }
        const data = await response.json();
        const imageUrl = data.image;
        if (imageUrl) {
            res.json({ imageUrl });
        } else {
            res.status(404).json({ error: '画像URLが見つかりませんでした。' });
        }
    } catch (error) {
        console.error('データ取得エラー:', error);
        res.status(500).json({ error: 'データの取得に失敗しました。' });
    }
});

app.get('/api/proxy-image', async (req, res) => {
    const { url } = req.query;
    if (!url || !fetch) {
        return res.status(400).send('URLが指定されていません。');
    }
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return res.status(response.status).send('画像の取得に失敗しました。');
        }
        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }
        response.body.pipe(res);
    } catch (error) {
        console.error('画像プロキシエラー:', error);
        res.status(500).send('サーバーエラー');
    }
});

const normalizeString = (str) => {
    if (typeof str !== 'string') return '';
    return str.replace(/[-_.\s]/g, '').toLowerCase();
};

// 通常のマスク画像検索エンドポイント
app.get('/api/get-masks-by-layers', (req, res) => {

    const { traits, tokenId } = req.query;

    if (!traits) {
        return res.status(400).json({ error: 'パーツ情報が指定されていません。' });
    }
    try {
        const parsedTraits = JSON.parse(traits);
        const masksByLayer = {};
        const assetsDir = path.join(__dirname, 'assets');
        
        let faceMaskUrls = [];

        if (!fs.existsSync(assetsDir)) {
            return res.status(404).json({ error: `assetsディレクトリが見つかりません: ${assetsDir}` });
        }
        
        const allTokenExceptions = loadTokenExceptions();
        let tokenExceptionsList = [];
        
        if (tokenId && allTokenExceptions[tokenId]) {
            const exData = allTokenExceptions[tokenId];
            // 単一オブジェクトなら配列に変換、すでに配列ならそのまま使う
            tokenExceptionsList = Array.isArray(exData) ? exData : [exData];
            console.log(`★ ID ${tokenId} 用の例外ルールを読み込みました (${tokenExceptionsList.length}件)`);
        }

        let isC2TechException = false;
        const clothesTrait = parsedTraits.find(trait => trait.trait_type === 'Clothes');
        if (clothesTrait) {
            const normalizedClothesName = clothesTrait.value.replace(/\s/g, '');
            if (normalizedClothesName.includes('C2Tech') && normalizedClothesName !== 'C2Tech') {
                isC2TechException = true;
            }
        }

        const scarfExceptionValues = [
            "Black Scarf",
            "White Scarf",
            "Khaki Scarf",
            "Multicolor Scarf Black",
            "Multicolor Scarf White"
        ];

        let isScarfException = parsedTraits.some(trait => 
            trait.trait_type === 'Body Layer' && 
            scarfExceptionValues.includes(trait.value)
        );

        if (isScarfException) {
            console.log("★ スカーフ例外を検出: 'Accessory Neck' の検索をスキップします。");
        }

        // ▼▼▼ Powersuit Neck 例外の定義 ▼▼▼
        const powersuitNeckValues = [
            "Powersuit Neck Amber",
            "Powersuit Neck Red",
            "Powersuit Neck Violet"
        ];

        const isPowersuitNeckException = parsedTraits.some(trait => 
            trait.trait_type === 'Body Layer' && 
            powersuitNeckValues.includes(trait.value)
        );

        if (isPowersuitNeckException) {
            console.log("★ Powersuit Neck 例外を検出: 'Face' マスクを専用のものに差し替えます。");
        }

        // ▼▼▼ Long with Bucket Hat 例外の定義 ▼▼▼
        const bucketHatExceptionValues = [
            "Long Black with Bucket Hat",
            "Long Blue Green with Bucket Hat",
            "Long Gold with Bucket Hat",
            "Long Green with Bucket Hat",
            "Long Pink with Bucket Hat",
            "Long Purple with Bucket Hat",
            "Long White Ash with Bucket Hat",
            "Long White with Bucket Hat"
        ];

        const isBucketHatException = parsedTraits.some(trait => 
            trait.trait_type === 'Hair and Hat' && 
            bucketHatExceptionValues.includes(trait.value.trim())
        );

        if (isBucketHatException) {
            console.log("★ Bucket Hat 例外を検出: 'Head' の検索をスキップします。");
        }
        
        parsedTraits.forEach(trait => {
            if (isScarfException && trait.trait_type === 'Accessory Neck') {
                console.log(` -> スキップ: ${trait.trait_type} (${trait.value})`);
                return; 
            }

            // ▼▼▼ Bucket Hat 例外の適用 (Headスキップ) ▼▼▼
            if (isBucketHatException && trait.trait_type === 'Head') {
                console.log(` -> スキップ: ${trait.trait_type} (${trait.value}) [Bucket Hat Conflict]`);
                return; 
            }

            // ▼▼▼ Powersuit Neck 着用時の Face マスク差し替え ▼▼▼
            if (isPowersuitNeckException && trait.trait_type === 'Face') {
                let exceptionFaceUrl = null;
                const faceVal = trait.value.trim();

                // Male系
                if (["Male", "Male Red Skin", "Male Blue Skin"].includes(faceVal)) {
                    exceptionFaceUrl = '/assets/Exception/head_layer1_Male_Powersuit.png';
                } 
                // Female系
                else if (["Female", "Female Red Skin", "Female Blue Skin"].includes(faceVal)) {
                    exceptionFaceUrl = '/assets/Exception/head_layer1_Female_Powersuit.png';
                }

                if (exceptionFaceUrl) {
                    console.log(`★ Powersuit Neck 例外適用: Faceマスクを ${exceptionFaceUrl} に変更します。`);
                    
                    // ファイル名に合わせてレイヤーを決定 (head_layer1)
                    const targetLayer = 'head_layer1'; 
                    
                    if (!masksByLayer[targetLayer]) {
                        masksByLayer[targetLayer] = [];
                    }
                    masksByLayer[targetLayer].push(exceptionFaceUrl);
                    faceMaskUrls.push(exceptionFaceUrl);
                    
                    return; // 通常のFace検索をスキップ
                }
            }
            
            // 現在のTraitに適用すべき例外ルールを探す
            const matchedException = tokenExceptionsList.find(ex => ex.trait_type === trait.trait_type);

            if (matchedException) {
                if (matchedException.type === 'SKIP_TRAIT') {
                    console.log(`★ ID ${tokenId} 例外適用: Trait "${trait.trait_type}" のマスク検索をスキップします。`);
                    return; // このTraitの処理をスキップ
                }

                if (matchedException.type === 'OVERRIDE_MASK') {
                    console.log(`★ ID ${tokenId} 例外適用 (OVERRIDE): Trait "${trait.trait_type}" のマスクを ${matchedException.url} で上書きします。`);
                    const targetLayer = matchedException.layer;
                    if (!masksByLayer[targetLayer]) {
                        masksByLayer[targetLayer] = [];
                    }
                    masksByLayer[targetLayer].push(matchedException.url);
                    
                    if (trait.trait_type === 'Face') {
                         faceMaskUrls.push(matchedException.url);
                    }
                    
                    return; // このTraitの通常検索をスキップ
                }
            }

            let partName = trait.value.trim(); 
            let traitType = trait.trait_type;
            let genreDir; // 最終的に使うフォルダパス

            // ▼▼▼ 大文字小文字を無視してフォルダを探す関数 ▼▼▼
            const findDirCaseInsensitive = (baseDir, targetName) => {
                try {
                    if (!fs.existsSync(baseDir)) return null;
                    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
                    // 1. 完全一致があればそれを返す
                    const exactMatch = entries.find(e => e.isDirectory() && e.name === targetName);
                    if (exactMatch) return path.join(baseDir, exactMatch.name);
                    
                    // 2. なければ大文字小文字無視で探す
                    const targetLower = targetName.toLowerCase();
                    const fuzzyMatch = entries.find(e => e.isDirectory() && e.name.toLowerCase() === targetLower);
                    return fuzzyMatch ? path.join(baseDir, fuzzyMatch.name) : null;
                } catch (e) {
                    console.error('フォルダ探索エラー:', e);
                    return null;
                }
            };

            if (isC2TechException && traitType === 'Face') {
                genreDir = path.join(assetsDir, 'Exception');
            } else {
                // ここを変更: 単純結合ではなく、実在するフォルダ名を探しに行く
                genreDir = findDirCaseInsensitive(assetsDir, traitType);
            }

            // 見つからなければスキップ
            if (!genreDir) {
                // console.log(`フォルダが見つかりません: ${traitType}`); // デバッグ用
                return;
            }

            let searchName = partName; 

            const aliasFileName = `mask_${traitType.toLowerCase().replace(/\s/g, '_')}_aliases.json`;
            const aliasFilePath = path.join(__dirname, aliasFileName);

            if (fs.existsSync(aliasFilePath)) {
                try {
                    const aliasData = JSON.parse(fs.readFileSync(aliasFilePath, 'utf8'));
                    
                    const reversedAliasMap = {};
                    for (const baseName in aliasData) {
                        const aliasNames = aliasData[baseName];
                        if (Array.isArray(aliasNames)) {
                            aliasNames.forEach(alias => {
                                reversedAliasMap[alias] = baseName;
                            });
                        }
                    }

                    if (reversedAliasMap[partName]) {
                        searchName = reversedAliasMap[partName];
                        console.log(`エイリアスを適用: "${partName}" -> "${searchName}"`);
                    }

                } catch (e) {
                    console.error(`エイリアスファイル "${aliasFileName}" の読み込みまたは解析に失敗しました。`, e);
                }
            }

            const files = fs.readdirSync(genreDir);
            const normalizedSearchName = normalizeString(searchName);
            
            const maskFile = files.find(file => {
                const baseFileNameMatch = file.match(/^(?:.*_layer\d+_)?(.*)\.png$/i);
                if (!baseFileNameMatch || baseFileNameMatch.length < 2) return false;
                const baseFileName = baseFileNameMatch[1];
                const normalizedFileBaseName = normalizeString(baseFileName);
                return normalizedFileBaseName === normalizedSearchName;
            });
            
            if (maskFile) {
                const fileNameParts = maskFile.split('_');
                const layerTag = fileNameParts[0] + '_' + fileNameParts[1];
                const url = `/assets/${path.basename(genreDir)}/${maskFile}`;
                if (!masksByLayer[layerTag]) masksByLayer[layerTag] = [];
                masksByLayer[layerTag].push(url);

                if (traitType === 'Face') {
                    faceMaskUrls.push(url);
                }
            }
        });
        
        res.json({ 
            maskUrlsByLayer: masksByLayer,
            faceMaskUrls: faceMaskUrls
        });

    } catch (error) {
        console.error('階層別マスク画像取得エラー:', error);
        res.status(500).json({ error: '階層別マスク画像の取得に失敗しました。' });
    }
});

// 補完マスク画像検索エンドポイント
app.get('/api/get-recovery-masks-by-layers', (req, res) => {
    const { traits, tokenId } = req.query; 
    if (!traits) {
        return res.status(400).json({ error: 'パーツ情報が指定されていません。' });
    }
    try {
        const parsedTraits = JSON.parse(traits);
        const masksByLayer = {};
        const recoveryAssetsDir = path.join(__dirname, 'recovery_assets');

        if (!fs.existsSync(recoveryAssetsDir)) {
            console.error(`★ Recovery: recovery_assetsディレクトリが見つかりません: ${recoveryAssetsDir}`);
            return res.status(404).json({ error: `recovery_assetsディレクトリが見つかりません: ${recoveryAssetsDir}` });
        }
        const allTokenExceptions = loadTokenExceptions();
        const currentTokenException = (tokenId && allTokenExceptions[tokenId]) ? allTokenExceptions[tokenId] : null;
        const scarfExceptionValues = [
            "Black Scarf",
            "White Scarf",
            "Khaki Scarf",
            "Multicolor Scarf Black",
            "Multicolor Scarf White"
        ];

        let isScarfException = parsedTraits.some(trait => 
            trait.trait_type === 'Body Layer' && 
            scarfExceptionValues.includes(trait.value)
        );

        if (isScarfException) {
            console.log("★ スカーフ例外を検出: 'Accessory Neck' の補完マスク検索をスキップします。");
        }

        // ▼▼▼ Long with Bucket Hat 例外の定義 (補完用) ▼▼▼
        const bucketHatExceptionValues = [
            "Long Black with Bucket Hat",
            "Long Blue Green with Bucket Hat",
            "Long Gold with Bucket Hat",
            "Long Green with Bucket Hat",
            "Long Pink with Bucket Hat",
            "Long Purple with Bucket Hat",
            "Long White Ash with Bucket Hat",
            "Long White with Bucket Hat"
        ];

        const isBucketHatException = parsedTraits.some(trait => 
            trait.trait_type === 'Hair and Hat' && 
            bucketHatExceptionValues.includes(trait.value.trim())
        );

        parsedTraits.forEach(trait => {
            if (isScarfException && trait.trait_type === 'Accessory Neck') {
                console.log(` -> スキップ: ${trait.trait_type} (${trait.value})`);
                return; 
            }

            // ▼▼▼ Bucket Hat 例外の適用 (Headスキップ) ▼▼▼
            if (isBucketHatException && trait.trait_type === 'Head') {
                console.log(` -> スキップ (Recovery): ${trait.trait_type} (${trait.value}) [Bucket Hat Conflict]`);
                return; 
            }

            if (currentTokenException) {
                // 配列対応: 単一オブジェクトなら配列に変換
                const exceptionsList = Array.isArray(currentTokenException) ? currentTokenException : [currentTokenException];
                
                // 現在のTraitにマッチする例外を探す
                const matchedEx = exceptionsList.find(ex => ex.trait_type === trait.trait_type);

                if (matchedEx) {
                    // 1. 検索スキップ
                    if (matchedEx.type === 'SKIP_TRAIT') {
                        console.log(`★ ID ${tokenId} 例外適用 (Recovery): Trait "${trait.trait_type}" のマスク検索をスキップします。`);
                        return; 
                    }
                    // 2. 補完マスクの上書き
                    if (matchedEx.type === 'OVERRIDE_RECOVERY') {
                        console.log(`★ ID ${tokenId} 例外適用 (OVERRIDE_RECOVERY): Trait "${trait.trait_type}" の補完マスクを ${matchedEx.url} で上書きします。`);
                        const targetLayer = matchedEx.layer;
                        if (!masksByLayer[targetLayer]) masksByLayer[targetLayer] = [];
                        masksByLayer[targetLayer].push(matchedEx.url);
                        return; 
                    }
                }
            }
            
            let partName = trait.value.trim();
            let traitType = trait.trait_type;
            let genreDir = path.join(recoveryAssetsDir, traitType);

            if (!fs.existsSync(genreDir)) {
                return;
            }

            const aliasFileName = `mask_${traitType.toLowerCase().replace(/\s/g, '_')}_aliases.json`;
            const aliasFilePath = path.join(__dirname, aliasFileName);
            let searchName = partName; 

            const files = fs.readdirSync(genreDir);
            const normalizedSearchName = normalizeString(partName);
            
            const recoveryFile = files.find(file => {
                const baseFileNameMatch = file.match(/^(?:recovery_layer\d+_)?(.*)\.png$/i);
                if (!baseFileNameMatch || baseFileNameMatch.length < 2) return false;
                const baseFileName = baseFileNameMatch[1];
                const normalizedFileBaseName = normalizeString(baseFileName);
                return normalizedFileBaseName === normalizedSearchName;
            });

            if (recoveryFile) {
                const fileNameParts = recoveryFile.split('_');
                let layerTag = fileNameParts[0] + '_' + fileNameParts[1];

                // layerTag が 'recovery_layer2' の場合、フォルダ名(traitType) に基づいて描画順序を制御するための新しいタグに再割り当てする
                if (layerTag === 'recovery_layer2') {
                    if (traitType === 'Body Layer') {
                        // 後ろ側
                        layerTag = 'recovery_layer2_body'; 
                        
                    } else if (traitType === 'Face Accessories') {
                        // 前側
                        layerTag = 'recovery_layer2_face';
                    }
                }
                
                const url = `/recovery_assets/${path.basename(genreDir)}/${recoveryFile}`;
                if (!masksByLayer[layerTag]) masksByLayer[layerTag] = [];
                masksByLayer[layerTag].push(url);
            }
        });
        
        console.log("★ Recovery: 補完マスクの検索結果:", masksByLayer); // デバッグログ追加
        res.json({ maskUrlsByLayer: masksByLayer });

    } catch (error) {
        console.error('階層別補完マスク画像取得エラー:', error);
        res.status(500).json({ error: '階層別補完マスク画像の取得に失敗しました。' });
    }
});

// トークンIDごとの例外設定ファイルを配信するAPI
app.get('/api/get-token-exceptions', (req, res) => {
    console.log('--- /api/get-token-exceptions へのリクエストを受信しました ---');
    const exceptionsFilePath = path.join(__dirname, 'token_exceptions.json');

    if (fs.existsSync(exceptionsFilePath)) {
        res.sendFile(exceptionsFilePath);
    } else {
        console.error('token_exceptions.json が見つかりません。');
        res.json({}); 
    }
});

const debugOutputDir = path.join(__dirname, 'debug_output');
if (!fs.existsSync(debugOutputDir)) {
    fs.mkdirSync(debugOutputDir);
}

app.post('/api/save-debug-image', (req, res) => {
    const { filename, imageData } = req.body;

    if (!filename || !imageData) {
        return res.status(400).json({ error: 'ファイル名またはデータが不足しています。' });
    }

    // Base64ヘッダー (data:image/png;base64,) を除去
    const base64Data = imageData.replace(/^data:image\/png;base64,/, "");
    const savePath = path.join(debugOutputDir, filename);

    fs.writeFile(savePath, base64Data, 'base64', (err) => {
        if (err) {
            console.error(`画像の保存に失敗: ${filename}`, err);
            return res.status(500).json({ error: '保存に失敗しました' });
        }
        console.log(`保存完了: ${filename}`);
        res.json({ success: true });
    });
});


app.listen(PORT, () => {
    console.log(`サーバーが http://localhost:${PORT} で起動しました`);
    console.log(`デバッグ出力先: ${debugOutputDir}`);
});