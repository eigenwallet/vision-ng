const API_RETRIES = parseInt(process.env.API_RETRIES || '3', 10);

/**
 * Fetch with retry logic for transient failures
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = API_RETRIES
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, options);
    if (response.ok) {
      return response;
    }
    if (attempt < retries && response.status >= 500) {
      console.warn(
        `Attempt ${attempt}/${retries} failed with status ${response.status}, retrying...`
      );
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    } else {
      return response;
    }
  }
  return fetch(url, options);
}
