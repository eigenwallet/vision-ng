import * as vega from 'vega';
import * as vl from 'vega-lite';
import { getCache, setCache } from './cache';

const LIQUIDITY_DAILY_API_URL = 'https://api.unstoppableswap.net/api/liquidity-daily';
const LIST_API_URL = 'https://api.unstoppableswap.net/api/list';
const PROVIDER_QUOTE_STATS_API_URL = 'https://api.unstoppableswap.net/api/provider-quote-stats';
const PROVIDER_DAILY_SWAP_BOUNDS_API_URL = 'https://api.unstoppableswap.net/api/provider-daily-swap-bounds';
const CACHE_KEY = 'liquidity-daily';
const OFFERS_CACHE_KEY = 'offers-list';
const PROVIDERS_CACHE_KEY = 'provider-quote-stats';
const PROVIDER_BOUNDS_CACHE_KEY = 'provider-daily-swap-bounds';

const FALLBACK_SVG = `<svg viewBox="0 0 800 200" preserveAspectRatio="xMidYMid meet" style="width:100%; height:auto; display:block;">
  <text x="400" y="100" text-anchor="middle" fill="#666">No data available</text>
</svg>`;

interface LiquidityDayData {
  date: number[]; // [year, day_of_year]
  totalLiquidityBtc: number;
}

export interface LiquidityData {
  chartSvg: string;
}

export interface Offer {
  peerId: string;
  multiAddr: string;
  price: number; // satoshis per XMR
  minSwapAmount: number; // in satoshis
  maxSwapAmount: number; // in satoshis
  testnet: boolean;
}

export interface ProviderQuoteStats {
  peer_id: string;
  multi_address: string;
  max_max_swap_amount: number; // in satoshis
  min_min_swap_amount: number; // in satoshis
  online_days: number;
  age_days: number;
  last_seen_ago_days: number;
}

export interface ProviderDailySwapBounds {
  day: string; // YYYY-MM-DD format
  peer_id: string;
  daily_max_max_swap_amount: number; // in satoshis
  daily_min_min_swap_amount: number; // in satoshis
}

const SATOSHIS_PER_BTC = 100000000;

/**
 * Fetch liquidity data from API with caching
 */
async function fetchLiquidityData(): Promise<LiquidityDayData[] | null> {
  // Check cache first
  const cached = getCache<LiquidityDayData[]>(CACHE_KEY);
  if (cached) {
    return cached;
  }

  try {
    console.log('Fetching liquidity data from API...');
    const response = await fetch(LIQUIDITY_DAILY_API_URL);
    
    if (!response.ok) {
      console.warn(`Liquidity API responded with status: ${response.status}`);
      return null;
    }

    const data: LiquidityDayData[] = await response.json();
    setCache(CACHE_KEY, data);
    return data;
  } catch (error) {
    console.warn('Failed to fetch liquidity data:', error);
    return null;
  }
}

/**
 * Generate SVG chart for liquidity data using Vega-Lite
 */
async function generateLiquidityChart(liquidityData: LiquidityDayData[]): Promise<string> {
  if (liquidityData.length === 0) {
    return FALLBACK_SVG;
  }

  // Transform data for Vega-Lite
  const chartData = liquidityData.map(d => {
    const year = d.date[0];
    const dayOfYear = d.date[1];
    const date = new Date(year, 0, dayOfYear);
    
    return {
      date: date.toISOString().split('T')[0],
      liquidity: d.totalLiquidityBtc
    };
  }).reverse(); // Show chronological order (oldest to newest)

  const spec: vl.TopLevelSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: 750,
    height: 400,
    background: 'transparent',
    padding: { left: 0, right: 0, top: 0, bottom: 0 },
    data: { values: chartData },
    layer: [
      // Area fill
      {
        mark: {
          type: 'area',
          color: '#ff6b35',
          opacity: 0.15,
          line: false
        },
        encoding: {
          x: {
            title: null,
            field: 'date',
            type: 'temporal',
            axis: {
              format: '%b %d',
              labelAngle: 0,
              labelFontSize: 14,
              labelColor: '#666',
              tickColor: 'transparent',
              domainColor: 'transparent',
              grid: false
            }
          },
          y: {
            title: null,
            field: 'liquidity',
            type: 'quantitative',
            axis: {
              labelFontSize: 14,
              labelColor: '#666',
              tickColor: 'transparent',
              domainColor: 'transparent',
              grid: false,
              labelExpr: 'datum.value == 0 ? "" : format(datum.value, ".0f") + " BTC"'
            }
          }
        }
      },
      // Line
      {
        mark: {
          type: 'line',
          color: '#ff6b35',
          strokeWidth: 2,
          strokeCap: 'round',
          strokeJoin: 'round'
        },
        encoding: {
          x: { field: 'date', type: 'temporal' },
          y: { field: 'liquidity', type: 'quantitative' }
        }
      }
    ]
  };

  try {
    const vegaSpec = vl.compile(spec).spec;
    const view = new vega.View(vega.parse(vegaSpec), { renderer: 'none' });
    const svg = await view.toSVG();
    // Remove fixed width/height and make responsive using viewBox
    return svg
      .replace(/\s*width="[^"]*"/, '')
      .replace(/\s*height="[^"]*"/, '')
      .replace('<svg', '<svg style="width: 100%; height: auto; display: block;"');
  } catch (error) {
    console.error('Failed to generate liquidity chart:', error);
    return FALLBACK_SVG;
  }
}

