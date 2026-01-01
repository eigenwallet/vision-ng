import { getCache, setCache } from './cache';
import 'dotenv/config';

const GITHUB_API_BASE = 'https://api.github.com/repos/eigenwallet/core';
const GITHUB_RELEASES_API = `${GITHUB_API_BASE}/releases/latest`;

function getGitHubHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Accept': 'application/vnd.github+json',
  };

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

export interface DownloadAsset {
  name: string;
  downloadUrl: string;
  signatureUrl: string;
  size: string;
  architecture: string;
  platform: string;
  type: 'executable' | 'appimage' | 'installer' | 'bundle' | 'archive' | 'instructions';
}

export interface ReleaseInfo {
  version: string;
  releaseDate: string;
  assets: DownloadAsset[];
}

async function fetchGitHubRelease(): Promise<any> {
  const cacheKey = 'github-release-latest';
  let release = getCache<any>(cacheKey);

  if (!release) {
    console.log('Fetching fresh GitHub release data...');
    const response = await fetch(GITHUB_RELEASES_API, {
      headers: getGitHubHeaders()
    });
    if (!response.ok) {
      throw new Error(`GitHub API responded with status: ${response.status}`);
    }
    release = await response.json();
    setCache(cacheKey, release);
  }

  return release;
}

function filterWalletAssets(assets: any[]): any[] {
  return assets.filter((asset: any) =>
    asset.name.startsWith('eigenwallet_') &&
    !asset.name.endsWith('.sig') &&
    !asset.name.endsWith('.asc')
  );
}

function createAssetUrlMap(assets: any[]): Map<string, string> {
  return new Map(assets.map((a: any) => [a.name, a.browser_download_url]));
}

function transformAsset(asset: any, signatureUrl: string): DownloadAsset {
  const { platform, architecture, type } = parseAssetName(asset.name);

  return {
    name: getDisplayName(asset.name),
    downloadUrl: asset.browser_download_url,
    signatureUrl,
    size: formatFileSize(asset.size),
    architecture,
    platform,
    type
  };
}

function createSpecialInstallMethods(): DownloadAsset[] {
  return [
    {
      name: "Flatpak",
      downloadUrl: "/flatpak",
      signatureUrl: "",
      size: "",
      architecture: "x86_64 <span style='float: right;'>Flatpak</span>",
      platform: "Linux",
      type: "instructions"
    },
    {
      name: "AUR",
      downloadUrl: "/download#aur",
      signatureUrl: "",
      size: "",
      architecture: "x86_64 <span style='float: right;'>AUR</span>",
      platform: "Linux",
      type: "instructions"
    }
  ];
}

export async function fetchLatestRelease(): Promise<ReleaseInfo> {
  const release = await fetchGitHubRelease();

  const walletAssets = filterWalletAssets(release.assets);
  const assetNameToUrl = createAssetUrlMap(release.assets);

  const assets: DownloadAsset[] = walletAssets.map((asset: any) => {
    const signatureUrl = assetNameToUrl.get(`${asset.name}.asc`) || '';
    return transformAsset(asset, signatureUrl);
  });

  assets.push(...createSpecialInstallMethods());

  const version = release.tag_name.replace(/^v/, '');
  const releaseDate = new Date(release.published_at).toISOString().split('T')[0];

  return {
    version,
    releaseDate,
    assets
  };
}

export interface QuickDownloadUrls {
  windows: string;
  macosSilicon: string;
  macosIntel: string;
  linux: string;
}

export async function getQuickDownloadUrls(): Promise<QuickDownloadUrls> {
  const release = await fetchGitHubRelease();
  const assets = (release.assets || []).filter((a: any) => 
    a.name.startsWith('eigenwallet_') && !a.name.endsWith('.sig') && !a.name.endsWith('.asc')
  );

  const findAsset = (predicate: (name: string) => boolean): string => {
    const asset = assets.find((a: any) => predicate(a.name.toLowerCase()));
    return asset?.browser_download_url || '/download';
  };

  const isArm = (name: string) => name.includes('aarch64') || name.includes('arm64');
  const isX86 = (name: string) => name.includes('x86_64') || name.includes('x64') || name.includes('amd64');

  return {
    windows: findAsset(name => name.endsWith('.exe')),
    macosSilicon: findAsset(name => name.endsWith('.dmg') && isArm(name)),
    macosIntel: findAsset(name => name.endsWith('.dmg') && isX86(name)),
    linux: '/flatpak'
  };
}

function detectPlatform(name: string): string {
  // Check for Linux-specific formats first (before .app check to avoid .appimage false positive)
  if (name.includes('linux') || name.includes('.appimage') || name.includes('.deb') || name.includes('.rpm')) return "Linux";

  // Check for macOS (use .app.tar.gz or .dmg to avoid .appimage false positive)
  if (name.includes('darwin') || name.includes('macos') || name.includes('.dmg') || name.includes('.app.tar.gz')) return "macOS";

  // Check for Windows
  if (name.includes('windows') || name.includes('win') || name.includes('.exe') || name.includes('.msi')) return "Windows";

  return "Unknown";
}

