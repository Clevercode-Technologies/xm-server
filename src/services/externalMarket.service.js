import axios from "axios";

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

const SYMBOL_MAP = {
  // Forex
  EURUSD: "EURUSD=X", GBPUSD: "GBPUSD=X", USDJPY: "USDJPY=X", AUDUSD: "AUDUSD=X",
  USDCAD: "USDCAD=X", USDCHF: "USDCHF=X", NZDUSD: "NZDUSD=X", EURGBP: "EURGBP=X",
  EURJPY: "EURJPY=X", GBPJPY: "GBPJPY=X", USDCNH: "USDCNH=X", USDMXN: "USDMXN=X",
  USDSEK: "USDSEK=X", USDSGD: "USDSGD=X", USDNOK: "USDNOK=X", USDZAR: "USDZAR=X",
  AUDJPY: "AUDJPY=X", CADJPY: "CADJPY=X", CHFJPY: "CHFJPY=X", EURAUD: "EURAUD=X",
  EURCAD: "EURCAD=X",
  // Commodities
  XAUUSD: "GC=F", XAGUSD: "SI=F", USOIL: "CL=F", UKOIL: "BZ=F", NATGAS: "NG=F",
  XPTUSD: "PL=F", XPDUSD: "PA=F", COPPER: "HG=F", WHEAT: "ZW=F", CORN: "ZC=F",
  SOYBEAN: "ZS=F", COFFEE: "KC=F", SUGAR: "SB=F", COCOA: "CC=F", COTTON: "CT=F",
  // Indices
  US500: "^GSPC", US100: "^NDX", US30: "^DJI", GER40: "^GDAXI", UK100: "^FTSE",
  FRA40: "^FCHI", JPN225: "^N225", HK50: "^HSI", AUS200: "^AXJO", ESP35: "^IBEX",
  EUSTX50: "^STOXX50E", VIX: "^VIX", US2000: "^RUT", IND50: "^NSEI", CHINA50: "000300.SS",
};

const yahooSymbols = Object.keys(SYMBOL_MAP);

export function isYahooSymbol(symbol) {
  return Boolean(SYMBOL_MAP[symbol.toUpperCase()]);
}

export function getYahooSymbols() {
  return yahooSymbols;
}

export async function fetchYahooQuote(symbol) {
  const normalized = symbol.toUpperCase();
  const yahooSymbol = SYMBOL_MAP[normalized];
  if (!yahooSymbol) return null;

  try {
    const { data } = await axios.get(`${YAHOO_BASE}/${encodeURIComponent(yahooSymbol)}`, {
      params: { range: "1d", interval: "1m" },
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const price = Number(meta.regularMarketPrice) || 0;
    const prevClose = Number(meta.chartPreviousClose || meta.previousClose || price);
    const change24h = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

    return {
      symbol: normalized,
      pair: normalized,
      price,
      change24h: Number(change24h.toFixed(4)),
      volume24h: Number(meta.regularMarketVolume) || 0,
      category: getCategory(normalized),
      high24h: Number(meta.regularMarketDayHigh) || 0,
      low24h: Number(meta.regularMarketDayLow) || 0,
    };
  } catch (error) {
    console.error(`[externalMarket] fetchYahooQuote(${normalized}) failed:`, error?.message || error);
    return null;
  }
}

export async function fetchYahooQuotes(symbols) {
  const results = await Promise.all(
    symbols.map((s) => fetchYahooQuote(s).catch(() => null))
  );
  return results.filter(Boolean);
}

function getCategory(symbol) {
  if (symbol.startsWith("X") || ["USOIL", "UKOIL", "NATGAS", "COPPER", "WHEAT", "CORN", "SOYBEAN", "COFFEE", "SUGAR", "COCOA", "COTTON"].includes(symbol)) {
    return "commodities";
  }
  if (["US500", "US100", "US30", "GER40", "UK100", "FRA40", "JPN225", "HK50", "AUS200", "ESP35", "EUSTX50", "VIX", "US2000", "IND50", "CHINA50"].includes(symbol)) {
    return "indices";
  }
  return "forex";
}