/**
 * Get liquidity chart SVG
 */
export async function getLiquidityData(): Promise<LiquidityData> {
  const liquidityData = await fetchLiquidityData();
  const chartSvg = liquidityData 
    ? await generateLiquidityChart(liquidityData)
    : FALLBACK_SVG;

  return { chartSvg };
}

/**
 * Fetch current offers from API with caching
 */
export async function fetchOffers(): Promise<Offer[]> {
  const cached = getCache<Offer[]>(OFFERS_CACHE_KEY);
  if (cached) {
    return cached;
  }

  try {
    console.log('Fetching offers data from API...');
    const response = await fetch(LIST_API_URL);
    
    if (!response.ok) {
      console.warn(`List API responded with status: ${response.status}`);
      return [];
    }

    const data: Offer[] = await response.json();
    // Filter out testnet offers
    const mainnetOffers = data.filter(offer => !offer.testnet);
    setCache(OFFERS_CACHE_KEY, mainnetOffers);
    return mainnetOffers;
  } catch (error) {
    console.warn('Failed to fetch offers data:', error);
    return [];
  }
}

/**
 * Format satoshis to BTC string
 */
export function satoshisToBtc(satoshis: number): string {
  const btc = satoshis / SATOSHIS_PER_BTC;
  if (btc >= 1) {
    return btc.toFixed(4);
  }
  return btc.toFixed(6);
}

/**
 * Format price (satoshis per XMR) to readable format
 */
export function formatPrice(satoshisPerXmr: number): string {
  const btcPerXmr = satoshisPerXmr / SATOSHIS_PER_BTC;
  return btcPerXmr.toFixed(6);
}

/**
 * Convert BTC (satoshis) to XMR based on offer price
 * price is satoshis per XMR
 */
export function btcToXmr(satoshis: number, priceInSatoshisPerXmr: number): string {
  const xmr = satoshis / priceInSatoshisPerXmr;
  if (xmr >= 100) {
    return xmr.toFixed(1);
  } else if (xmr >= 10) {
    return xmr.toFixed(2);
  }
  return xmr.toFixed(3);
}

/**
 * Fetch provider quote stats from API with caching
 */
export async function fetchProviderStats(): Promise<ProviderQuoteStats[]> {
  const cached = getCache<ProviderQuoteStats[]>(PROVIDERS_CACHE_KEY);
  if (cached) {
    return cached;
  }

  try {
    console.log('Fetching provider stats from API...');
    const response = await fetch(PROVIDER_QUOTE_STATS_API_URL);
    
    if (!response.ok) {
      console.warn(`Provider stats API responded with status: ${response.status}`);
      return [];
    }

    const data: ProviderQuoteStats[] = await response.json();
    // Filter to providers with more than 1 online day
    const filtered = data.filter(p => p.online_days > 1);
    setCache(PROVIDERS_CACHE_KEY, filtered);
    return filtered;
  } catch (error) {
    console.warn('Failed to fetch provider stats:', error);
    return [];
  }
}

/**
 * Fetch provider daily swap bounds from API with caching
 */