function detectAssetType(name: string): DownloadAsset['type'] {
  if (name.includes('.exe')) return "executable";
  if (name.includes('.msi') || name.includes('.deb') || name.includes('.rpm')) return "installer";
  if (name.includes('.dmg') || name.includes('.app.tar.gz')) return "bundle";
  if (name.includes('.appimage')) return "appimage";
  return "archive";
}

function formatArchitecture(name: string, platform: string): string {
  const isAppImage = name.includes('.appimage');
  const isDebian = name.includes('.deb');
  // Match x86_64, amd64, or x64 patterns
  const isX86 = name.includes('x86_64') || name.includes('amd64') || name.includes('x64');
  const isArm = name.includes('aarch64') || name.includes('arm64');

  if (isX86) {
    if (platform === "macOS") {
      const macReleaseType = name.includes('.dmg') ? 'DMG' : name.includes('.app.tar.gz') ? 'Bundle' : 'Binary';
      return `Intel <span style='float: right;'>${macReleaseType}</span>`;
    }
    if (isAppImage) return "x86_64 <span style='float: right;'>AppImage</span>";
    if (isDebian) return "x86_64 <span style='float: right;'>Debian</span>";
    return "x86_64";
  }

  if (isArm) {
    if (platform === "macOS") {
      const macReleaseType = name.includes('.dmg') ? 'DMG' : name.includes('.app.tar.gz') ? 'Bundle' : 'Binary';
      return `Silicon <span style='float: right;'>${macReleaseType}</span>`;
    }
    return "ARM64";
  }

  return "";
}

function parseAssetName(assetName: string): { platform: string; architecture: string; type: DownloadAsset['type'] } {
  const name = assetName.toLowerCase();
  const platform = detectPlatform(name);
  const architecture = formatArchitecture(name, platform);
  const type = detectAssetType(name);

  return { platform, architecture, type };
}

function getDisplayName(assetName: string): string {
  const name = assetName.toLowerCase();

  if (name.includes('.dmg')) return 'DMG Installer';
  if (name.includes('.appimage')) return 'AppImage';
  if (name.includes('.deb')) return 'DEB Package';
  if (name.includes('.rpm')) return 'RPM Package';
  if (name.includes('.msi')) return 'MSI Installer';
  if (name.includes('.exe')) return 'Executable';
  if (name.includes('.app.tar.gz')) return 'macOS App Bundle';
  if (name.includes('.tar')) return 'TAR Archive';
  if (name.includes('.zip')) return 'ZIP Archive';

  return 'Archive';
}

function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${Math.round(size)} ${units[unitIndex]}`;
}

const PLATFORM_ORDER = ['Linux', 'Windows', 'macOS'];

const PLATFORM_ICONS: Record<string, string> = {
  Linux: '<img src="/icons/os-linux.svg" width="20" height="20" alt="Linux" style="display:inline-block;vertical-align:middle;"/>',
  Windows: '<img src="/icons/os-windows.svg" width="20" height="20" alt="Windows" style="display:inline-block;vertical-align:middle;"/>',
  macOS: '<img src="/icons/os-macos.svg" width="20" height="20" alt="macOS" style="display:inline-block;vertical-align:middle;"/>'
};

export function generateGuiTable(releaseInfo: ReleaseInfo): string {
  const guiAssets = releaseInfo.assets.filter(asset =>
    asset.downloadUrl.includes('eigenwallet_') || asset.type === 'instructions'
  );

  return generateTable(guiAssets);
}

export function generateCliTable(releaseInfo: ReleaseInfo): string {
  const cliAssets = releaseInfo.assets.filter(asset =>
    asset.downloadUrl.includes('asb_') ||
    asset.downloadUrl.includes('swap_') ||
    asset.downloadUrl.includes('orchestrator_') ||
    asset.downloadUrl.includes('rendezvous-server_')
  );

  return generateTable(cliAssets);
}

export async function generateAurTable(): Promise<string> {
  const aurPackages = [
    {
      name: 'eigenwallet-bin',
      packageUrl: 'https://aur.archlinux.org/packages/eigenwallet-bin',
      maintainer: 'Kainoa Kanter (That1Calculator)',
      maintainerUrl: 'https://aur.archlinux.org/account/That1Calculator',
      architectures: ['x86_64'],
    },
    {
      name: 'eigenwallet-developertools-bin',
      packageUrl: 'https://aur.archlinux.org/packages/eigenwallet-developertools-bin',
      maintainer: 'Kainoa Kanter (That1Calculator)',
      maintainerUrl: 'https://aur.archlinux.org/account/That1Calculator',
      architectures: ['x86_64'],
    }
  ];

  const packagesWithVersions = await Promise.all(
    aurPackages.map(async (pkg) => {
      const version = await fetchAurPackageVersion(pkg.name);
      return { ...pkg, version };
    })
  );

  const tableRows = packagesWithVersions.map(pkg => {
    return `  <tr>
    <td class="hide-mobile">${pkg.architectures.join(", ")}</td>
    <td><a href="${pkg.packageUrl}"><code>${pkg.name}</code></a></td>
    <td>${pkg.version}</td>
    <td><a href="${pkg.maintainerUrl}">${pkg.maintainer}</a></td>
  </tr>`;
  }).join('\n');

  return `<table>
  <thead>
    <tr>
      <th class="hide-mobile">Architecture</th>
      <th>Package</th>
      <th>Version</th>
      <th>Maintainer</th>
    </tr>
  </thead>
  <tbody>
