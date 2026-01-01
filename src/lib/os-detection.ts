// Client-side OS and architecture detection utilities

export type OS = 'windows' | 'macos' | 'linux' | 'unknown';
export type Arch = 'arm64' | 'x86_64';

export function detectOS(): OS {
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator as any).userAgentData?.platform?.toLowerCase() || navigator.platform?.toLowerCase() || '';
  
  if (platform.includes('win') || ua.includes('windows')) return 'windows';
  if (platform.includes('mac') || ua.includes('mac')) return 'macos';
  if (platform.includes('linux') || ua.includes('linux')) return 'linux';
  return 'unknown';
}

function detectAppleSiliconViaGPU(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return false;
    
    const debugInfo = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return false;
    
    const renderer = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    // Apple Silicon GPUs are named "Apple M1", "Apple M2", "Apple M3", "Apple M4", etc.
    return /Apple M\d/i.test(renderer);
  } catch {
    return false;
  }
}

export function detectArch(): Arch {
  // Check userAgentData first (modern browsers)
  if ((navigator as any).userAgentData?.architecture === 'arm') {
    return 'arm64';
  }
  
  // Check user agent string
  const ua = navigator.userAgent;
  if (/arm64|aarch64/i.test(ua)) {
    return 'arm64';
  }
  
  // For macOS, use WebGL GPU detection as fallback (most reliable for Apple Silicon)
  const os = detectOS();
  if (os === 'macos' && detectAppleSiliconViaGPU()) {
    return 'arm64';
  }
  
  return 'x86_64';
}

export function isSiliconMac(): boolean {
  return detectOS() === 'macos' && detectArch() === 'arm64';
}

