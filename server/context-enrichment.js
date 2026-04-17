// server/context-enrichment.js — 天気・祝日・季節イベントのコンテキスト生成

const TOKYO_LAT = 35.6762;
const TOKYO_LON = 139.6503;
const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000; // 30分

let weatherCache = { data: null, fetchedAt: 0 };

const WMO_WEATHER_CODES = {
  0: '快晴', 1: '晴れ', 2: 'やや曇り', 3: '曇り',
  45: '霧', 48: '霧（霜あり）',
  51: '小雨', 53: '雨', 55: '強い雨',
  56: '冷たい小雨', 57: '冷たい雨',
  61: '小雨', 63: '雨', 65: '大雨',
  66: '冷たい雨', 67: '冷たい大雨',
  71: '小雪', 73: '雪', 75: '大雪',
  77: '霰', 80: 'にわか雨', 81: '強いにわか雨', 82: '激しいにわか雨',
  85: '小雪', 86: '大雪', 95: '雷雨', 96: '雷雨（雹）', 99: '激しい雷雨',
};

/**
 * Open-Meteo JMA APIで東京の現在の天気を取得（APIキー不要）
 */
export async function fetchWeather() {
  const now = Date.now();
  if (weatherCache.data && now - weatherCache.fetchedAt < WEATHER_CACHE_TTL_MS) {
    return weatherCache.data;
  }

  try {
    const url = `https://api.open-meteo.com/v1/jma?latitude=${TOKYO_LAT}&longitude=${TOKYO_LON}&current=temperature_2m,weather_code,apparent_temperature,wind_speed_10m&timezone=Asia/Tokyo`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const current = json?.current;
    if (!current) throw new Error('no current data');

    const data = {
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature),
      weatherCode: current.weather_code,
      weatherText: WMO_WEATHER_CODES[current.weather_code] || '不明',
      windSpeed: Math.round(current.wind_speed_10m),
    };

    weatherCache = { data, fetchedAt: now };
    console.log(`[context] weather: ${data.weatherText} ${data.temperature}°C`);
    return data;
  } catch (err) {
    console.warn('[context] weather fetch failed:', err?.message);
    return null;
  }
}

/**
 * 天気��報を自然な日本語の会話ヒントに変換
 */
export function formatWeatherContext(weather) {
  if (!weather) return null;
  const { temperature, weatherText, weatherCode, feelsLike, windSpeed } = weather;

  const parts = [`今日の天気: ${weatherText}、気温${temperature}°C`];

  if (Math.abs(temperature - feelsLike) >= 3) {
    parts.push(`体感温度は${feelsLike}°C`);
  }
  if (windSpeed >= 10) {
    parts.push('風が強い');
  }

  // 会話のきっかけヒント
  let hint = '';
  if (weatherCode >= 51 && weatherCode <= 67) {
    hint = '雨の日。「雨大丈夫でした？」「足元濡れませんでした？」のように天気に触れてもいい';
  } else if (weatherCode >= 71 && weatherCode <= 86) {
    hint = '雪の日。「雪降ってますね！寒くなかったですか？」と声をかけてもいい';
  } else if (weatherCode >= 95) {
    hint = '雷雨。「外すごくなかったですか？」と心配��てもいい';
  } else if (temperature >= 30) {
    hint = '暑い日。「今日暑いですね〜。水分取ってますか？」と気遣ってもいい';
  } else if (temperature <= 5) {
    hint = '寒い日。「寒くなかったですか？」と気遣ってもいい';
  } else if (weatherCode <= 1) {
    hint = 'いい天気。「今日いい天気ですね！」と明るく始めてもいい';
  }

  return { description: parts.join('、'), hint };
}

// --- 日本の祝日・季節イベント ---

const JAPANESE_HOLIDAYS = {
  '01-01': '元日',
  '01-13': '成人の日（付近）',
  '02-11': '建国記念の日',
  '02-14': 'バレンタインデー',
  '02-23': '天皇誕生日',
  '03-03': 'ひな祭り',
  '03-14': 'ホワイトデー',
  '03-20': '春分の日（付近）',
  '04-29': '昭和の日',
  '05-03': '憲法記念日',
  '05-04': 'みどりの日',
  '05-05': 'こどもの日',
  '07-07': '七夕',
  '07-21': '海の日（付近）',
  '08-11': '山の日',
  '08-13': 'お盆（付近）',
  '08-14': 'お盆（付近）',
  '08-15': 'お盆（付近）',
  '09-15': '敬老の日（付近）',
  '09-22': '秋分の日（付近）',
  '10-14': 'スポーツの日（付近）',
  '10-31': 'ハロウィン',
  '11-03': '文化の日',
  '11-23': '勤労感謝の日',
  '12-24': 'クリスマスイブ',
  '12-25': 'クリスマス',
  '12-31': '大晦日',
};

const SEASONAL_EVENTS = [
  { start: '03-20', end: '04-10', event: '桜のシーズン', hint: '桜の話をしてもいい（「お花見とか�����ました？」）' },
  { start: '06-01', end: '07-20', event: '梅雨の時期', hint: '梅雨の話（「ジメジメしますよね〜」）' },
  { start: '07-20', end: '08-31', event: '夏本番', hint: '夏の話（「夏休みの予定���かあります？」「かき氷食べたいですね〜」）' },
  { start: '09-15', end: '10-31', event: '秋', hint: '秋の話（「���欲の秋ですね」「紅葉の時期ですね」）' },
  { start: '12-01', end: '12-31', event: '年末', hint: '年末の話（「もう年��ですね〜。今年どんな年でした？」）' },
  { start: '04-29', end: '05-06', event: 'ゴールデンウィーク', hint: '「GWはどう過ごしますか？」' },
];

/**
 * 今日の祝日・イベントコンテキストを取得
 */
export function getSeasonalContext() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // JST
  const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const parts = [];

  // 祝日チェック
  const holiday = JAPANESE_HOLIDAYS[mmdd];
  if (holiday) {
    parts.push({ type: 'holiday', name: holiday, hint: `今日は${holiday}。さりげなく触れてもいい` });
  }

  // 季節イベントチェック
  for (const event of SEASONAL_EVENTS) {
    if (mmdd >= event.start && mmdd <= event.end) {
      parts.push({ type: 'season', name: event.event, hint: event.hint });
      break;
    }
  }

  // 明日が祝日かチェック（前日の話題として）
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tmrMmdd = `${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const tmrHoliday = JAPANESE_HOLIDAYS[tmrMmdd];
  if (tmrHoliday && !holiday) {
    parts.push({ type: 'upcoming', name: tmrHoliday, hint: `明日は${tmrHoliday}。「明日は${tmrHoliday}ですね！」的に触れてもいい` });
  }

  return parts.length > 0 ? parts : null;
}