${tableRows}
  <tr>
    <td colspan="4" class="notice">
    The Arch packages are unofficial and communitity maintained. Use at your own risk.
    </td>
  </tr>
  </tbody>
</table>`;
}

async function fetchAurPackageVersion(packageName: string): Promise<string> {
  const cacheKey = `aur-${packageName}`;
  const cached = getCache<string>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(`https://aur.archlinux.org/rpc/v5/info?arg[]=${packageName}`);
    if (!response.ok) return 'N/A';

    const data = await response.json();
    const version = data.results?.[0]?.Version ?? 'N/A';
    if (version !== 'N/A') setCache(cacheKey, version);
    return version;
  } catch {
    return 'N/A';
  }
}

function groupAssetsByPlatform(assets: DownloadAsset[]): Record<string, DownloadAsset[]> {
  return assets.reduce((groups, asset) => {
    if (!groups[asset.platform]) {
      groups[asset.platform] = [];
    }
    groups[asset.platform].push(asset);
    return groups;
  }, {} as Record<string, DownloadAsset[]>);
}

const DOWNLOAD_ICON = `<img src="/icons/download.svg" width="20" height="20" alt="Download" style="display:inline-block;vertical-align:middle;margin-left:0.5em;"/>`;

function createFileLink(asset: DownloadAsset): string {
  if (asset.type === 'instructions') {
    return `<a href="${asset.downloadUrl}">Instructions</a>`;
  }

  const fileName = asset.downloadUrl.split('/').pop()!;
  return `<a href="${asset.downloadUrl}" style="text-decoration: none; display: inline-flex; align-items: center;"><code style="font-size: 0.85em; word-break: break-all;">${fileName}</code>${DOWNLOAD_ICON}</a>`;
}

const DOWNLOAD_ICON_SMALL = `<img src="/icons/download.svg" width="16" height="16" alt="Download" style="display:inline-block;vertical-align:middle;margin-left:0.3em;"/>`;

function createSignatureLink(signatureUrl: string): string {
  if (!signatureUrl) return '';
  return `<a href="${signatureUrl}" style="display: inline-flex; align-items: center;">signature${DOWNLOAD_ICON_SMALL}</a>`;
}

function generateAssetRow(asset: DownloadAsset): string {
  const fileLink = createFileLink(asset);
  const signatureLink = createSignatureLink(asset.signatureUrl);

  return `
    <tr>
      <td>${asset.architecture}</td>
      <td>${fileLink}</td>
      <td>${signatureLink}</td>
      <td>${asset.size}</td>
    </tr>`;
}

function generatePlatformSection(platform: string, assets: DownloadAsset[]): string {
  const icon = PLATFORM_ICONS[platform] ?? '';
  const assetRows = assets.map(generateAssetRow).join('');

  return `
    <tr>
      <td colspan="4" style="background: #e8e8e8; color: #222; font-weight: bold; padding: 0.5em 1em;">
        ${icon} ${platform}
      </td>
    </tr>${assetRows}`;
}

function generateTableHeader(): string {
  return `
<table>
  <thead>
    <tr>
      <th scope="col">Architecture</th>
      <th scope="col">File</th>
      <th scope="col">Signature</th>
      <th scope="col">Size</th>
    </tr>
  </thead>
  <tbody>`;
}

function generateTable(assets: DownloadAsset[]): string {
  if (assets.length === 0) {
    return '<p><em>No downloads available.</em></p>';
  }

  const platformGroups = groupAssetsByPlatform(assets);
  let tableHtml = generateTableHeader();

  for (const platform of PLATFORM_ORDER) {
    if (platformGroups[platform]) {
      tableHtml += generatePlatformSection(platform, platformGroups[platform]);
    }
  }

  tableHtml += `
  </tbody>
</table>`;

  return tableHtml;
}