export async function fetchProviderDailyBounds(): Promise<ProviderDailySwapBounds[]> {
  const cached = getCache<ProviderDailySwapBounds[]>(PROVIDER_BOUNDS_CACHE_KEY);
  if (cached) {
    return cached;
  }

  try {
    console.log('Fetching provider daily bounds from API...');
    const response = await fetch(PROVIDER_DAILY_SWAP_BOUNDS_API_URL);
    
    if (!response.ok) {
      console.warn(`Provider daily bounds API responded with status: ${response.status}`);
      return [];
    }

    const data: ProviderDailySwapBounds[] = await response.json();
    setCache(PROVIDER_BOUNDS_CACHE_KEY, data);
    return data;
  } catch (error) {
    console.warn('Failed to fetch provider daily bounds:', error);
    return [];
  }
}

/**
 * Get provider by peer ID
 */
export async function getProviderById(peerId: string): Promise<ProviderQuoteStats | null> {
  const providers = await fetchProviderStats();
  return providers.find(p => p.peer_id === peerId) || null;
}

/**
 * Get historical bounds for a specific provider
 */
export async function getProviderHistoricalBounds(peerId: string): Promise<ProviderDailySwapBounds[]> {
  const bounds = await fetchProviderDailyBounds();
  return bounds
    .filter(b => b.peer_id === peerId)
    .sort((a, b) => new Date(a.day).getTime() - new Date(b.day).getTime());
}

/**
 * Format days ago into readable string
 */
export function formatDaysAgo(days: number | null | undefined): string {
  if (days === null || days === undefined || Number.isNaN(days)) {
    return 'Unknown';
  }
  if (days < 0) {
    return 'Unknown';
  }
  if (days === 0) {
    return 'today';
  }
  if (days === 1) {
    return '1 day ago';
  }
  return `${days} days ago`;
}

/**
 * Generate historical chart for a provider
 */
export async function generateProviderChart(peerId: string): Promise<string> {
  const historicalData = await getProviderHistoricalBounds(peerId);
  
  if (historicalData.length === 0) {
    return `<svg viewBox="0 0 800 200" preserveAspectRatio="xMidYMid meet" style="width:100%; height:auto; display:block;">
      <text x="400" y="100" text-anchor="middle" fill="#666">No historical data available</text>
    </svg>`;
  }

  const chartData = historicalData.map(d => ({
    date: d.day,
    maxSwap: d.daily_max_max_swap_amount / SATOSHIS_PER_BTC,
  }));

  const spec: vl.TopLevelSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: 750,
    height: 400,
    background: 'transparent',
    padding: { left: 0, right: 0, top: 0, bottom: 0 },
    data: { values: chartData },
    layer: [
      {
        mark: {
          type: 'area',
          color: '#ff6b35',
          opacity: 0.15,
          line: false
        },
        encoding: {
          x: {
            title: null,
            field: 'date',
            type: 'temporal',
            axis: {
              format: '%b %d',
              labelAngle: 0,
              labelFontSize: 14,
              labelColor: '#666',
              tickColor: 'transparent',
              domainColor: 'transparent',
              grid: false
            }
          },
          y: {
            title: null,
            field: 'maxSwap',
            type: 'quantitative',
            axis: {
              labelFontSize: 14,
              labelColor: '#666',
              tickColor: 'transparent',
              domainColor: 'transparent',
              grid: false,
              labelExpr: 'format(datum.value, ".3f") + " BTC"'
            }
          }
        }
      },
      {
        mark: {
          type: 'line',
          color: '#ff6b35',
          strokeWidth: 2,
          strokeCap: 'round',
          strokeJoin: 'round'
        },
        encoding: {
          x: { field: 'date', type: 'temporal' },
          y: { field: 'maxSwap', type: 'quantitative' }
        }
      }
    ]
  };

  try {
    const vegaSpec = vl.compile(spec).spec;
    const view = new vega.View(vega.parse(vegaSpec), { renderer: 'none' });
    const svg = await view.toSVG();
    // Remove fixed width/height and make responsive
    return svg
      .replace(/width="[^"]*"/, 'width="100%"')
      .replace(/height="[^"]*"/, 'height="auto"')
      .replace('<svg', '<svg style="display: block;"');
  } catch (error) {
    console.error('Failed to generate provider chart:', error);
    return `<svg viewBox="0 0 800 200" preserveAspectRatio="xMidYMid meet" style="width:100%; height:auto; display:block;">
      <text x="400" y="100" text-anchor="middle" fill="#666">Chart generation failed</text>
    </svg>`;
  }
}
